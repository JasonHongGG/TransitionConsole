import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentLogEntry, CoverageState, Diagram, TransitionResult } from '../types'

interface AgentStreamEvent {
  type: string
  timestamp: string
  level: 'info' | 'success' | 'error'
  message: string
  role?: string
  stateId?: string
  transitionId?: string
  result?: TransitionResult
}

export interface CopilotRunnerState {
  running: boolean
  intervalMs: number
  currentStateId: string | null
  logs: AgentLogEntry[]
  coverage: CoverageState
  setRunning: (next: boolean) => void
  setIntervalMs: (ms: number) => void
  reset: () => void
  step: () => void
}

const MAX_LOGS = 80

const createLogEntry = (event: AgentStreamEvent): AgentLogEntry => ({
  id: `${event.type}-${event.timestamp}-${Math.random().toString(16).slice(2)}`,
  timestamp: event.timestamp,
  level: event.level,
  message: event.message,
  role: event.role,
  stateId: event.stateId,
  transitionId: event.transitionId,
})

export const useCopilotRunner = (_diagrams: Diagram[], enabled: boolean): CopilotRunnerState => {
  const apiBase = import.meta.env.VITE_AGENT_API_BASE ?? ''
  const endpointBase = `${apiBase}/api/agent`

  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(1200)
  const [currentStateId, setCurrentStateId] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
  })
  const [logs, setLogs] = useState<AgentLogEntry[]>([])

  const addCoverage = useCallback((event: AgentStreamEvent) => {
    if (!event.stateId || !event.transitionId || !event.result) {
      return
    }
    const stateId = event.stateId
    const transitionId = event.transitionId
    const result = event.result as TransitionResult
    setCoverage((prev) => {
      const visitedNodes = new Set(prev.visitedNodes)
      visitedNodes.add(stateId)
      return {
        visitedNodes,
        transitionResults: {
          ...prev.transitionResults,
          [transitionId]: result,
        },
      }
    })
  }, [])

  const handleStreamEvent = useCallback(
    (event: AgentStreamEvent) => {
      setLogs((prev) => [createLogEntry(event), ...prev].slice(0, MAX_LOGS))
      if (event.stateId) {
        setCurrentStateId(event.stateId)
      }
      addCoverage(event)
    },
    [addCoverage],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }
    const source = new EventSource(`${endpointBase}/stream`)
    source.addEventListener('agent', (raw) => {
      if (!(raw instanceof MessageEvent)) {
        return
      }
      try {
        const payload = JSON.parse(raw.data) as AgentStreamEvent
        handleStreamEvent(payload)
      } catch {
        // Ignore malformed payloads
      }
    })

    source.onerror = () => {
      setLogs((prev) =>
        [
          {
            id: `stream-error-${Date.now()}`,
            timestamp: new Date().toISOString(),
            level: 'error' as const,
            message: 'Agent stream disconnected. Check server status.',
          },
          ...prev,
        ].slice(0, MAX_LOGS),
      )
    }

    return () => {
      source.close()
    }
  }, [enabled, endpointBase, handleStreamEvent])

  const start = useCallback(async () => {
    await fetch(`${endpointBase}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    setRunning(true)
  }, [endpointBase])

  const stop = useCallback(async () => {
    await fetch(`${endpointBase}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    setRunning(false)
  }, [endpointBase])

  const step = useCallback(async () => {
    await fetch(`${endpointBase}/step`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  }, [endpointBase])

  const reset = useCallback(() => {
    setLogs([])
    setCoverage({ visitedNodes: new Set(), transitionResults: {} })
    setCurrentStateId(null)
  }, [])

  const interval = useMemo(() => intervalMs, [intervalMs])

  useEffect(() => {
    if (!enabled || !running) {
      return
    }
    const id = window.setInterval(() => {
      step()
    }, interval)
    return () => window.clearInterval(id)
  }, [enabled, interval, running, step])

  return {
    running,
    intervalMs: interval,
    currentStateId,
    logs,
    coverage,
    setRunning: (next) => (next ? start() : stop()),
    setIntervalMs,
    reset,
    step,
  }
}
