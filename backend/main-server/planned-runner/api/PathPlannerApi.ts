import type { PathPlanner, PathPlannerContext, PlannedPathDraft } from '../planner/types'
import type { PathPlannerGenerateRequest, PathPlannerGenerateResponse, PathPlannerResetResponse } from '../../type/contracts'
import { postApiJson } from './apiClient'

export class PathPlannerApi implements PathPlanner {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.PATH_PLANNER_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  async generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]> {
    const response = await postApiJson<PathPlannerGenerateRequest, PathPlannerGenerateResponse>(
      this.aiBaseUrl,
      '/api/ai/path-planner/generate',
      { context },
      this.timeoutMs,
    )

    return Array.isArray(response.paths) ? response.paths : []
  }

  async resetRoundCursor(): Promise<void> {
    await postApiJson<Record<string, never>, PathPlannerResetResponse>(this.aiBaseUrl, '/api/ai/path-planner/reset', {}, this.timeoutMs)
  }
}
