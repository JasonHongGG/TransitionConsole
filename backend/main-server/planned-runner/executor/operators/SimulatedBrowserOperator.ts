import type { ExecutorContext, OperatorTraceItem, PlannedTransitionStep, StepAssertionSpec, StepExecutionResult, StepNarrativeInstruction, StepValidationResult } from '../../types'
import type { BrowserOperator, BrowserOperatorRunResult } from '../contracts'

export class SimulatedBrowserOperator implements BrowserOperator {
  async run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    _narrative: StepNarrativeInstruction,
    assertions: StepAssertionSpec[],
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

    const validationResults: StepValidationResult[] = assertions.map((assertion) => ({
      id: assertion.id,
      label: assertion.description,
      status: 'pass',
      reason: 'simulated operator assumed pass',
      assertionType: assertion.type,
      expected: assertion.expected,
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
