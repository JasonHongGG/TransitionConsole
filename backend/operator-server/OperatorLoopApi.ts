import type { LoopDecision, LoopDecisionInput, LoopFunctionResponse, OperatorLoopAgent } from '../main-server/planned-runner/executor/contracts'
import type {
  OperatorLoopAppendFunctionResponsesRequest,
  OperatorLoopAppendFunctionResponsesResponse,
  OperatorLoopCleanupRunRequest,
  OperatorLoopCleanupRunResponse,
  OperatorLoopDecideRequest,
  OperatorLoopDecideResponse,
  OperatorLoopResetResponse,
} from '../main-server/shared/contracts'

const postJson = async <TRequest extends object, TResponse>(baseUrl: string, path: string, body: TRequest): Promise<TResponse> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`AI server request failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`)
  }

  return payload as TResponse
}

export class OperatorLoopApi implements OperatorLoopAgent {
  private readonly aiBaseUrl: string

  constructor(options?: { aiBaseUrl?: string }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
  }

  async decide(input: LoopDecisionInput): Promise<LoopDecision> {
    return postJson<OperatorLoopDecideRequest, OperatorLoopDecideResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/decide',
      input,
    )
  }

  async appendFunctionResponses(runId: string, pathId: string, responses: LoopFunctionResponse[]): Promise<void> {
    await postJson<OperatorLoopAppendFunctionResponsesRequest, OperatorLoopAppendFunctionResponsesResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/append-function-responses',
      { runId, pathId, responses },
    )
  }

  async cleanupRun(runId: string): Promise<void> {
    await postJson<OperatorLoopCleanupRunRequest, OperatorLoopCleanupRunResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/cleanup-run',
      { runId },
    )
  }

  async resetReplayCursor(): Promise<void> {
    await postJson<Record<string, never>, OperatorLoopResetResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/operator-loop/reset',
      {},
    )
  }
}