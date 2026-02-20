import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentMode,
  AgentLogEntry,
  CoverageState,
  Diagram,
  DiagramConnector,
  PlannedRunSnapshot,
  PlannedRunnerStatus,
  PlannedLiveEvent,
  PlannedStepEvent,
  RunnerAgentModes,
  TestingAccount,
  TransitionResult,
  UserTestingInfo,
} from '../../../types'

const MAX_LOGS = 120
const TARGET_URL_REQUIRED_MESSAGE = '請先輸入 URL 以開始流程。'

interface PlannedRunnerRequest {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  specRaw: string | null
  targetUrl: string
  userTestingInfo?: UserTestingInfo
  agentModes?: RunnerAgentModes
}

interface PlannedStepResponse {
  ok: boolean
  event: PlannedStepEvent | null
  snapshot: PlannedRunSnapshot
}

interface PlannedRunnerSettingsResponse {
  ok: boolean
  runId: string | null
  agentModes: RunnerAgentModes
}

export interface TemporaryRunnerSettings {
  targetUrl: string
  testingNotes: string
  testAccounts: TestingAccount[]
  agentModes: RunnerAgentModes
}

export interface PlannedRunnerState {
  running: boolean
  stopRequested: boolean
  isBusy: boolean
  statusMessage: string
  statusTone: 'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'
  waitingElapsedSeconds: number
  lastError: string | null
  plannerRound: number
  completed: boolean
  fullCoveragePassed: boolean | null
  currentStateId: string | null
  nextStateId: string | null
  activeEdgeId: string | null
  logs: AgentLogEntry[]
  coverage: CoverageState
  plannedStatus: PlannedRunnerStatus | null
  latestEvent: PlannedStepEvent | null
  targetUrl: string
  testingNotes: string
  testAccounts: TestingAccount[]
  runId: string | null
  agentModes: RunnerAgentModes
  isSettingsBusy: boolean
  applyAgentModes: (nextModes: RunnerAgentModes) => void
  setAgentMode: (agent: keyof RunnerAgentModes, mode: AgentMode) => void
  setTargetUrl: (url: string) => void
  setTestingNotes: (value: string) => void
  setTestAccounts: (accounts: TestingAccount[]) => void
  setTestAccountField: (index: number, field: keyof TestingAccount, value: string) => void
  addTestAccount: () => void
  removeTestAccount: (index: number) => void
  getTemporarySettings: () => TemporaryRunnerSettings
  applyTemporarySettings: (settings: TemporaryRunnerSettings) => void
  setRunning: (next: boolean) => void
  reset: () => void
  step: () => void
}

const createEmptyTestAccount = (): TestingAccount => ({
  role: '',
  username: '',
  password: '',
  description: '',
})

const normalizeAccount = (account: Partial<TestingAccount>): TestingAccount => ({
  role: String(account.role ?? ''),
  username: String(account.username ?? ''),
  password: String(account.password ?? ''),
  description: String(account.description ?? ''),
})

const classifyEventCategory = (eventType: string): AgentLogEntry['category'] => {
  if (eventType.startsWith('narrator.')) return 'narrator'
  if (eventType.startsWith('operator.tool.')) return 'tool'
  if (eventType.startsWith('operator.')) return 'operator'
  return 'system'
}

const toAgentLogEntry = (event: PlannedLiveEvent): AgentLogEntry => ({
  id: `event-${event.runId ?? 'global'}-${event.seq}`,
  timestamp: event.emittedAt,
  level: event.level,
  message: event.message,
  category: classifyEventCategory(event.type),
  transitionId: event.edgeId,
})

export const usePlannedRunner = (
  diagrams: Diagram[],
  connectors: DiagramConnector[],
  specRaw: string | null,
): PlannedRunnerState => {
  const apiBase = import.meta.env.VITE_AGENT_API_BASE ?? ''
  const endpointBase = `${apiBase}/api/planned`

  const [running, setRunningState] = useState(false)
  const [stopRequested, setStopRequestedState] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Idle')
  const [statusTone, setStatusTone] = useState<'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'>('idle')
  const [waitingElapsedSeconds, setWaitingElapsedSeconds] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [plannerRound, setPlannerRound] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [fullCoveragePassed, setFullCoveragePassed] = useState<boolean | null>(null)
  const [currentStateId, setCurrentStateId] = useState<string | null>(null)
  const [nextStateId, setNextStateId] = useState<string | null>(null)
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)
  const [targetUrl, setTargetUrl] = useState('')
  const [testingNotes, setTestingNotes] = useState('')
  const [testAccounts, setTestAccountsState] = useState<TestingAccount[]>([])
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [latestEvent, setLatestEvent] = useState<PlannedStepEvent | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [agentModes, setAgentModes] = useState<RunnerAgentModes>({
    pathPlanner: 'llm',
    stepNarrator: 'llm',
    operatorLoop: 'llm',
  })
  const [isSettingsBusy, setIsSettingsBusy] = useState(false)
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
    nodeStatuses: {},
    edgeStatuses: {},
  })
  const [plannedStatus, setPlannedStatus] = useState<PlannedRunnerStatus | null>(null)
  const maxKnownPathCountRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const stopRequestedRef = useRef(false)

  const setStopRequested = useCallback((next: boolean) => {
    stopRequestedRef.current = next
    setStopRequestedState(next)
  }, [])

  const appendLiveEvent = useCallback((event: PlannedLiveEvent) => {
    const entry = toAgentLogEntry(event)
    setLogs((prev) => {
      if (prev.some((item) => item.id === entry.id)) {
        return prev
      }
      return [entry, ...prev].slice(0, MAX_LOGS)
    })
  }, [])

  const connectLiveEvents = useCallback(() => {
    if (eventSourceRef.current) {
      return
    }

    const source = new EventSource(`${endpointBase}/events`)
    source.onmessage = (messageEvent) => {
      try {
        const payload = JSON.parse(messageEvent.data) as PlannedLiveEvent
        if (!payload || typeof payload.seq !== 'number' || typeof payload.message !== 'string') {
          return
        }
        appendLiveEvent(payload)
      } catch {
        // ignore malformed stream chunks
      }
    }
    source.onerror = () => {
      // Browser will auto-reconnect for SSE by default.
    }

    eventSourceRef.current = source
  }, [appendLiveEvent, endpointBase])

  const disconnectLiveEvents = useCallback(() => {
    if (!eventSourceRef.current) {
      return
    }

    eventSourceRef.current.close()
    eventSourceRef.current = null
  }, [])

  const setTestAccountField = useCallback((index: number, field: keyof TestingAccount, value: string) => {
    setTestAccountsState((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    )
  }, [])

  const addTestAccount = useCallback(() => {
    setTestAccountsState((prev) => [...prev, createEmptyTestAccount()])
  }, [])

  const setTestAccounts = useCallback((accounts: TestingAccount[]) => {
    setTestAccountsState((accounts ?? []).map((account) => normalizeAccount(account)))
  }, [])

  const removeTestAccount = useCallback((index: number) => {
    setTestAccountsState((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }, [])

  const formatRequestError = useCallback((error: unknown) => {
    if (error instanceof Error) {
      return `Request failed: ${error.message}`
    }
    return 'Request failed: unknown error'
  }, [])

  const formatHttpFailure = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = (await response.json()) as { error?: unknown; message?: unknown } | null
      const reason =
        (typeof payload?.error === 'string' && payload.error.trim()) ||
        (typeof payload?.message === 'string' && payload.message.trim()) ||
        ''
      return reason ? `${fallback} ${reason}` : fallback
    } catch {
      return fallback
    }
  }, [])

  const requestPayload = useMemo<PlannedRunnerRequest>(() => {
    const trimmedNotes = testingNotes.trim()
    const normalizedAccounts = testAccounts
      .map((account) => ({
        role: account.role?.trim(),
        username: account.username?.trim(),
        password: account.password?.trim(),
        description: account.description?.trim(),
      }))
      .filter((account) => account.role || account.username || account.password || account.description)

    const userTestingInfo =
      trimmedNotes || normalizedAccounts.length > 0
        ? {
            notes: trimmedNotes || undefined,
            accounts: normalizedAccounts,
          }
        : undefined

    return {
      diagrams,
      connectors,
      specRaw,
      targetUrl,
      userTestingInfo,
      agentModes,
    }
  }, [agentModes, diagrams, connectors, specRaw, targetUrl, testAccounts, testingNotes])

  const applySnapshot = useCallback((snapshot: PlannedRunSnapshot, source: 'start' | 'step' | 'auto') => {
    setRunId(snapshot.runId)
    setAgentModes(snapshot.agentModes)

    if (snapshot.totalPaths > maxKnownPathCountRef.current) {
      setPlannerRound((prev) => (prev === 0 ? 1 : prev + 1))
      maxKnownPathCountRef.current = snapshot.totalPaths
    }

    setCurrentStateId(snapshot.currentStateId)
    setNextStateId(snapshot.nextStateId)
    setActiveEdgeId(snapshot.activeEdgeId)
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
      currentStepOrder: snapshot.currentStepOrder,
      currentPathStepTotal: snapshot.currentPathStepTotal,
    })

    if (snapshot.completed) {
      setRunningState(false)
      setCompleted(true)
      const uncoveredTotal = snapshot.coverage.uncoveredEdgeIds.length + snapshot.coverage.uncoveredNodeIds.length
      const hasFailure = Object.values(snapshot.edgeStatuses).some((status) => status === 'fail')
      const passed = uncoveredTotal === 0 && !hasFailure
      setFullCoveragePassed(passed)
      setStatusMessage(passed ? 'Full coverage complete: PASS' : 'Run complete: full coverage NOT passed')
      setStatusTone(passed ? 'success' : 'error')
      return
    }

    setCompleted(false)
    setFullCoveragePassed(null)

    if (snapshot.currentPathId && snapshot.currentStepId) {
      setStatusTone(running ? 'running' : 'paused')
      setStatusMessage(
        `Ready: ${snapshot.currentPathId} step ${snapshot.currentStepOrder ?? 0}/${snapshot.currentPathStepTotal ?? 0}`,
      )
      return
    }

    if (source === 'start') {
      setStatusTone('paused')
      setStatusMessage('Planner ready. Press Step to execute the first action.')
      return
    }

    if (source === 'step' && !running) {
      setStatusTone('paused')
      setStatusMessage('Path transitioned/replanned. Press Step to continue.')
      return
    }

    setStatusTone('running')
    setStatusMessage('Executing planned paths...')
  }, [running])

  const applyAgentModes = useCallback((nextModes: RunnerAgentModes) => {
    const previousModes = agentModes
    setAgentModes(nextModes)

    if (!runId) {
      return
    }

    void (async () => {
      setIsSettingsBusy(true)
      try {
        const response = await fetch(`${endpointBase}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, agentModes: nextModes }),
        })

        if (!response.ok) {
          const failureMessage = await formatHttpFailure(response, `Failed to update settings (${response.status}).`)
          setLastError(failureMessage)
          setStatusTone('error')
          setStatusMessage('Update settings failed.')
          setAgentModes(previousModes)
          return
        }

        const payload = (await response.json()) as PlannedRunnerSettingsResponse
        setRunId(payload.runId)
        setAgentModes(payload.agentModes)
      } catch (error) {
        const failureMessage = formatRequestError(error)
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Update settings failed: backend unavailable.')
        setAgentModes(previousModes)
      } finally {
        setIsSettingsBusy(false)
      }
    })()
  }, [agentModes, endpointBase, formatHttpFailure, formatRequestError, runId])

  const setAgentMode = useCallback((agent: keyof RunnerAgentModes, mode: AgentMode) => {
    applyAgentModes({
      ...agentModes,
      [agent]: mode,
    })
  }, [agentModes, applyAgentModes])

  const ensureTargetUrl = useCallback((): boolean => {
    if (targetUrl.trim().length > 0) {
      return true
    }

    setLastError(TARGET_URL_REQUIRED_MESSAGE)
    setStatusTone('error')
    setStatusMessage(TARGET_URL_REQUIRED_MESSAGE)
    return false
  }, [targetUrl])

  const start = useCallback(async (): Promise<boolean> => {
    if (diagrams.length === 0) return false
    if (!ensureTargetUrl()) return false
    connectLiveEvents()
    setStopRequested(false)
    setIsBusy(true)
    setLastError(null)
    setStatusTone('waiting')
    setStatusMessage('Waiting planner...')
    try {
      const response = await fetch(`${endpointBase}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })

      if (!response.ok) {
        const failureMessage = await formatHttpFailure(
          response,
          `Failed to start planned run (${response.status}).`,
        )
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Start failed.')
        return false
      }

      const data = (await response.json()) as PlannedStepResponse
      applySnapshot(data.snapshot, 'start')
      setLatestEvent(null)
      return true
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Backend unavailable. Please check server connection.')
      return false
    } finally {
      setIsBusy(false)
    }
  }, [applySnapshot, connectLiveEvents, diagrams.length, endpointBase, ensureTargetUrl, formatHttpFailure, formatRequestError, requestPayload])

  const runSingleStep = useCallback(async (): Promise<boolean> => {
    if (!ensureTargetUrl()) return false
    setIsBusy(true)
    setLastError(null)
    setStatusTone('waiting')
    setStatusMessage('Waiting planner/step execution...')
    try {
      const response = await fetch(`${endpointBase}/step`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) {
        const failureMessage = await formatHttpFailure(response, `Step request failed (${response.status}).`)
        setRunningState(false)
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Step failed.')
        return false
      }

      const data = (await response.json()) as PlannedStepResponse
      applySnapshot(data.snapshot, running ? 'auto' : 'step')

      if (data.event) {
        setLatestEvent({
          ...data.event,
          validationResults: data.event.validationResults ?? [],
        })
      }

      return !data.snapshot.completed
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setRunningState(false)
      setStopRequested(false)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Step failed: backend unavailable.')
      return false
    } finally {
      setIsBusy(false)
    }
  }, [applySnapshot, endpointBase, ensureTargetUrl, formatHttpFailure, formatRequestError, running])

  const ensureSession = useCallback(async (): Promise<boolean> => {
    const hasActiveSnapshot = plannedStatus !== null
    if (hasActiveSnapshot) {
      return true
    }
    return start()
  }, [plannedStatus, start])

  const reset = useCallback(async () => {
    setIsBusy(true)
    setStatusTone('waiting')
    setLastError(null)
    setLogs([])
    disconnectLiveEvents()
    try {
      if (running) {
        await fetch(`${endpointBase}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      }
      const response = await fetch(`${endpointBase}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) {
        const failureMessage = `Failed to reset planned run (${response.status}).`
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Reset failed.')
        return
      }

      setRunningState(false)
      setStopRequested(false)
      setCompleted(false)
      setFullCoveragePassed(null)
      setRunId(null)
      setPlannerRound(0)
      maxKnownPathCountRef.current = 0
      setCurrentStateId(null)
      setNextStateId(null)
      setActiveEdgeId(null)
      setPlannedStatus(null)
      setLogs([])
      setLatestEvent(null)
      setStatusTone('idle')
      setStatusMessage('Idle')
      setCoverage({
        visitedNodes: new Set<string>(),
        transitionResults: {},
        nodeStatuses: {},
        edgeStatuses: {},
      })
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Reset failed: backend unavailable.')
    }
    finally {
      setIsBusy(false)
    }
  }, [disconnectLiveEvents, endpointBase, formatRequestError, running])

  useEffect(() => {
    return () => {
      disconnectLiveEvents()
    }
  }, [disconnectLiveEvents])

  useEffect(() => {
    if (statusTone !== 'waiting') {
      setWaitingElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    setWaitingElapsedSeconds(0)
    const timer = window.setInterval(() => {
      setWaitingElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [statusTone])

  useEffect(() => {
    if (!running) return

    let cancelled = false

    const runAll = async () => {
      const ready = await ensureSession()
      if (!ready || cancelled) {
        setStopRequested(false)
        setRunningState(false)
        return
      }

      while (!cancelled) {
        if (stopRequestedRef.current) {
          break
        }

        const shouldContinue = await runSingleStep()
        if (!shouldContinue || cancelled || stopRequestedRef.current) {
          break
        }
      }

      if (!cancelled) {
        if (stopRequestedRef.current) {
          setStopRequested(false)
          setRunningState(false)
          setStatusTone('paused')
          setStatusMessage('Paused. Step mode ready.')
          return
        }

        setRunningState(false)
      }
    }

    void runAll()

    return () => {
      cancelled = true
    }
  }, [ensureSession, runSingleStep, running, setStopRequested])

  const getTemporarySettings = useCallback<() => TemporaryRunnerSettings>(() => ({
    targetUrl,
    testingNotes,
    testAccounts,
    agentModes,
  }), [targetUrl, testingNotes, testAccounts, agentModes])

  const applyTemporarySettings = useCallback((settings: TemporaryRunnerSettings) => {
    setTargetUrl(settings.targetUrl ?? '')
    setTestingNotes(settings.testingNotes ?? '')
    setTestAccounts((settings.testAccounts ?? []).map((account) => normalizeAccount(account)))
    const nextModes = settings.agentModes ?? {
      pathPlanner: 'llm',
      stepNarrator: 'llm',
      operatorLoop: 'llm',
    }
    applyAgentModes(nextModes)
  }, [setTargetUrl, setTestingNotes, setTestAccounts, applyAgentModes])

  return {
    running,
    stopRequested,
    isBusy,
    statusMessage,
    statusTone,
    waitingElapsedSeconds,
    lastError,
    plannerRound,
    completed,
    fullCoveragePassed,
    currentStateId,
    nextStateId,
    activeEdgeId,
    logs,
    coverage,
    plannedStatus,
    latestEvent,
    runId,
    agentModes,
    isSettingsBusy,
    applyAgentModes,
    setAgentMode,
    targetUrl,
    testingNotes,
    testAccounts,
    setTargetUrl,
    setTestingNotes,
    setTestAccounts,
    setTestAccountField,
    addTestAccount,
    removeTestAccount,
    getTemporarySettings,
    applyTemporarySettings,
    setRunning: (next) => {
      if (next) {
        if (!ensureTargetUrl()) return
        setStopRequested(false)
        setRunningState(true)
      } else {
        if (!running) {
          return
        }

        setLastError(null)
        setStopRequested(true)
        setStatusTone('waiting')
        setStatusMessage('Stop requested. Finishing current step...')
      }
    },
    reset: () => {
      void reset()
    },
    step: () => {
      void (async () => {
        if (running || isBusy) return
        if (!ensureTargetUrl()) return
        if (plannedStatus === null) {
          const started = await start()
          if (!started) return
          return
        }
        await runSingleStep()
      })()
    },
  }
}
