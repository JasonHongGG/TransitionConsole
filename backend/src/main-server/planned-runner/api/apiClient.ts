import { createLogger } from '../../../common/logger'

export class ApiServiceError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `HTTP service error: ${status}`)
    this.status = status
    this.payload = payload
  }
}

const log = createLogger('planned-runner-api-client')

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (timeoutMs <= 0) return promise

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`HTTP request timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const postApiJson = async <TRequest extends object, TResponse>(
  baseUrl: string,
  path: string,
  body: TRequest,
  timeoutMs = 120000,
): Promise<TResponse> => {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const startedAt = Date.now()
  const bodyRecord = body as Record<string, unknown>
  const context = (bodyRecord.context as Record<string, unknown> | undefined) ?? undefined

  log.log('api request start', {
    path: normalizedPath,
    timeoutMs,
    runId: (bodyRecord.runId as string | undefined) ?? (context?.runId as string | undefined),
    pathId: (bodyRecord.pathId as string | undefined) ?? (context?.pathId as string | undefined),
    stepId: (bodyRecord.stepId as string | undefined) ?? (context?.stepId as string | undefined),
  })

  const response = await withTimeout(
    fetch(`${normalizedBase}${normalizedPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    timeoutMs,
  )

  const durationMs = Date.now() - startedAt
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    log.log('api request failed', {
      path: normalizedPath,
      durationMs,
      status: response.status,
      error: response.statusText,
      runId: (bodyRecord.runId as string | undefined) ?? (context?.runId as string | undefined),
      pathId: (bodyRecord.pathId as string | undefined) ?? (context?.pathId as string | undefined),
      stepId: (bodyRecord.stepId as string | undefined) ?? (context?.stepId as string | undefined),
    })
    throw new ApiServiceError(response.status, payload, `Request failed: ${response.status} ${response.statusText}`)
  }

  log.log('api request completed', {
    path: normalizedPath,
    durationMs,
    status: response.status,
    runId: (bodyRecord.runId as string | undefined) ?? (context?.runId as string | undefined),
    pathId: (bodyRecord.pathId as string | undefined) ?? (context?.pathId as string | undefined),
    stepId: (bodyRecord.stepId as string | undefined) ?? (context?.stepId as string | undefined),
  })

  return payload as TResponse
}
