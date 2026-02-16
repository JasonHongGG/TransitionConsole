import path from 'node:path'
import { createLogger } from '../../../../common/logger'
import type { LoopDecision } from '../../../../../main-server/planned-runner/executor/contracts'
import { loadOperatorLoopMockReplayItems, type OperatorLoopMockReplayItem } from './operatorLoopMockReplayReader'

const log = createLogger('mock-replay-operator-loop')

interface OperatorLoopMockReplayOptions {
  mockDir?: string
  loop?: boolean
}

export class OperatorLoopMockReplay {
  private readonly mockDir: string
  private readonly loop: boolean
  private cursor = 0
  private items: OperatorLoopMockReplayItem[] = []

  constructor(options: OperatorLoopMockReplayOptions = {}) {
    this.mockDir = path.resolve(process.cwd(), options.mockDir ?? path.join('ai-server', 'mock-data', 'operator-loop'))
    this.loop = options.loop ?? true

    log.log('initialized', {
      mockDir: this.mockDir,
      loop: this.loop,
    })
  }

  async resetRoundCursor(): Promise<void> {
    this.items = await loadOperatorLoopMockReplayItems(this.mockDir)
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

  private consumeNextItem(): OperatorLoopMockReplayItem {
    if (this.items.length === 0) {
      throw new Error(`No mock operator-loop JSON files found in ${this.mockDir}`)
    }

    if (this.cursor >= this.items.length) {
      if (!this.loop) {
        throw new Error(`Mock operator-loop files exhausted at ${this.mockDir}`)
      }
      this.cursor = 0
    }

    const item = this.items[this.cursor]
    this.cursor += 1
    return item
  }

  async decide(): Promise<LoopDecision> {
    await this.ensureItemsLoaded()

    const item = this.consumeNextItem()
    if (!item.decision) {
      throw new Error(`Mock operator-loop file contains no valid parsedResponse decision: ${item.fileName}`)
    }

    log.log('replaying operator-loop response', {
      fileName: item.fileName,
      cursor: this.cursor,
      totalMockFiles: this.items.length,
      decisionKind: item.decision.kind,
    })

    return item.decision
  }
}