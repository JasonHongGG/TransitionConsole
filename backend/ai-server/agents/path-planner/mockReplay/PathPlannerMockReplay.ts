import path from 'node:path'
import { createLogger } from '../../../../common/logger'
import type { PathPlannerContext, PlannedPathDraft } from '../../../../../main-server/planned-runner/planner/plannerProvider/types'
import { loadPathPlannerMockReplayItems, type PathPlannerMockReplayItem } from './pathPlannerMockReplayReader'

const log = createLogger('mock-replay-path-planner')

interface PathPlannerMockReplayOptions {
  mockDir?: string
  loop?: boolean
}

export class PathPlannerMockReplay {
  private readonly mockDir: string
  private readonly loop: boolean
  private cursor = 0
  private items: PathPlannerMockReplayItem[] = []

  constructor(options: PathPlannerMockReplayOptions = {}) {
    this.mockDir = path.resolve(process.cwd(), options.mockDir ?? path.join('ai-server', 'mock-data', 'path-planner'))
    this.loop = options.loop ?? true

    log.log('initialized', {
      mockDir: this.mockDir,
      loop: this.loop,
    })
  }

  async resetRoundCursor(): Promise<void> {
    this.items = await loadPathPlannerMockReplayItems(this.mockDir)
    this.cursor = 0

    log.log('round cursor reset', {
      mockDir: this.mockDir,
      totalMockFiles: this.items.length,
    })
  }

  private async ensureItemsLoaded(): Promise<void> {
    if (this.items.length > 0) return
    await this.resetRoundCursor()
  }

  private consumeNextItem(): PathPlannerMockReplayItem {
    if (this.items.length === 0) {
      throw new Error(`No mock planner JSON files found in ${this.mockDir}`)
    }

    if (this.cursor >= this.items.length) {
      if (!this.loop) {
        throw new Error(`Mock planner files exhausted at ${this.mockDir}`)
      }
      this.cursor = 0
    }

    const item = this.items[this.cursor]
    this.cursor += 1
    return item
  }

  async generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]> {
    await this.ensureItemsLoaded()

    const item = this.consumeNextItem()
    if (item.parsedPathsCount === 0) {
      throw new Error(`Mock planner file contains no valid paths: ${item.fileName}`)
    }

    log.log('replaying planner response', {
      fileName: item.fileName,
      createdAt: item.createdAt,
      parsedPathsCount: item.parsedPathsCount,
      cursor: this.cursor,
      totalMockFiles: this.items.length,
      requestedMaxPaths: context.maxPaths,
      diagrams: context.context.diagrams.length,
      hasSpec: Boolean(context.context.specRaw),
      targetUrl: context.context.targetUrl,
    })

    return item.drafts.slice(0, context.maxPaths)
  }
}