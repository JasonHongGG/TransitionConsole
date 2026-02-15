import type { LoopDecision, LoopDecisionInput, LoopFunctionResponse, OperatorLoopAgent } from '../contracts'
import type {
  OperatorLoopAppendFunctionResponsesRequest,
  OperatorLoopAppendFunctionResponsesResponse,
  OperatorLoopCleanupRunRequest,
  OperatorLoopCleanupRunResponse,
  OperatorLoopDecideRequest,
  OperatorLoopDecideResponse,
} from '../../../shared/contracts'
import { postApiJson } from '../../api/apiClient'

export class OperatorLoopApi implements OperatorLoopAgent {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.AI_SERVER_TIMEOUT_MS ?? 120000)
  }

  async decide(input: LoopDecisionInput): Promise<LoopDecision> {
    return postApiJson<OperatorLoopDecideRequest, OperatorLoopDecideResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/decide',
      input,
      this.timeoutMs,
    )
  }

  async appendFunctionResponses(runId: string, pathId: string, responses: LoopFunctionResponse[]): Promise<void> {
    await postApiJson<OperatorLoopAppendFunctionResponsesRequest, OperatorLoopAppendFunctionResponsesResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/append-function-responses',
      { runId, pathId, responses },
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
}