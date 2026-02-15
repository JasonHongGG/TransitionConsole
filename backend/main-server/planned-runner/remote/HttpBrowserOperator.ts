import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepAssertionSpec,
  StepInstruction,
  StepNarrativeInstruction,
} from '../types'
import type { BrowserOperator } from '../executor/contracts'
import type { OperatorCleanupRunRequest, OperatorStepRunRequest, OperatorStepRunResponse } from '../../shared/contracts'
import { postJson } from './httpClient'

export class HttpBrowserOperator implements BrowserOperator {
  private readonly operatorBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { operatorBaseUrl?: string; timeoutMs?: number }) {
    this.operatorBaseUrl = options?.operatorBaseUrl ?? process.env.OPERATOR_SERVER_BASE_URL ?? 'http://localhost:7082'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.OPERATOR_SERVER_TIMEOUT_MS ?? 120000)
  }

  async run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
    instruction: StepInstruction,
    assertions: StepAssertionSpec[],
  ): Promise<OperatorStepRunResponse> {
    return postJson<OperatorStepRunRequest, OperatorStepRunResponse>(
      this.operatorBaseUrl,
      '/api/operator/step-executor/run',
      {
        step,
        context,
        narrative,
        instruction,
        assertions,
      },
      this.timeoutMs,
    )
  }

  async cleanupRun(runId: string): Promise<void> {
    await postJson<OperatorCleanupRunRequest, { ok: boolean }>(
      this.operatorBaseUrl,
      '/api/operator/step-executor/cleanup-run',
      { runId },
      this.timeoutMs,
    )
  }
}
