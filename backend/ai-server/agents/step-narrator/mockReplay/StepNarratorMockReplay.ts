import path from 'node:path'
import { createLogger } from '../../../../common/logger'
import type { StepNarrativeInstruction } from '../../../../../main-server/planned-runner/types'
import { loadStepNarratorMockReplayItems, type StepNarratorMockReplayItem } from './stepNarratorMockReplayReader'

const log = createLogger('mock-replay-step-narrator')

interface StepNarratorMockReplayOptions {
  mockDir?: string
  loop?: boolean
}

export class StepNarratorMockReplay {
  private readonly mockDir: string
  private readonly loop: boolean
  private cursor = 0
  private items: StepNarratorMockReplayItem[] = []

  constructor(options: StepNarratorMockReplayOptions = {}) {
    this.mockDir = path.resolve(process.cwd(), options.mockDir ?? path.join('ai-server', 'mock-data', 'step-narrator'))
    this.loop = options.loop ?? true

    log.log('initialized', {
      mockDir: this.mockDir,
      loop: this.loop,
    })
  }

  async resetRoundCursor(): Promise<void> {
    this.items = await loadStepNarratorMockReplayItems(this.mockDir)
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

  private consumeNextItem(): StepNarratorMockReplayItem {
    if (this.items.length === 0) {
      throw new Error(`No mock step narrator JSON files found in ${this.mockDir}`)
    }

    if (this.cursor >= this.items.length) {
      if (!this.loop) {
        throw new Error(`Mock step narrator files exhausted at ${this.mockDir}`)
      }
      this.cursor = 0
    }

    const item = this.items[this.cursor]
    this.cursor += 1
    return item
  }

  async generateNarrative(): Promise<StepNarrativeInstruction> {
    await this.ensureItemsLoaded()

    const item = this.consumeNextItem()
    if (!item.narrative) {
      throw new Error(`Mock step narrator file contains no valid parsedResponse.narrative: ${item.fileName}`)
    }

    log.log('replaying step narrator response', {
      fileName: item.fileName,
      cursor: this.cursor,
      totalMockFiles: this.items.length,
    })

    return item.narrative
  }
}