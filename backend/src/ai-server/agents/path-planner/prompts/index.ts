import { PATH_PLANNER_PROMPT_VARIANT_ALIASES } from './aliases'
import { PATH_PLANNER_PROMPT_VARIANTS } from './variants'

export type { PathPlannerPromptBundle } from './types'

export type PathPlannerPromptVariantId = keyof typeof PATH_PLANNER_PROMPT_VARIANTS

export type PathPlannerPromptVariant = {
  id: PathPlannerPromptVariantId
} & (typeof PATH_PLANNER_PROMPT_VARIANTS)[PathPlannerPromptVariantId]

export const PATH_PLANNER_DEFAULT_PROMPT_VARIANT: PathPlannerPromptVariantId = 'implementation'

export const resolvePathPlannerPromptVariant = (value?: string): PathPlannerPromptVariant => {
  const normalized = value?.trim().toLowerCase() ?? ''
  const variantId = PATH_PLANNER_PROMPT_VARIANT_ALIASES[normalized] ?? PATH_PLANNER_DEFAULT_PROMPT_VARIANT
  const variant = PATH_PLANNER_PROMPT_VARIANTS[variantId]

  return {
    id: variantId,
    ...variant,
  }
}

export const PATH_PLANNER_SYSTEM_PROMPT = PATH_PLANNER_PROMPT_VARIANTS[PATH_PLANNER_DEFAULT_PROMPT_VARIANT].systemPrompt

export const PATH_PLANNER_USER_INSTRUCTION = PATH_PLANNER_PROMPT_VARIANTS[PATH_PLANNER_DEFAULT_PROMPT_VARIANT].userInstruction

export { PATH_PLANNER_PROMPT_VARIANTS }