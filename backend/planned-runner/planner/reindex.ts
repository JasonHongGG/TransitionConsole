import type { PlannedTransitionPath } from '../types'

export const withReindexedPaths = (paths: PlannedTransitionPath[], startOrdinal: number): PlannedTransitionPath[] => {
  return paths.map((path, index) => {
    const ordinal = startOrdinal + index
    return {
      ...path,
      id: `path.${ordinal}`,
      name: `Path ${ordinal}`,
    }
  })
}
