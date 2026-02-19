import type { PathPlannerContext, PlannedPathDraft } from '../../../main-server/planned-runner/planner/types'
import type { AiRuntime } from '../../runtime/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { PathPlannerAgent } from '../types'
import { PATH_PLANNER_SYSTEM_PROMPT, PATH_PLANNER_USER_INSTRUCTION } from './prompt'
import { PathPlannerMockReplay } from './mockReplay/PathPlannerMockReplay'

type PathPlannerEnvelope = {
  paths?: Array<{
    pathId?: string
    name?: string
    pathName?: string
    semanticGoal?: string
    edgeIds?: string[]
  }>
}

export class DefaultPathPlannerAgent implements PathPlannerAgent {
  private readonly runtime: AiRuntime
  private readonly mockReplayPlanner: PathPlannerMockReplay
  private readonly useMockReplay: boolean
  private readonly model: string
  private readonly timeoutMs: number

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.useMockReplay = (process.env.PATH_PLANNER_PROVIDER ?? 'llm').trim().toLowerCase() === 'mock-replay'
    this.mockReplayPlanner = new PathPlannerMockReplay({
      mockDir: process.env.PATH_PLANNER_MOCK_DIR,
      loop: (process.env.PATH_PLANNER_MOCK_LOOP ?? 'true').trim().toLowerCase() !== 'false',
    })
  }

  async generate(context: PathPlannerContext): Promise<PlannedPathDraft[]> {
    if (this.useMockReplay) {
      const drafts = await this.mockReplayPlanner.generatePaths(context)
      await writeAgentResponseLog({
        agent: 'path-planner',
        model: this.model,
        mode: 'mock-replay',
        runId: context.context.runId,
        pathId: context.context.pathId,
        stepId: context.context.stepId ?? undefined,
        request: context,
        parsedResponse: { paths: drafts },
      })
      return drafts
    }

    const payload = {
      maxPaths: context.maxPaths,
      context: {
        runId: context.context.runId,
        pathId: context.context.pathId,
        stepId: context.context.stepId ?? null,
        targetUrl: context.context.targetUrl ?? '',
        specRaw: context.context.specRaw ?? '',
        diagrams: context.context.diagrams,
      },
      previouslyPlannedPaths: context.previouslyPlannedPaths,
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: PATH_PLANNER_SYSTEM_PROMPT,
      prompt: `${PATH_PLANNER_USER_INSTRUCTION}\n${JSON.stringify(payload)}`,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<PathPlannerEnvelope>(content)
    const drafts = parsed?.paths ?? []

    const normalizedDrafts = drafts
      .map((draft) => ({
        pathId: draft.pathId?.trim() || undefined,
        name: draft.pathName?.trim() || draft.name?.trim() || undefined,
        semanticGoal: draft.semanticGoal?.trim() || undefined,
        edgeIds: (draft.edgeIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
      }))
      .filter((draft) => draft.edgeIds.length > 0)
      .slice(0, context.maxPaths)

    await writeAgentResponseLog({
      agent: 'path-planner',
      model: this.model,
      runId: context.context.runId,
      pathId: context.context.pathId,
      stepId: context.context.stepId ?? undefined,
      request: payload,
      rawResponse: content,
      parsedResponse: { paths: normalizedDrafts },
    })

    return normalizedDrafts
  }

  async reset(): Promise<void> {
    if (this.useMockReplay) {
      await this.mockReplayPlanner.resetRoundCursor()
    }
  }
}
