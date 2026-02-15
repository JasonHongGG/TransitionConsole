import type { PathPlanner, PathPlannerContext, PlannedPathDraft } from '../planner/plannerProvider/types'
import type { PathPlannerGenerateRequest, PathPlannerGenerateResponse, PathPlannerResetResponse } from '../../shared/contracts'
import { postJson } from './httpClient'

export class HttpPathPlanner implements PathPlanner {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.AI_SERVER_TIMEOUT_MS ?? 120000)
  }

  async generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]> {
    const response = await postJson<PathPlannerGenerateRequest, PathPlannerGenerateResponse>(
      this.aiBaseUrl,
      '/api/ai/path-planner/generate',
      { context },
      this.timeoutMs,
    )

    return Array.isArray(response.paths) ? response.paths : []
  }

  async resetRoundCursor(): Promise<void> {
    await postJson<Record<string, never>, PathPlannerResetResponse>(this.aiBaseUrl, '/api/ai/path-planner/reset', {}, this.timeoutMs)
  }
}
