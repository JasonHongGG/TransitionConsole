import type { AiRuntime } from '../../runtime/types'
import type { AiRuntimeMessageAttachment } from '../../runtime/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { LoopAppendFunctionResponsesInput, LoopDecision, LoopDecisionInput, LoopFunctionCall } from '../../../main-server/planned-runner/executor/contracts'
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
  stateSummary?: string
}

type ConversationTurn = {
  role: 'assistant' | 'user'
  type: 'decision' | 'function_response'
  payload: unknown
}

export class DefaultOperatorLoopDecisionAgent implements OperatorLoopDecisionAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxHistoryTurns: number
  private readonly useMockReplay: boolean
  private readonly mockReplay: OperatorLoopMockReplay
  private readonly runtimeScreenshotLogger = new RuntimeScreenshotLogger()
  private readonly conversationHistory = new Map<string, ConversationTurn[]>()

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.OPERATOR_LOOP_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.maxHistoryTurns = Number(process.env.OPERATOR_LOOP_MAX_HISTORY_TURNS ?? 12)
    this.useMockReplay = (process.env.OPERATOR_LOOP_PROVIDER ?? 'llm').trim().toLowerCase() === 'mock-replay'
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
    if (this.useMockReplay) {
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
          iteration: input.iteration,
          currentUrl: input.currentUrl,
          stateSummary: input.stateSummary,
          actionCursor: input.actionCursor,
          narrative: input.narrative,
        },
        parsedResponse: decision,
      })

      return decision
    }

    const key = this.sessionKey(input.context.runId, input.context.pathId)
    const screenshotBase64 = input.screenshotBase64

    const decisionScreenshotPath = await this.runtimeScreenshotLogger.saveDecisionInput({
      runId: input.context.runId,
      pathId: input.context.pathId,
      stepOrder: input.context.stepOrder,
      narrativeSummary: input.narrative.summary,
      iteration: input.iteration,
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
      iteration: input.iteration,
      currentUrl: input.currentUrl,
      stateSummary: input.stateSummary,
      actionCursor: input.actionCursor,
      narrative: input.narrative,
      validations: input.narrative.validations,
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
        iteration: input.iteration,
        currentUrl: input.currentUrl,
        stateSummary: input.stateSummary,
        actionCursor: input.actionCursor,
        narrative: input.narrative,
        conversationHistoryTurns: this.getHistory(key).length,
        screenshotBase64Chars: screenshotBase64.length,
      },
      rawResponse: content,
      parsedResponse: parsed,
    })

    if (!parsed?.decision?.kind || !parsed.decision.reason) {
      return {
        kind: 'fail',
        reason: 'LLM operator loop returned malformed decision payload',
        failureCode: 'operator-action-failed',
        terminationReason: 'operator-error',
      }
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
          decision: parsed.decision,
          functionCalls,
          stateSummary: parsed.stateSummary,
        },
      })

      return {
        kind: 'act',
        reason: parsed.stateSummary || parsed.decision.reason,
        functionCalls,
      }
    }

    this.pushHistory(key, {
      role: 'assistant',
      type: 'decision',
      payload: {
        decision: parsed.decision,
        functionCalls: [],
        stateSummary: parsed.stateSummary,
      },
    })

    if (parsed.decision.kind === 'complete') {
      return {
        kind: 'complete',
        reason: parsed.stateSummary || parsed.decision.reason,
        terminationReason: parsed.decision.terminationReason ?? 'completed',
      }
    }

    return {
      kind: 'fail',
      reason: parsed.stateSummary || parsed.decision.reason,
      failureCode: parsed.decision.failureCode ?? 'operator-no-progress',
      terminationReason: parsed.decision.terminationReason ?? 'criteria-unmet',
    }
  }

  async appendFunctionResponses(input: LoopAppendFunctionResponsesInput): Promise<void> {
    if (this.useMockReplay) {
      return
    }

    await this.runtimeScreenshotLogger.saveFunctionResponses({
      runId: input.runId,
      pathId: input.pathId,
      stepOrder: input.stepOrder,
      narrativeSummary: input.narrativeSummary,
      iteration: input.iteration,
      responses: input.responses.map((item) => ({
        name: item.name,
        screenshotBase64: item.screenshotBase64,
      })),
    })

    const key = this.sessionKey(input.runId, input.pathId)
    this.pushHistory(key, {
      role: 'user',
      type: 'function_response',
      payload: input.responses.map((item) => ({ ...item, screenshotBase64: undefined })),
    })
  }

  async cleanupRun(runId: string): Promise<void> {
    if (this.useMockReplay) {
      return
    }

    const keys = Array.from(this.conversationHistory.keys()).filter((key) => key.startsWith(`${runId}:`))
    keys.forEach((key) => this.conversationHistory.delete(key))
    this.runtimeScreenshotLogger.cleanupRun(runId)
  }

  async reset(): Promise<void> {
    if (this.useMockReplay) {
      await this.mockReplay.resetRoundCursor()
    }
  }
}
