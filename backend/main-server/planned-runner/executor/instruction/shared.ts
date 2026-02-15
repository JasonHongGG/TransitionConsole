export const extractJsonPayload = (rawContent: string): unknown | null => {
  const trimmed = rawContent.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    return null
  }
}
