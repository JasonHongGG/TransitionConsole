import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentLogEntry,
  CoverageState,
  Diagram,
  DiagramTransition,
  TransitionResult,
} from '../types'

const MAX_LOGS = 60
const DEFAULT_INTERVAL = 1400

const nowIso = () => new Date().toISOString()

const normalizeRole = (transition: DiagramTransition) => {
  if (transition.roles.length > 0) {
    return transition.roles.join(', ')
  }
  return 'system'
}

export interface MockRunnerState {
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

export const useMockRunner = (diagrams: Diagram[]): MockRunnerState => {
  const transitions = useMemo(() => diagrams.flatMap((diagram) => diagram.transitions), [diagrams])
  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL)
  const [pointer, setPointer] = useState(0)
  const [currentStateId, setCurrentStateId] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
  })
  const [logs, setLogs] = useState<AgentLogEntry[]>([])

  const appendLog = useCallback((entry: AgentLogEntry) => {
    setLogs((prev) => [entry, ...prev].slice(0, MAX_LOGS))
  }, [])

  const updateCoverage = useCallback((stateId: string, transitionId: string, result: TransitionResult) => {
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

  const step = useCallback(() => {
    if (transitions.length === 0) {
      return
    }

    const transition = transitions[pointer % transitions.length]
    const result: TransitionResult = Math.random() > 0.18 ? 'pass' : 'fail'
    const role = normalizeRole(transition)

    appendLog({
      id: `${transition.id}-move-${Date.now()}`,
      timestamp: nowIso(),
      level: 'info',
      message: `Moving to ${transition.to}`,
      role,
      transitionId: transition.id,
      stateId: transition.to,
    })

    appendLog({
      id: `${transition.id}-arrive-${Date.now()}`,
      timestamp: nowIso(),
      level: 'info',
      message: `Confirmed arrival at ${transition.to}`,
      role,
      transitionId: transition.id,
      stateId: transition.to,
    })

    appendLog({
      id: `${transition.id}-validate-${Date.now()}`,
      timestamp: nowIso(),
      level: result === 'pass' ? 'success' : 'error',
      message:
        result === 'pass'
          ? `Validation passed for ${transition.event ?? 'auto'}`
          : `Validation failed for ${transition.event ?? 'auto'}`,
      role,
      transitionId: transition.id,
      stateId: transition.to,
    })

    setCurrentStateId(transition.to)
    updateCoverage(transition.to, transition.id, result)
    setPointer((prev) => (prev + 1) % transitions.length)
  }, [appendLog, pointer, transitions, updateCoverage])

  const reset = useCallback(() => {
    setRunning(false)
    setPointer(0)
    setCurrentStateId(null)
    setLogs([])
    setCoverage({ visitedNodes: new Set(), transitionResults: {} })
  }, [])

  useEffect(() => {
    if (!running) {
      return
    }
    const id = window.setInterval(() => {
      step()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, running, step])

  return {
    running,
    intervalMs,
    currentStateId,
    logs,
    coverage,
    setRunning,
    setIntervalMs,
    reset,
    step,
  }
}
