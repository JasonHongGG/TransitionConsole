import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepValidationSpec,
  StepNarrativeInstruction,
} from '../types'
import type { BrowserOperator } from '../executor/contracts'
import type {
  OperatorCleanupRunRequest,
  OperatorResetReplayResponse,
  OperatorStepRunRequest,
  OperatorStepRunResponse,
} from '../../../operator-server/type'
import { postApiJson } from './apiClient'

export class BrowserOperatorApi implements BrowserOperator {
  private readonly operatorBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { operatorBaseUrl?: string; timeoutMs?: number }) {
    this.operatorBaseUrl = options?.operatorBaseUrl ?? process.env.OPERATOR_SERVER_BASE_URL ?? 'http://localhost:7082'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.OPERATOR_LOOP_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  async run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
    validations: StepValidationSpec[],
  ): Promise<OperatorStepRunResponse> {
    return postApiJson<OperatorStepRunRequest, OperatorStepRunResponse>(
      this.operatorBaseUrl,
      '/api/operator/step-executor/run',
      {
        step,
        context,
        narrative,
        validations,
      },
      this.timeoutMs,
    )
  }

  async cleanupRun(runId: string): Promise<void> {
    await postApiJson<OperatorCleanupRunRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/step-executor/cleanup-run',
      { runId },
      this.timeoutMs,
    )
  }

  async resetReplayCursor(): Promise<void> {
    await postApiJson<Record<string, never>, OperatorResetReplayResponse>(
      this.operatorBaseUrl,
      '/api/operator/step-executor/reset-replay',
      {},
      this.timeoutMs,
    )
  }
}
