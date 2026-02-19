import type { PlannedLiveEvent, PlannedLiveEventInput } from '../types'

type Listener = (event: PlannedLiveEvent) => void

export class PlannedLiveEventBus {
  private readonly listeners = new Set<Listener>()
  private readonly seqByRun = new Map<string, number>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(input: PlannedLiveEventInput): PlannedLiveEvent {
    const runKey = input.runId ?? '__global__'
    const nextSeq = (this.seqByRun.get(runKey) ?? 0) + 1
    this.seqByRun.set(runKey, nextSeq)

    const event: PlannedLiveEvent = {
      ...input,
      seq: nextSeq,
      emittedAt: new Date().toISOString(),
    }

    this.listeners.forEach((listener) => {
      listener(event)
    })

    return event
  }

  resetRun(runId: string): void {
    this.seqByRun.delete(runId)
  }
}
