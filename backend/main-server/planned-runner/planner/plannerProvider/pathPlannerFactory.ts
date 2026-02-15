const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

export const shouldResetPlannerCursorOnStart = (): boolean =>
  parseBoolean(process.env.PATH_PLANNER_MOCK_RESET_ON_START, true)
