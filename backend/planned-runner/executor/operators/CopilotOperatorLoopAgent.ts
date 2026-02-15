import { CopilotClient } from '@github/copilot-sdk'
import { createLogger } from '../../../common/logger'
import type { ExecutionFailureCode } from '../../types'
import type { LoopDecision, LoopDecisionInput, LoopFunctionCall, LoopFunctionResponse, OperatorLoopAgent } from '../contracts'

const log = createLogger('planned-executor')

type LoopDecisionEnvelope = {
  decision?: {
    kind?: 'complete' | 'act' | 'fail'
    reason?: string
    failureCode?: ExecutionFailureCode
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

const extractJsonPayload = (rawContent: string): LoopDecisionEnvelope | null => {
  const trimmed = rawContent.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as LoopDecisionEnvelope
  } catch {
    return null
  }
}

export class CopilotOperatorLoopAgent implements OperatorLoopAgent {
  private readonly model: string
  private readonly token: string
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly timeoutMs: number
  private readonly maxScreenshotBase64Chars: number
  private readonly maxFunctionResponseScreenshotTurns: number
  private readonly clients = new Map<string, CopilotClient>()
  private readonly sessions = new Map<string, Awaited<ReturnType<CopilotClient['createSession']>>>()
  private readonly conversationHistory = new Map<string, ConversationTurn[]>()

  constructor() {
    this.model = process.env.PLANNED_RUNNER_OPERATOR_MODEL ?? process.env.COPILOT_MODEL ?? 'gpt-5'
    const token = process.env.GITHUB_TOKEN ?? ''
    if (!token) {
      throw new Error('GITHUB_TOKEN is required for CopilotOperatorLoopAgent')
    }
    this.token = token
    this.cliPath = process.env.COPILOT_CLI_PATH || undefined
    this.cliUrl = process.env.COPILOT_CLI_URL || undefined
    const timeout = Number(process.env.PLANNED_RUNNER_OPERATOR_TIMEOUT_MS ?? 120000)
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 120000
    const screenshotLimit = Number(process.env.PLANNED_RUNNER_OPERATOR_SCREENSHOT_B64_MAX ?? 200000)
    this.maxScreenshotBase64Chars = Number.isFinite(screenshotLimit) && screenshotLimit > 10000 ? screenshotLimit : 200000
    const maxTurns = Number(process.env.PLANNED_RUNNER_OPERATOR_MAX_RECENT_SCREENSHOT_TURNS ?? 3)
    this.maxFunctionResponseScreenshotTurns = Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : 3
  }

  private sessionKey(runId: string, pathId: string): string {
    return `${runId}:${pathId}`
  }

  private systemPrompt(): string {
    return `你是 Browser Operator Agent (Agent B)。
每一輪你會收到：
1) narrative 任務描述與完成條件
2) 目前 URL 與狀態摘要
3) assertion 定義（供你判斷是否完成）
4) 當前頁面截圖（base64 PNG）
5) instruction 作為參考

你的工作：
- 必須先判斷目前狀態，再決定：complete / act / fail。
- 若 act，必須輸出一個或多個 functionCalls（同一輪可多個 function call），每個 function call 需包含 name 與 args。
- 工具僅允許：click_at, hover_at, type_text_at, scroll_document, scroll_at, wait_5_seconds, go_back, go_forward, navigate, key_combination, drag_and_drop, current_state, evaluate。
- 不要輸出 markdown，不要輸出解釋文字，只輸出 JSON。

輸出格式：
{
  "decision": {
    "kind": "complete|act|fail",
    "reason": "string",
    "failureCode": "operator-no-progress|operator-action-failed|assertion-failed|operator-timeout 可選",
    "terminationReason": "completed|max-iterations|operator-error|assertion-failed|criteria-unmet 可選"
  },
  "stateSummary": "string",
  "functionCalls": [
    {
      "name": "click_at|hover_at|type_text_at|scroll_document|scroll_at|wait_5_seconds|go_back|go_forward|navigate|key_combination|drag_and_drop|current_state|evaluate",
      "args": {"x": 100, "y": 200},
      "description": "optional"
    }
  ]
}

規則：
- 你必須自行根據 observation 與截圖判斷是否 complete。
- 若需要再觀察，可用 current_state 或 wait_5_seconds。
- 若無法再前進或條件不可能達成，輸出 fail 並附 reason。`
  }

  private getHistory(key: string): ConversationTurn[] {
    return this.conversationHistory.get(key) ?? []
  }

  private setHistory(key: string, turns: ConversationTurn[]): void {
    this.conversationHistory.set(key, turns)
  }

  private pushHistory(key: string, turn: ConversationTurn): void {
    const current = this.getHistory(key)
    current.push(turn)
    this.setHistory(key, current)
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

      const stripped = responses.map((item) => ({
        ...item,
        screenshotBase64: undefined,
      }))
      history[index] = {
        ...turn,
        payload: stripped,
      }
    }

    this.setHistory(key, history)
  }

  private truncateScreenshot(base64: string): { value: string; truncated: boolean } {
    if (base64.length <= this.maxScreenshotBase64Chars) {
      return { value: base64, truncated: false }
    }
    return {
      value: base64.slice(0, this.maxScreenshotBase64Chars),
      truncated: true,
    }
  }

  private async getOrCreateSession(runId: string, pathId: string) {
    const key = this.sessionKey(runId, pathId)
    const existing = this.sessions.get(key)
    if (existing) return existing

    const client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })

    await client.start()
    const session = await client.createSession({
      model: this.model,
      systemMessage: { content: this.systemPrompt() },
    })

    this.clients.set(key, client)
    this.sessions.set(key, session)
    return session
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
    const key = this.sessionKey(input.runId, input.pathId)
    const session = await this.getOrCreateSession(input.runId, input.pathId)
    const screenshotInfo = this.truncateScreenshot(input.screenshotBase64)

    const promptPayload = {
      iteration: input.iteration,
      currentUrl: input.currentUrl,
      stateSummary: input.stateSummary,
      actionCursor: input.actionCursor,
      narrative: input.narrative,
      instruction: input.instruction,
      assertions: input.assertions,
      screenshot: {
        mimeType: 'image/png',
        encoding: 'base64',
        truncated: screenshotInfo.truncated,
        data: screenshotInfo.value,
      },
      conversationHistory: this.getHistory(key),
    }

    const finalEvent = await session.sendAndWait(
      {
        prompt: `Return JSON only.\n${JSON.stringify(promptPayload)}`,
      },
      this.timeoutMs,
    )

    const parsed = extractJsonPayload(finalEvent?.data?.content ?? '')
    if (!parsed?.decision?.kind || !parsed.decision.reason) {
      log.log('operator loop agent malformed decision', {
        runId: input.runId,
        pathId: input.pathId,
        iteration: input.iteration,
        content: finalEvent?.data?.content ?? '',
      })
      return {
        kind: 'fail',
        reason: 'Copilot loop agent returned malformed decision payload',
        failureCode: 'operator-action-failed',
        terminationReason: 'operator-error',
      }
    }

    if (parsed.decision.kind === 'act') {
      const functionCalls = this.normalizeFunctionCalls(parsed)
      if (!functionCalls || functionCalls.length === 0) {
        return {
          kind: 'fail',
          reason: 'Copilot loop agent returned act decision without valid functionCalls',
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

    if (parsed.decision.kind === 'complete') {
      this.pushHistory(key, {
        role: 'assistant',
        type: 'decision',
        payload: {
          decision: parsed.decision,
          functionCalls: [],
          stateSummary: parsed.stateSummary,
        },
      })
      return {
        kind: 'complete',
        reason: parsed.stateSummary || parsed.decision.reason,
        terminationReason: parsed.decision.terminationReason ?? 'completed',
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
    const keys = Array.from(this.sessions.keys()).filter((key) => key.startsWith(`${runId}:`))

    await Promise.all(
      keys.map(async (key) => {
        const session = this.sessions.get(key)
        const client = this.clients.get(key)

        if (session) {
          try {
            await session.destroy()
          } catch {
            // ignore
          }
          this.sessions.delete(key)
        }

        if (client) {
          try {
            await client.stop()
          } catch {
            // ignore
          }
          this.clients.delete(key)
        }

        this.conversationHistory.delete(key)
      }),
    )
  }
}
