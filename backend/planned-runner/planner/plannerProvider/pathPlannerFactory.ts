import { createLogger } from '../common/logger'
import { CopilotPathPlanner } from './copilotPathPlanner'
import { MockReplayPathPlanner } from './mockReplayPathPlanner'
import type { PathPlanner } from './types'

const log = createLogger('path-planner-factory')

const normalizeProvider = (value: string | undefined): 'copilot' | 'mock-replay' => {
  const normalized = (value ?? 'copilot').trim().toLowerCase()
  return normalized === 'mock-replay' ? 'mock-replay' : 'copilot'
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

export const createPathPlanner = (): PathPlanner => {
  const provider = normalizeProvider(process.env.PATH_PLANNER_PROVIDER)

  if (provider === 'mock-replay') {
    const planner = new MockReplayPathPlanner({
      mockDir: process.env.PATH_PLANNER_MOCK_DIR,
      loop: parseBoolean(process.env.PATH_PLANNER_MOCK_LOOP, true),
    })

    log.log('using mock-replay planner provider', {
      provider,
      mockDir: process.env.PATH_PLANNER_MOCK_DIR ?? 'mock-data/path-planner',
      loop: parseBoolean(process.env.PATH_PLANNER_MOCK_LOOP, true),
    })

    return planner
  }

  log.log('using copilot planner provider', {
    provider,
    model: process.env.COPILOT_MODEL ?? 'gpt-5',
  })

  return new CopilotPathPlanner()
}

export const shouldResetPlannerCursorOnStart = (): boolean =>
  parseBoolean(process.env.PATH_PLANNER_MOCK_RESET_ON_START, true)
