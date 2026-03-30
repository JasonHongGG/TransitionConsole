import {
  COMMON_HARD_RULES,
  COMMON_OUTPUT_RULES,
  DEFAULT_USER_INSTRUCTION,
  PATH_PLANNER_INPUT_SCHEMA,
  PATH_PLANNER_NAMING_ALIGNMENT,
  PATH_PLANNER_OUTPUT_SCHEMA,
  PATH_PLANNER_ROLE,
  PRODUCTION_START_RULE,
} from './shared'
import type { PathPlannerPromptBundle, PathPlannerPromptVariantSeed } from './types'

const toNumberedList = (items: string[]): string => items.map((item, index) => `${index + 1}. ${item}`).join('\n')

const buildPrompt = (options: {
  hardRules: string[]
  strategyRules: string[]
  goal: string
  outputRules: string[]
}): string => {
  return [
    `【系統角色】\n${PATH_PLANNER_ROLE}`,
    `【核心限制】\n${toNumberedList(options.hardRules)}`,
    `【策略重點】\n${toNumberedList(options.strategyRules)}`,
    `【目標】\n${options.goal}`,
    `【跨 Agent 命名對齊規範】\n${PATH_PLANNER_NAMING_ALIGNMENT}`,
    `【結構化輸入 JSON Schema】\n${PATH_PLANNER_INPUT_SCHEMA}`,
    `【結構化輸出 JSON Schema】\n${PATH_PLANNER_OUTPUT_SCHEMA}`,
    `【輸出補充要求】\n${toNumberedList(options.outputRules)}`,
  ].join('\n\n')
}

const createPromptVariant = (options: {
  label: string
  description: string
  experimental: boolean
  hardRules: string[]
  strategyRules: string[]
  goal: string
  outputRules: string[]
}): PathPlannerPromptBundle => ({
  label: options.label,
  description: options.description,
  experimental: options.experimental,
  systemPrompt: buildPrompt({
    hardRules: options.hardRules,
    strategyRules: options.strategyRules,
    goal: options.goal,
    outputRules: options.outputRules,
  }),
  userInstruction: DEFAULT_USER_INSTRUCTION,
})

export const createProductionVariant = (seed: PathPlannerPromptVariantSeed): PathPlannerPromptBundle => {
  return createPromptVariant({
    label: seed.label,
    description: seed.description,
    experimental: false,
    hardRules: [...COMMON_HARD_RULES, PRODUCTION_START_RULE],
    strategyRules: seed.strategyRules,
    goal: seed.goal,
    outputRules: [...COMMON_OUTPUT_RULES, ...seed.outputRules],
  })
}

export const createExperimentalVariant = (seed: PathPlannerPromptVariantSeed): PathPlannerPromptBundle => {
  return createPromptVariant({
    label: seed.label,
    description: seed.description,
    experimental: true,
    hardRules: [...COMMON_HARD_RULES, PRODUCTION_START_RULE],
    strategyRules: seed.strategyRules,
    goal: seed.goal,
    outputRules: [...COMMON_OUTPUT_RULES, ...seed.outputRules],
  })
}
