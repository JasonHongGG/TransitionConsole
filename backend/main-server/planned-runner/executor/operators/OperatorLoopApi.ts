import type { LoopAppendFunctionResponsesInput, LoopDecision, LoopDecisionInput, OperatorLoopAgent } from '../contracts'
import type {
  OperatorLoopAppendFunctionResponsesRequest,
  OperatorLoopAppendFunctionResponsesResponse,
  OperatorLoopCleanupRunRequest,
  OperatorLoopCleanupRunResponse,
  OperatorLoopDecideRequest,
  OperatorLoopDecideResponse,
  OperatorLoopResetResponse,
} from '../../../shared/contracts'
import { postApiJson } from '../../api/apiClient'

export class OperatorLoopApi implements OperatorLoopAgent {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  async decide(input: LoopDecisionInput): Promise<LoopDecision> {
    return postApiJson<OperatorLoopDecideRequest, OperatorLoopDecideResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/decide',
      input,
      this.timeoutMs,
    )
  }

  async appendFunctionResponses(input: LoopAppendFunctionResponsesInput): Promise<void> {
    await postApiJson<OperatorLoopAppendFunctionResponsesRequest, OperatorLoopAppendFunctionResponsesResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/append-function-responses',
      input,
      this.timeoutMs,
    )
  }

  async cleanupRun(runId: string): Promise<void> {
    await postApiJson<OperatorLoopCleanupRunRequest, OperatorLoopCleanupRunResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/cleanup-run',
      { runId },
      this.timeoutMs,
    )
  }

  async resetReplayCursor(): Promise<void> {
    await postApiJson<Record<string, never>, OperatorLoopResetResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/reset',
      {},
      this.timeoutMs,
    )
  }
}