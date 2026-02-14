import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentLogEntry,
  CoverageState,
  Diagram,
  DiagramConnector,
  PlannedRunSnapshot,
  PlannedRunnerStatus,
  PlannedStepEvent,
  TransitionResult,
} from '../types'

const MAX_LOGS = 120

interface PlannedRunnerRequest {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  specRaw: string | null
  targetUrl: string
}

interface PlannedStepResponse {
  ok: boolean
  event: PlannedStepEvent | null
  snapshot: PlannedRunSnapshot
}

export interface PlannedRunnerState {
  running: boolean
  currentStateId: string | null
  logs: AgentLogEntry[]
  coverage: CoverageState
  plannedStatus: PlannedRunnerStatus | null
  latestEvent: PlannedStepEvent | null
  targetUrl: string
  setTargetUrl: (url: string) => void
  setRunning: (next: boolean) => void
  reset: () => void
  step: () => void
}

const nowIso = () => new Date().toISOString()

const createLog = (level: AgentLogEntry['level'], message: string, event?: PlannedStepEvent): AgentLogEntry => ({
  id: `${level}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  timestamp: nowIso(),
  level,
  message,
  stateId: event?.step.toStateId,
  transitionId: event?.step.edgeId,
})

export const usePlannedRunner = (
  diagrams: Diagram[],
  connectors: DiagramConnector[],
  specRaw: string | null,
): PlannedRunnerState => {
  const apiBase = import.meta.env.VITE_AGENT_API_BASE ?? ''
  const endpointBase = `${apiBase}/api/planned`

  const [running, setRunningState] = useState(false)
  const [currentStateId, setCurrentStateId] = useState<string | null>(null)
  const [targetUrl, setTargetUrl] = useState('')
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [latestEvent, setLatestEvent] = useState<PlannedStepEvent | null>(null)
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
    nodeStatuses: {},
    edgeStatuses: {},
  })
  const [plannedStatus, setPlannedStatus] = useState<PlannedRunnerStatus | null>(null)

  const appendLog = useCallback((entry: AgentLogEntry) => {
    setLogs((prev) => [entry, ...prev].slice(0, MAX_LOGS))
  }, [])

  const requestPayload = useMemo<PlannedRunnerRequest>(
    () => ({
      diagrams,
      connectors,
      specRaw,
      targetUrl,
    }),
    [diagrams, connectors, specRaw, targetUrl],
  )

  const applySnapshot = useCallback((snapshot: PlannedRunSnapshot) => {
    setCurrentStateId(snapshot.currentStateId)
    setCoverage((prev) => {
      const visitedNodes = new Set(prev.visitedNodes)
      Object.entries(snapshot.nodeStatuses).forEach(([nodeId, status]) => {
        if (status === 'pass' || status === 'running' || status === 'fail') {
          visitedNodes.add(nodeId)
        }
      })

      const transitionResults: Record<string, TransitionResult> = {}
      Object.entries(snapshot.edgeStatuses).forEach(([edgeId, status]) => {
        if (status === 'pass' || status === 'fail') {
          transitionResults[edgeId] = status
        }
      })

      return {
        visitedNodes,
        transitionResults,
        nodeStatuses: snapshot.nodeStatuses,
        edgeStatuses: snapshot.edgeStatuses,
      }
    })

    setPlannedStatus({
      plannedPaths: snapshot.totalPaths,
      completedPaths: snapshot.completedPaths,
      currentPathId: snapshot.currentPathId,
      currentPathName: snapshot.currentPathId,
      currentStepId: snapshot.currentStepId,
      currentStepLabel: snapshot.currentStepId,
    })

    if (snapshot.completed) {
      setRunningState(false)
      appendLog(createLog('success', 'Planned run completed.'))
    }
  }, [appendLog])

  const start = useCallback(async (): Promise<boolean> => {
    if (diagrams.length === 0) return false
    const response = await fetch(`${endpointBase}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    })

    if (!response.ok) {
      appendLog(createLog('error', 'Failed to start planned run.'))
      return false
    }

    const data = (await response.json()) as PlannedStepResponse
    applySnapshot(data.snapshot)
    setLatestEvent(null)
    appendLog(createLog('info', 'Planned run started.'))
    return true
  }, [appendLog, applySnapshot, diagrams.length, endpointBase, requestPayload])

  const stop = useCallback(async () => {
    await fetch(`${endpointBase}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    setRunningState(false)
    appendLog(createLog('info', 'Planned run paused.'))
  }, [appendLog, endpointBase])

  const runSingleStep = useCallback(async (): Promise<boolean> => {
    const response = await fetch(`${endpointBase}/step`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    if (!response.ok) {
      appendLog(createLog('error', 'Step request failed.'))
      setRunningState(false)
      return false
    }

    const data = (await response.json()) as PlannedStepResponse
    applySnapshot(data.snapshot)

    if (data.event) {
      setLatestEvent({
        ...data.event,
        validationResults: data.event.validationResults ?? [],
      })
    }

    if (data.event) {
      const level = data.event.result === 'pass' ? 'success' : 'error'
      const message = `${data.event.pathName}: ${data.event.step.label} → ${data.event.result.toUpperCase()}`
      appendLog(createLog(level, message, data.event))
      if (data.event.blockedReason) {
        appendLog(createLog('error', `Blocked: ${data.event.blockedReason}`, data.event))
      }
    }
    return !data.snapshot.completed
  }, [appendLog, applySnapshot, endpointBase])

  const ensureSession = useCallback(async (): Promise<boolean> => {
    const hasActiveSnapshot = plannedStatus !== null
    if (hasActiveSnapshot) {
      return true
    }
    return start()
  }, [plannedStatus, start])

  const reset = useCallback(async () => {
    if (running) {
      await fetch(`${endpointBase}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    }
    await fetch(`${endpointBase}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    setRunningState(false)
    setCurrentStateId(null)
    setPlannedStatus(null)
    setLogs([])
    setLatestEvent(null)
    setCoverage({
      visitedNodes: new Set<string>(),
      transitionResults: {},
      nodeStatuses: {},
      edgeStatuses: {},
    })
    appendLog(createLog('info', 'Planned run reset.'))
  }, [appendLog, endpointBase, running])

  useEffect(() => {
    if (!running) return

    let cancelled = false

    const runAll = async () => {
      const ready = await ensureSession()
      if (!ready || cancelled) {
        setRunningState(false)
        return
      }

      while (!cancelled) {
        const shouldContinue = await runSingleStep()
        if (!shouldContinue || cancelled) {
          break
        }
      }

      if (!cancelled) {
        setRunningState(false)
      }
    }

    void runAll()

    return () => {
      cancelled = true
    }
  }, [ensureSession, runSingleStep, running])

  return {
    running,
    currentStateId,
    logs,
    coverage,
    plannedStatus,
    latestEvent,
    targetUrl,
    setTargetUrl,
    setRunning: (next) => {
      if (next) {
        setRunningState(true)
      } else {
        void stop()
      }
    },
    reset: () => {
      void reset()
    },
    step: () => {
      void (async () => {
        if (running) return
        const ready = await ensureSession()
        if (!ready) return
        await runSingleStep()
      })()
    },
  }
}
