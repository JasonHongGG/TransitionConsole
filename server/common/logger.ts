export interface Logger {
  log: (message: string, meta?: Record<string, unknown>) => void
}

const IMPORTANT_META_KEYS = [
  'runId',
  'pathId',
  'stepId',
  'edgeId',
  'result',
  'error',
  'model',
  'eventType',
  'completed',
  'totalPaths',
  'replanCount',
  'currentPathId',
  'currentStepId',
  'targetUrl',
] as const

const MAX_STRING_LENGTH = 96

const formatTimestamp = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`
}

const toCompactValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return null

  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim()
    return compact.length > MAX_STRING_LENGTH ? `${compact.slice(0, MAX_STRING_LENGTH)}...` : compact
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return `[array:${value.length}]`
  }

  return '[object]'
}

const pickImportantMeta = (meta?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!meta) return undefined

  const selectedEntries = IMPORTANT_META_KEYS
    .filter((key) => key in meta)
    .map((key) => [key, toCompactValue(meta[key])] as const)

  if (selectedEntries.length > 0) {
    return Object.fromEntries(selectedEntries)
  }

  const fallbackEntries = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .slice(0, 3)
    .map(([key, value]) => [key, toCompactValue(value)] as const)

  if (fallbackEntries.length === 0) return undefined
  return Object.fromEntries(fallbackEntries)
}

const print = (
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void => {
  const ts = formatTimestamp(new Date())
  const pickedMeta = pickImportantMeta(meta)
  const line = pickedMeta
    ? `[${ts}] [${scope}] ${message} ${JSON.stringify(pickedMeta)}`
    : `[${ts}] [${scope}] ${message}`

  console.log(line)
}

export const createLogger = (scope: string): Logger => ({
  log: (message, meta) => print(scope, message, meta),
})
