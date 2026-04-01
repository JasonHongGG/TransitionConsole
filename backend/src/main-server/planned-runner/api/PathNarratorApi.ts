import type { ExecutorContext, PlannedTransitionPath, StepNarrativeInstruction } from '../types'
import type { PathNarrator } from '../executor/contracts'
import type { PathNarratorGenerateRequest, PathNarratorGenerateResponse, PathNarratorResetResponse } from '../../type/contracts'
import { servicePorts, toLocalBaseUrl } from '../../../common/network'
import { postApiJson } from './apiClient'

export class PathNarratorApi implements PathNarrator {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? toLocalBaseUrl(servicePorts.aiServer)
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.PATH_NARRATOR_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  private buildGenerateRequest(path: PlannedTransitionPath, context: ExecutorContext): PathNarratorGenerateRequest {
    return {
      path: {
        id: path.id,
        name: path.name,
        semanticGoal: path.semanticGoal,
        actorHint: path.actorHint,
        steps: path.steps.map((step) => ({
          id: step.id,
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
          validations: step.validations,
        })),
      },
      context: {
        runId: context.runId,
        pathId: context.pathId,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        agentMode: context.agentModes.pathNarrator,
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
            validations: transition.validations ?? [],
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
            validations: connector.validations ?? [],
            meta: {
              reason: connector.meta?.reason ?? null,
              action: connector.meta?.action ?? null,
            },
          })),
          meta: {
            pageName: diagram.meta?.pageName ?? null,
            featureName: diagram.meta?.featureName ?? null,
            entryStateId: diagram.meta?.entryStateId ?? null,
            entryValidations: diagram.meta?.entryValidations ?? [],
          },
        })),
      },
    }
  }

  async generate(path: PlannedTransitionPath, context: ExecutorContext): Promise<StepNarrativeInstruction> {
    const request = this.buildGenerateRequest(path, context)
    const response = await postApiJson<PathNarratorGenerateRequest, PathNarratorGenerateResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/path-narrator/generate',
      request,
      this.timeoutMs,
    )

    return response.narrative
  }

  async resetReplayCursor(): Promise<void> {
    await postApiJson<Record<string, never>, PathNarratorResetResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/path-narrator/reset',
      {},
      this.timeoutMs,
    )
  }
}