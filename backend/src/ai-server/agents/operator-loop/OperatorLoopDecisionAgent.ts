import type { AiRuntime } from '../../runtime/types'
import type { AiRuntimeMessageAttachment } from '../../runtime/types'
import type { AgentMode } from '../../../main-server/planned-runner/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { LoopAppendFunctionResponsesInput, LoopDecision, LoopDecisionInput, LoopFunctionCall } from '../../../operator-server/type'
import type { OperatorLoopDecisionAgent as OperatorLoopDecisionAgentContract } from '../types'
import { OPERATOR_LOOP_PROMPT } from './prompt'
import { OperatorLoopMockReplay } from './mockReplay/OperatorLoopMockReplay'
import { RuntimeScreenshotLogger } from './RuntimeScreenshotLogger'

type LoopDecisionEnvelope = {
  decision?: {
    kind?: 'complete' | 'act' | 'fail'
    reason?: string
    failureCode?: LoopDecision['failureCode']
    terminationReason?: LoopDecision['terminationReason']
  }
  functionCalls?: Array<{
    name?: string
    args?: Record<string, unknown>
    description?: string
  }>
  progressSummary?: string
}

type ConversationDecisionPayload = {
  decision: {
    kind: 'complete' | 'act' | 'fail'
    reason: string
    failureCode?: LoopDecision['failureCode']
    terminationReason?: LoopDecision['terminationReason']
  }
  functionCalls: LoopFunctionCall[]
  progressSummary?: string
}

type ConversationFunctionResponsePayloadItem = {
  name: string
  arguments: Record<string, unknown>
  response: {
    status: 'success' | 'failed'
    url?: string
    message?: string
    result?: unknown
  }
}

type ConversationTurn =
  | {
      role: 'assistant'
      type: 'decision'
      payload: ConversationDecisionPayload
    }
  | {
      role: 'user'
      type: 'function_response'
      payload: ConversationFunctionResponsePayloadItem[]
    }

export class DefaultOperatorLoopDecisionAgent implements OperatorLoopDecisionAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxHistoryTurns: number
  private readonly defaultMode: AgentMode
  private readonly mockReplay: OperatorLoopMockReplay
  private readonly runtimeScreenshotLogger = new RuntimeScreenshotLogger()
  private readonly conversationHistory = new Map<string, ConversationTurn[]>()

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.OPERATOR_LOOP_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.maxHistoryTurns = Number(process.env.OPERATOR_LOOP_MAX_HISTORY_TURNS ?? 12)
    this.defaultMode = (process.env.OPERATOR_LOOP_PROVIDER ?? 'llm').trim().toLowerCase() === 'mock-replay' ? 'mock' : 'llm'
    this.mockReplay = new OperatorLoopMockReplay({
      mockDir: process.env.OPERATOR_LOOP_MOCK_DIR,
      loop: (process.env.OPERATOR_LOOP_MOCK_LOOP ?? 'true').trim().toLowerCase() !== 'false',
    })
  }

  private sessionKey(runId: string, pathId: string): string {
    return `${runId}:${pathId}`
  }

  private getHistory(key: string): ConversationTurn[] {
    return this.conversationHistory.get(key) ?? []
  }

  private pushHistory(key: string, turn: ConversationTurn): void {
    const current = this.getHistory(key)
    current.push(turn)

    if (Number.isFinite(this.maxHistoryTurns) && this.maxHistoryTurns > 0 && current.length > this.maxHistoryTurns) {
      current.splice(0, current.length - this.maxHistoryTurns)
    }

    this.conversationHistory.set(key, current)
  }

  private normalizeFunctionCalls(envelope: LoopDecisionEnvelope): LoopFunctionCall[] | undefined {
    const explicit = Array.isArray(envelope.functionCalls)
      ? envelope.functionCalls
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter((item) => Boolean(item.name && item.args && typeof item.args === 'object'))
          .map((item) => ({
            name: item.name!,
            args: item.args!,
            description: item.description,
          }))
      : []

    return explicit.length > 0 ? explicit : undefined
  }



  async decide(input: LoopDecisionInput): Promise<LoopDecision> {
    const mode = input.agentMode ?? this.defaultMode

    if (mode === 'mock') {
      const decision = await this.mockReplay.decide()

      await writeAgentResponseLog({
        agent: 'operator-loop',
        model: this.model,
        mode: 'mock-replay',
        runId: input.context.runId,
        pathId: input.context.pathId,
        stepId: input.context.stepId,
        request: {
          context: input.context,
          step: input.step,
          runtimeState: input.runtimeState,
          narrative: input.narrative,
        },
        parsedResponse: decision,
      })

      return decision
    }

    const key = this.sessionKey(input.context.runId, input.context.pathId)
    const screenshotBase64 = input.screenshotBase64
    const iteration = Number(input.runtimeState.iteration)

    const decisionScreenshotPath = await this.runtimeScreenshotLogger.saveDecisionInput({
      runId: input.context.runId,
      pathId: input.context.pathId,
      stepOrder: input.context.stepOrder,
      narrativeSummary: input.narrative.summary,
      iteration,
      screenshotBase64: input.screenshotBase64,
    })

    const attachments: AiRuntimeMessageAttachment[] | undefined = decisionScreenshotPath
      ? [{
          type: 'file',
          path: decisionScreenshotPath,
          displayName: 'screenshot.png',
        }]
      : undefined

    const payload = {
      context: input.context,
      step: input.step,
      runtimeState: input.runtimeState,
      narrative: input.narrative,
      screenshot: decisionScreenshotPath
        ? {
            mimeType: 'image/png',
            attachment: 'screenshot.png',
          }
        : {
            omitted: true,
            reason: 'decision screenshot persistence failed',
          },
      conversationHistory: this.getHistory(key),
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: OPERATOR_LOOP_PROMPT,
      prompt: `Return JSON only.\nScreenshot is provided as an attached file named screenshot.png (image/png) when present.\n${JSON.stringify(payload)}`,
      attachments,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<LoopDecisionEnvelope>(content)

    await writeAgentResponseLog({
      agent: 'operator-loop',
      model: this.model,
      runId: input.context.runId,
      pathId: input.context.pathId,
      stepId: input.context.stepId,
      request: {
        context: payload.context,
        step: input.step,
        runtimeState: input.runtimeState,
        narrative: input.narrative,
        conversationHistoryTurns: this.getHistory(key).length,
        screenshotBase64Chars: screenshotBase64.length,
      },
      rawResponse: content,
      parsedResponse: parsed,
    })

    if (!parsed?.decision?.kind || !parsed.decision.reason || !parsed.progressSummary?.trim()) {
      return {
        kind: 'fail',
        reason: 'LLM operator loop returned malformed decision payload',
        failureCode: 'operator-action-failed',
        terminationReason: 'operator-error',
      }
    }

    const normalizedDecision: ConversationDecisionPayload['decision'] = {
      kind: parsed.decision.kind,
      reason: parsed.decision.reason,
      failureCode: parsed.decision.failureCode,
      terminationReason: parsed.decision.terminationReason,
    }

    if (parsed.decision.kind === 'act') {
      const functionCalls = this.normalizeFunctionCalls(parsed)
      if (!functionCalls || functionCalls.length === 0) {
        return {
          kind: 'fail',
          reason: 'LLM operator loop returned act decision without valid functionCalls',
          failureCode: 'operator-action-failed',
          terminationReason: 'operator-error',
        }
      }

      this.pushHistory(key, {
        role: 'assistant',
        type: 'decision',
        payload: {
          decision: normalizedDecision,
          functionCalls,
          progressSummary: parsed.progressSummary,
        },
      })

      return {
        kind: 'act',
        reason: normalizedDecision.reason,
        progressSummary: parsed.progressSummary,
        functionCalls,
      }
    }

    this.pushHistory(key, {
      role: 'assistant',
      type: 'decision',
      payload: {
        decision: normalizedDecision,
        functionCalls: [],
        progressSummary: parsed.progressSummary,
      },
    })

    if (normalizedDecision.kind === 'complete') {
      return {
        kind: 'complete',
        reason: normalizedDecision.reason,
        progressSummary: parsed.progressSummary,
        terminationReason: normalizedDecision.terminationReason ?? 'completed',
      }
    }

    return {
      kind: 'fail',
      reason: normalizedDecision.reason,
      progressSummary: parsed.progressSummary,
      failureCode: normalizedDecision.failureCode ?? 'operator-no-progress',
      terminationReason: normalizedDecision.terminationReason ?? 'criteria-unmet',
    }
  }

  async appendFunctionResponses(input: LoopAppendFunctionResponsesInput): Promise<void> {
    const mode = input.agentMode ?? this.defaultMode
    if (mode === 'mock') {
      return
    }

    const iteration = Number(input.runtimeState.iteration)

    await this.runtimeScreenshotLogger.saveFunctionResponses({
      runId: input.runId,
      pathId: input.pathId,
      stepOrder: input.stepOrder,
      narrativeSummary: input.narrativeSummary,
      iteration,
      responses: input.responses.map((item) => ({
        name: item.name,
        screenshotBase64: item.screenshotBase64,
      })),
    })

    const key = this.sessionKey(input.runId, input.pathId)
    this.pushHistory(key, {
      role: 'user',
      type: 'function_response',
      payload: input.responses.map((item) => ({
        name: item.name,
        arguments: item.arguments,
        response: item.response,
      })),
    })
  }

  async cleanupRun(runId: string): Promise<void> {
    const keys = Array.from(this.conversationHistory.keys()).filter((key) => key.startsWith(`${runId}:`))
    keys.forEach((key) => this.conversationHistory.delete(key))
    this.runtimeScreenshotLogger.cleanupRun(runId)
  }

  async reset(): Promise<void> {
    await this.mockReplay.resetRoundCursor()
  }
}
