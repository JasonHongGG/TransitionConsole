export type PathPlannerPromptBundle = {
  label: string
  description: string
  experimental: boolean
  systemPrompt: string
  userInstruction: string
}

export type PathPlannerPromptVariantSeed = {
  label: string
  description: string
  strategyRules: string[]
  goal: string
  outputRules: string[]
}
