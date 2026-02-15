import type { ExecutorContext, PlannedTransitionStep, StepNarrativeInstruction } from '../types'
import type { StepNarrator } from '../executor/contracts'
import type { StepNarratorGenerateRequest, StepNarratorGenerateResponse } from '../../shared/contracts'
import { postJson } from './httpClient'

export class HttpStepNarrator implements StepNarrator {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.AI_SERVER_TIMEOUT_MS ?? 120000)
  }

  async generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction> {
    const response = await postJson<StepNarratorGenerateRequest, StepNarratorGenerateResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/step-narrator/generate',
      { step, context },
      this.timeoutMs,
    )

    return response.narrative
  }
}
