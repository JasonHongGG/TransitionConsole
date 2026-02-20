import fs from 'node:fs'
import path from 'node:path'

const toLegacyCompatiblePath = (input: string): string =>
  input.replace(/(^|[\\/])ai-server([\\/])mock-data([\\/]|$)/i, '$1mock-data$3')

export const resolveMockDir = (configuredDir: string | undefined, agentName: string): string => {
  const cwd = process.cwd()
  const candidates: string[] = []

  const normalizedConfiguredDir = configuredDir?.trim()
  if (normalizedConfiguredDir) {
    candidates.push(path.resolve(cwd, normalizedConfiguredDir))

    const legacyCompatibleDir = toLegacyCompatiblePath(normalizedConfiguredDir)
    if (legacyCompatibleDir !== normalizedConfiguredDir) {
      candidates.push(path.resolve(cwd, legacyCompatibleDir))
    }
  }

  candidates.push(path.resolve(cwd, path.join('mock-data', agentName)))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? path.resolve(cwd, path.join('mock-data', agentName))
}
