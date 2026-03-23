import { implementationPromptVariant } from './implementation'
import { exp1MeaningfulPromptVariant } from './experimental/exp1Meaningful'
import { exp2UnwalkedRequiredPromptVariant } from './experimental/exp2UnwalkedRequired'
import { exp3UnwalkedBranchFirstPromptVariant } from './experimental/exp3UnwalkedBranchFirst'
import { exp4UnwalkedLongPathsPromptVariant } from './experimental/exp4UnwalkedLongPaths'
import { exp5JourneyDeepeningPromptVariant } from './experimental/exp5JourneyDeepening'
import { exp6ComprehensivePromptVariant } from './experimental/exp6Comprehensive'
import { exp7RiskFirstPromptVariant } from './experimental/exp7RiskFirst'
import { exp8PortfolioBalancedPromptVariant } from './experimental/exp8PortfolioBalanced'
import { exp9SpecEssentialPathsPromptVariant } from './experimental/exp9SpecEssentialPaths'
import type { PathPlannerPromptBundle } from '../types'

export const PATH_PLANNER_PROMPT_VARIANTS = {
  implementation: implementationPromptVariant,
  exp1_meaningful: exp1MeaningfulPromptVariant,
  exp2_unwalked_required: exp2UnwalkedRequiredPromptVariant,
  exp3_unwalked_branch_first: exp3UnwalkedBranchFirstPromptVariant,
  exp4_unwalked_long_paths: exp4UnwalkedLongPathsPromptVariant,
  exp5_journey_deepening: exp5JourneyDeepeningPromptVariant,
  exp6_comprehensive: exp6ComprehensivePromptVariant,
  exp7_risk_first: exp7RiskFirstPromptVariant,
  exp8_portfolio_balanced: exp8PortfolioBalancedPromptVariant,
  exp9_spec_essential_paths: exp9SpecEssentialPathsPromptVariant,
} as const satisfies Record<string, PathPlannerPromptBundle>
