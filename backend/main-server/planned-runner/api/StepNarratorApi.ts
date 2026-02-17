import type { ExecutorContext, PlannedTransitionStep, StepNarrativeInstruction } from '../types'
import type { StepNarrator } from '../executor/contracts'
import type { StepNarratorGenerateRequest, StepNarratorGenerateResponse, StepNarratorResetResponse } from '../../shared/contracts'
import { postApiJson } from './apiClient'

export class StepNarratorApi implements StepNarrator {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.STEP_NARRATOR_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  private buildGenerateRequest(step: PlannedTransitionStep, context: ExecutorContext): StepNarratorGenerateRequest {
    return {
      step: {
        edgeId: step.edgeId,
        from: {
          stateId: step.fromStateId,
          diagramId: step.fromDiagramId,
        },
        to: {
          stateId: step.toStateId,
          diagramId: step.toDiagramId,
        },
        summary: step.label,
        semanticGoal: step.semantic,
      },
      context: {
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        targetUrl: context.targetUrl,
        specRaw: context.specRaw ?? '',
        diagrams: context.systemDiagrams.map((diagram) => ({
          id: diagram.id,
          name: diagram.name,
          level: diagram.level ?? 'unknown',
          parentDiagramId: diagram.parentDiagramId ?? null,
          roles: diagram.roles ?? [],
          variant: {
            kind: diagram.variant?.kind ?? 'standalone',
            baseDiagramId: diagram.variant?.baseDiagramId ?? null,
            deltaDiagramIdsByRole: diagram.variant?.deltaDiagramIdsByRole ?? {},
            appliesToRoles: diagram.variant?.appliesToRoles ?? [],
          },
          states: diagram.states.map((state) => ({
            id: state.id,
            walked: false,
          })),
          transitions: diagram.transitions.map((transition) => ({
            id: transition.id,
            from: transition.from,
            to: transition.to,
            walked: false,
            validations: transition.validations,
            intent: {
              summary: transition.intent?.summary ?? null,
            },
          })),
          connectors: diagram.connectors.map((connector) => ({
            id: connector.id,
            type: connector.type,
            from: {
              diagramId: connector.from.diagramId,
              stateId: connector.from.stateId,
            },
            to: {
              diagramId: connector.to.diagramId,
              stateId: connector.to.stateId,
            },
            meta: {
              reason: connector.meta?.reason ?? null,
              action: connector.meta?.action ?? null,
              validations: connector.meta?.validations ?? [],
            },
          })),
          meta: {
            pageName: diagram.meta?.pageName ?? null,
            featureName: diagram.meta?.featureName ?? null,
            entryStateId: diagram.meta?.entryStateId ?? null,
            entryValidations: Array.isArray(diagram.meta?.entryValidations)
              ? diagram.meta.entryValidations.filter((item): item is string => typeof item === 'string')
              : [],
          },
        })),
      },
    }
  }

  async generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction> {
    const request = this.buildGenerateRequest(step, context)
    const response = await postApiJson<StepNarratorGenerateRequest, StepNarratorGenerateResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/step-narrator/generate',
      request,
      this.timeoutMs,
    )

    return response.narrative
  }

  async resetReplayCursor(): Promise<void> {
    await postApiJson<Record<string, never>, StepNarratorResetResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/step-narrator/reset',
      {},
      this.timeoutMs,
    )
  }
}
