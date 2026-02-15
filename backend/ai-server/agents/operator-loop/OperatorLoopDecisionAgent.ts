import type { AiRuntime } from '../../runtime/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { LoopDecision, LoopDecisionInput, LoopFunctionCall, LoopFunctionResponse } from '../../../main-server/planned-runner/executor/contracts'
import type { OperatorLoopDecisionAgent as OperatorLoopDecisionAgentContract } from '../types'
import { OPERATOR_LOOP_PROMPT } from './prompt'

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
  private readonly maxScreenshotBase64Chars: number
  private readonly maxFunctionResponseScreenshotTurns: number
  private readonly conversationHistory = new Map<string, ConversationTurn[]>()

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.PLANNED_RUNNER_OPERATOR_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.PLANNED_RUNNER_OPERATOR_TIMEOUT_MS ?? 120000)
    this.maxScreenshotBase64Chars = Number(process.env.PLANNED_RUNNER_OPERATOR_SCREENSHOT_B64_MAX ?? 200000)
    this.maxFunctionResponseScreenshotTurns = Number(process.env.PLANNED_RUNNER_OPERATOR_MAX_RECENT_SCREENSHOT_TURNS ?? 3)
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
    this.conversationHistory.set(key, current)
  }

  private compactHistoryScreenshots(key: string): void {
    const history = this.getHistory(key)
    let screenshotTurnCount = 0

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const turn = history[index]
      if (turn.role !== 'user' || turn.type !== 'function_response') continue
      if (!Array.isArray(turn.payload)) continue

      const responses = turn.payload as LoopFunctionResponse[]
      const hasScreenshot = responses.some((item) => Boolean(item.screenshotBase64))
      if (!hasScreenshot) continue

      screenshotTurnCount += 1
      if (screenshotTurnCount <= this.maxFunctionResponseScreenshotTurns) continue

      history[index] = {
        ...turn,
        payload: responses.map((item) => ({ ...item, screenshotBase64: undefined })),
      }
    }

    this.conversationHistory.set(key, history)
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
    const key = this.sessionKey(input.context.runId, input.context.pathId)
    const screenshotBase64 =
      input.screenshotBase64.length > this.maxScreenshotBase64Chars
        ? input.screenshotBase64.slice(0, this.maxScreenshotBase64Chars)
        : input.screenshotBase64

    const payload = {
      ...input,
      screenshot: {
        mimeType: 'image/png',
        encoding: 'base64',
        data: screenshotBase64,
      },
      conversationHistory: this.getHistory(key),
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: OPERATOR_LOOP_PROMPT,
      prompt: `Return JSON only.\n${JSON.stringify(payload)}`,
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
        context: input.context,
        step: input.step,
        iteration: input.iteration,
        currentUrl: input.currentUrl,
        stateSummary: input.stateSummary,
        actionCursor: input.actionCursor,
        assertions: input.assertions,
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

  async appendFunctionResponses(runId: string, pathId: string, responses: LoopFunctionResponse[]): Promise<void> {
    const key = this.sessionKey(runId, pathId)
    this.pushHistory(key, {
      role: 'user',
      type: 'function_response',
      payload: responses,
    })
    this.compactHistoryScreenshots(key)
  }

  async cleanupRun(runId: string): Promise<void> {
    const keys = Array.from(this.conversationHistory.keys()).filter((key) => key.startsWith(`${runId}:`))
    keys.forEach((key) => this.conversationHistory.delete(key))
  }
}
