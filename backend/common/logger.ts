export interface Logger {
  log: (message: string, meta?: Record<string, unknown>) => void
}

const formatTimestamp = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`
}

const print = (
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void => {
  const ts = formatTimestamp(new Date())
  const line = meta
    ? `[${ts}] [${scope}] ${message} ${JSON.stringify(meta)}`
    : `[${ts}] [${scope}] ${message}`

  console.log(line)
}

export const createLogger = (scope: string): Logger => ({
  log: (message, meta) => print(scope, message, meta),
})
