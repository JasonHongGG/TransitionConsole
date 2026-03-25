import { exp10LongPathScenarioPromptVariant } from './experimental/exp10LongPathScenario'
import { exp11LongPathRiskPromptVariant } from './experimental/exp11LongPathRisk'
import { exp12ScenarioRiskPromptVariant } from './experimental/exp12ScenarioRisk'
import { exp13NewFeatureLongPathScenarioPromptVariant } from './experimental/exp13NewFeatureLongPathScenario'
import { exp14NewFeatureLongPathRiskPromptVariant } from './experimental/exp14NewFeatureLongPathRisk'
import { exp15NewFeatureScenarioRiskPromptVariant } from './experimental/exp15NewFeatureScenarioRisk'
import { exp16LongPathScenarioRiskPromptVariant } from './experimental/exp16LongPathScenarioRisk'
import { exp17AllPrioritiesPromptVariant } from './experimental/exp17AllPriorities'
import { exp1BaselinePromptVariant } from './experimental/exp1Baseline'
import { exp2CoverageFirstPromptVariant } from './experimental/exp2CoverageFirst'
import { exp3NewFeatureFirstPromptVariant } from './experimental/exp3NewFeatureFirst'
import { exp4LongPathFirstPromptVariant } from './experimental/exp4LongPathFirst'
import { exp5ScenarioFirstPromptVariant } from './experimental/exp5ScenarioFirst'
import { exp6RiskFirstPromptVariant } from './experimental/exp6RiskFirst'
import { exp7NewFeatureLongPathPromptVariant } from './experimental/exp7NewFeatureLongPath'
import { exp8NewFeatureScenarioPromptVariant } from './experimental/exp8NewFeatureScenario'
import { exp9NewFeatureRiskPromptVariant } from './experimental/exp9NewFeatureRisk'
import { implementationPromptVariant } from './implementation'
import type { PathPlannerPromptBundle } from '../types'

export const PATH_PLANNER_PROMPT_VARIANTS = {
  implementation: implementationPromptVariant,
  exp1_baseline: exp1BaselinePromptVariant,
  exp2_coverage_first: exp2CoverageFirstPromptVariant,
  exp3_new_feature_first: exp3NewFeatureFirstPromptVariant,
  exp4_long_path_first: exp4LongPathFirstPromptVariant,
  exp5_scenario_first: exp5ScenarioFirstPromptVariant,
  exp6_risk_first: exp6RiskFirstPromptVariant,
  exp7_new_feature_long_path: exp7NewFeatureLongPathPromptVariant,
  exp8_new_feature_scenario: exp8NewFeatureScenarioPromptVariant,
  exp9_new_feature_risk: exp9NewFeatureRiskPromptVariant,
  exp10_long_path_scenario: exp10LongPathScenarioPromptVariant,
  exp11_long_path_risk: exp11LongPathRiskPromptVariant,
  exp12_scenario_risk: exp12ScenarioRiskPromptVariant,
  exp13_new_feature_long_path_scenario: exp13NewFeatureLongPathScenarioPromptVariant,
  exp14_new_feature_long_path_risk: exp14NewFeatureLongPathRiskPromptVariant,
  exp15_new_feature_scenario_risk: exp15NewFeatureScenarioRiskPromptVariant,
  exp16_long_path_scenario_risk: exp16LongPathScenarioRiskPromptVariant,
  exp17_all_priorities: exp17AllPrioritiesPromptVariant,
} as const satisfies Record<string, PathPlannerPromptBundle>
