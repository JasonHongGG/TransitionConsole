export const extractJsonPayload = <T>(rawContent: string): T | null => {
  const trimmed = rawContent.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
