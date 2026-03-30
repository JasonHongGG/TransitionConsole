import type {
  ExecutorContext,
  StepNarrativeInstruction,
  PlannedTransitionPath,
} from '../types'
import type { BrowserOperator } from '../executor/contracts'
import type {
  OperatorCleanupPathRequest,
  OperatorCleanupRunRequest,
  OperatorInterruptRunRequest,
  OperatorPathRunRequest,
  OperatorPathRunResponse,
  OperatorRequestStopRequest,
  OperatorResetReplayResponse,
} from '../../../operator-server/type'
import { servicePorts, toLocalBaseUrl } from '../../../common/network'
import { postApiJson } from './apiClient'

export class BrowserOperatorApi implements BrowserOperator {
  private readonly operatorBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { operatorBaseUrl?: string; timeoutMs?: number }) {
    this.operatorBaseUrl = options?.operatorBaseUrl ?? toLocalBaseUrl(servicePorts.operatorServer)
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  async runPath(
    path: PlannedTransitionPath,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
  ): Promise<OperatorPathRunResponse> {
    return postApiJson<OperatorPathRunRequest, OperatorPathRunResponse>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/run',
      {
        path,
        context,
        narrative,
      },
      this.timeoutMs,
    )
  }

  async cleanupRun(runId: string): Promise<void> {
    await postApiJson<OperatorCleanupRunRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/cleanup-run',
      { runId },
      this.timeoutMs,
    )
  }

  async requestStop(runId: string, pathExecutionId?: string): Promise<void> {
    await postApiJson<OperatorRequestStopRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/request-stop',
      { runId, pathExecutionId },
      this.timeoutMs,
    )
  }

  async interruptRun(runId: string, reason: 'reset'): Promise<void> {
    await postApiJson<OperatorInterruptRunRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/interrupt-run',
      { runId, reason },
      this.timeoutMs,
    )
  }

  async cleanupPath(runId: string, pathExecutionId: string, pathId: string): Promise<void> {
    await postApiJson<OperatorCleanupPathRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/cleanup-path',
      { runId, pathExecutionId, pathId },
      this.timeoutMs,
    )
  }

  async resetReplayCursor(): Promise<void> {
    await postApiJson<Record<string, never>, OperatorResetReplayResponse>(
      this.operatorBaseUrl,
      '/api/operator/path-executor/reset-replay',
      {},
      this.timeoutMs,
    )
  }
}
