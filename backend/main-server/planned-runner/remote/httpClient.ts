export class HttpServiceError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `HTTP service error: ${status}`)
    this.status = status
    this.payload = payload
  }
}

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

export const postJson = async <TRequest extends object, TResponse>(
  baseUrl: string,
  path: string,
  body: TRequest,
  timeoutMs = 120000,
): Promise<TResponse> => {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

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

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new HttpServiceError(response.status, payload, `Request failed: ${response.status} ${response.statusText}`)
  }

  return payload as TResponse
}
