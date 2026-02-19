import type { AiRuntime } from '../../runtime/types'
import type { AiRuntimeMessageAttachment } from '../../runtime/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { LoopDecision, LoopDecisionInput, LoopFunctionCall, LoopFunctionResponse } from '../../../main-server/planned-runner/executor/contracts'
import type { OperatorLoopDecisionAgent as OperatorLoopDecisionAgentContract } from '../types'
import { OPERATOR_LOOP_PROMPT } from './prompt'
import { OperatorLoopMockReplay } from './mockReplay/OperatorLoopMockReplay'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

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
  private readonly maxHistoryTurns: number
  private readonly useMockReplay: boolean
  private readonly mockReplay: OperatorLoopMockReplay
  private readonly conversationHistory = new Map<string, ConversationTurn[]>()
  private readonly screenshotDirsBySession = new Map<string, string>()

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.OPERATOR_LOOP_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.maxScreenshotBase64Chars = Number(process.env.OPERATOR_LOOP_SCREENSHOT_B64_MAX ?? 200000)
    this.maxFunctionResponseScreenshotTurns = Number(process.env.OPERATOR_LOOP_MAX_RECENT_SCREENSHOT_TURNS ?? 3)
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

  private ensureScreenshotDir(runId: string, pathId: string): string {
    const session = this.sessionKey(runId, pathId)
    const existing = this.screenshotDirsBySession.get(session)
    if (existing) return existing

    const dir = path.join(os.tmpdir(), 'transitor', 'operator-loop', runId, pathId)
    this.screenshotDirsBySession.set(session, dir)
    return dir
  }

  private async writeScreenshotAttachment(input: LoopDecisionInput): Promise<AiRuntimeMessageAttachment | null> {
    const base64 = input.screenshotBase64
    if (!base64) return null

    if (base64.length > this.maxScreenshotBase64Chars) {
      return null
    }

    const dir = this.ensureScreenshotDir(input.context.runId, input.context.pathId)
    await fs.mkdir(dir, { recursive: true })

    const stepHash = crypto.createHash('sha1').update(input.context.stepId).digest('hex').slice(0, 10)
    const fileName = `step-${stepHash}-iter-${input.iteration}.png`
    const filePath = path.join(dir, fileName)

    const buffer = Buffer.from(base64, 'base64')
    await fs.writeFile(filePath, buffer)

    return {
      type: 'file',
      path: filePath,
      displayName: 'screenshot.png',
    }
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

    const screenshotAttachment = await this.writeScreenshotAttachment(input)
    const attachments = screenshotAttachment ? [screenshotAttachment] : undefined

    const payload = {
      context: input.context,
      step: input.step,
      iteration: input.iteration,
      currentUrl: input.currentUrl,
      stateSummary: input.stateSummary,
      actionCursor: input.actionCursor,
      narrative: input.narrative,
      validations: input.narrative.validations,
      screenshot: screenshotAttachment
        ? {
            mimeType: 'image/png',
            attachment: 'screenshot.png',
          }
        : {
            omitted: true,
            reason: `screenshotBase64 exceeds OPERATOR_LOOP_SCREENSHOT_B64_MAX (${this.maxScreenshotBase64Chars})`,
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

  async appendFunctionResponses(runId: string, pathId: string, responses: LoopFunctionResponse[]): Promise<void> {
    if (this.useMockReplay) {
      return
    }

    const key = this.sessionKey(runId, pathId)
    this.pushHistory(key, {
      role: 'user',
      type: 'function_response',
      payload: responses.map((item) => ({ ...item, screenshotBase64: undefined })),
    })
    this.compactHistoryScreenshots(key)
  }

  async cleanupRun(runId: string): Promise<void> {
    if (this.useMockReplay) {
      return
    }

    const keys = Array.from(this.conversationHistory.keys()).filter((key) => key.startsWith(`${runId}:`))
    keys.forEach((key) => this.conversationHistory.delete(key))

    const screenshotDirs = Array.from(this.screenshotDirsBySession.entries()).filter(([key]) => key.startsWith(`${runId}:`))
    screenshotDirs.forEach(([key]) => this.screenshotDirsBySession.delete(key))
    await Promise.all(
      screenshotDirs.map(async ([, screenshotDir]) => {
        try {
          await fs.rm(screenshotDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }),
    )
  }

  async reset(): Promise<void> {
    if (this.useMockReplay) {
      await this.mockReplay.resetRoundCursor()
    }
  }
}
