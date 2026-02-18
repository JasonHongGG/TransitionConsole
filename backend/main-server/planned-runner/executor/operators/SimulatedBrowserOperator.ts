import type { ExecutorContext, OperatorTraceItem, PlannedTransitionStep, StepValidationSpec, StepNarrativeInstruction, StepValidationResult } from '../../types'
import type { BrowserOperator, BrowserOperatorRunResult } from '../contracts'

export class SimulatedBrowserOperator implements BrowserOperator {
  async run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    _narrative: StepNarrativeInstruction,
    validations: StepValidationSpec[],
  ): Promise<BrowserOperatorRunResult> {
    const trace: OperatorTraceItem[] = []
    for (let i = 1; i <= 3; i += 1) {
      trace.push({
        iteration: i,
        observation: `targetUrl=${context.targetUrl}`,
        action: 'function_call:simulated',
        outcome: 'success',
        detail: `simulated-operator iteration ${i}`,
      })
    }

    const validationResults: StepValidationResult[] = validations.map((validation) => ({
      id: validation.id,
      label: validation.description,
      status: 'pass',
      reason: 'simulated operator assumed pass',
      validationType: validation.type,
      expected: validation.expected,
      actual: 'observed (simulated)',
    }))

    return {
      result: 'pass',
      validationResults,
      trace,
      evidence: {
        domSummary: `simulated-dom: reached ${step.toStateId}`,
        networkSummary: 'simulated-network: no captured requests',
      },
    }
  }
}
