import { resolvePathPlannerPromptVariant } from '../../../ai-server/agents/path-planner/prompt'
import type { PlannerPathSelectionPolicy } from './types'

const DEFAULT_PLANNER_PATH_SELECTION_POLICY: PlannerPathSelectionPolicy = {
  requirePageEntryStart: true,
  requireRequiredEntryState: true,
  prioritizeNewCoverage: true,
  dedupeHistoricalSignatures: true,
}

const EXPERIMENTAL_PLANNER_PATH_SELECTION_POLICY: PlannerPathSelectionPolicy = {
  requirePageEntryStart: false,
  requireRequiredEntryState: false,
  prioritizeNewCoverage: false,
  dedupeHistoricalSignatures: false,
}

export const resolvePlannerPathSelectionPolicy = (): PlannerPathSelectionPolicy => {
  const promptVariant = resolvePathPlannerPromptVariant(process.env.PATH_PLANNER_PROMPT_VARIANT)
  return promptVariant.experimental
    ? EXPERIMENTAL_PLANNER_PATH_SELECTION_POLICY
    : DEFAULT_PLANNER_PATH_SELECTION_POLICY
}
