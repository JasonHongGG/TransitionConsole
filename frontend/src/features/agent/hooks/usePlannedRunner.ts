import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentMode,
  AgentLogEntry,
  CoverageState,
  Diagram,
  DiagramConnector,
  PlannedLiveEvent,
  PlannedRunSnapshot,
  PlannedRunnerStatus,
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

interface PlannedRunnerResponse {
  ok: boolean
  event: null
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
  refresh: () => void
  reset: () => void
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
  stateId: event.currentStateId ?? undefined,
})

export const usePlannedRunner = (
  diagrams: Diagram[],
  connectors: DiagramConnector[],
  specRaw: string | null,
): PlannedRunnerState => {
  const apiBase = `http://localhost:${__MAIN_SERVER_PORT__}`
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
  const [runId, setRunId] = useState<string | null>(null)
  const [agentModes, setAgentModes] = useState<RunnerAgentModes>({
    pathPlanner: 'llm',
    pathNarrator: 'llm',
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
  const eventSourceRef = useRef<EventSource | null>(null)
  const pollInFlightRef = useRef(false)

  const setStopRequested = useCallback((next: boolean) => {
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
      // Browser auto-reconnects SSE by default.
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

  const applySnapshot = useCallback((snapshot: PlannedRunSnapshot, source: 'start' | 'status' | 'stop') => {
    setRunId(snapshot.runId)
    setAgentModes(snapshot.agentModes)
    setPlannerRound(snapshot.batchNumber)
    setCurrentStateId(snapshot.currentStateId)
    setNextStateId(snapshot.nextStateId)
    setActiveEdgeId(snapshot.activeEdgeId)
    setRunningState(snapshot.running)
    setStopRequested(snapshot.stopRequested)

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

    if (!snapshot.runId) {
      setPlannedStatus(null)
      setCompleted(false)
      setFullCoveragePassed(null)
      setStatusTone('idle')
      setStatusMessage('Idle')
      return
    }

    setPlannedStatus(snapshot)

    if (snapshot.completed) {
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

    if (snapshot.stopRequested) {
      setStatusTone(snapshot.running ? 'waiting' : 'paused')
      setStatusMessage(snapshot.running ? 'Stop requested. Finishing current path...' : 'Paused. Press Start to resume.')
      return
    }

    if (snapshot.running && snapshot.currentPathName) {
      setStatusTone('running')
      setStatusMessage(
        `Running: ${snapshot.currentPathName} transition ${snapshot.currentStepOrder ?? 0}/${snapshot.currentPathStepTotal ?? 0}`,
      )
      return
    }

    if (snapshot.running) {
      setStatusTone('running')
      setStatusMessage(source === 'start' ? 'Path batch started.' : 'Executing planned paths...')
      return
    }

    setStatusTone('paused')
    setStatusMessage('Paused. Press Start to resume.')
  }, [setStopRequested])

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

  const refreshStatus = useCallback(async (silent = false): Promise<boolean> => {
    if (pollInFlightRef.current) {
      return false
    }

    pollInFlightRef.current = true

    if (!silent) {
      setIsBusy(true)
    }

    try {
      const response = await fetch(`${endpointBase}/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const failureMessage = await formatHttpFailure(response, `Status request failed (${response.status}).`)
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Status refresh failed.')
        return false
      }

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'status')
      return Boolean(data.snapshot.runId)
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Status refresh failed: backend unavailable.')
      return false
    } finally {
      pollInFlightRef.current = false
      if (!silent) {
        setIsBusy(false)
      }
    }
  }, [applySnapshot, endpointBase, formatHttpFailure, formatRequestError])

  const startOrResume = useCallback(async (): Promise<boolean> => {
    if (diagrams.length === 0) return false
    if (!ensureTargetUrl()) return false

    if (!plannedStatus || plannedStatus.completed) {
      setLogs([])
      setCoverage({
        visitedNodes: new Set<string>(),
        transitionResults: {},
        nodeStatuses: {},
        edgeStatuses: {},
      })
    }

    connectLiveEvents()
    setStopRequested(false)
    setIsBusy(true)
    setLastError(null)
    setStatusTone('waiting')
    setStatusMessage(plannedStatus && !plannedStatus.completed ? 'Resuming path batch...' : 'Starting path batch...')

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

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'start')
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
  }, [applySnapshot, connectLiveEvents, diagrams.length, endpointBase, ensureTargetUrl, formatHttpFailure, formatRequestError, plannedStatus, requestPayload, setStopRequested])

  const requestStop = useCallback(async (): Promise<boolean> => {
    if (!plannedStatus?.runId || !plannedStatus.running) {
      return false
    }

    setIsBusy(true)
    setLastError(null)
    setStatusTone('waiting')
    setStatusMessage('Stop requested. Finishing current path...')

    try {
      const response = await fetch(`${endpointBase}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const failureMessage = await formatHttpFailure(response, `Stop request failed (${response.status}).`)
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Stop failed.')
        return false
      }

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'stop')
      return true
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Stop failed: backend unavailable.')
      return false
    } finally {
      setIsBusy(false)
    }
  }, [applySnapshot, endpointBase, formatHttpFailure, formatRequestError, plannedStatus])

  const reset = useCallback(async () => {
    setIsBusy(true)
    setStatusTone('waiting')
    setLastError(null)
    disconnectLiveEvents()

    try {
      const response = await fetch(`${endpointBase}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

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
      setCurrentStateId(null)
      setNextStateId(null)
      setActiveEdgeId(null)
      setPlannedStatus(null)
      setLogs([])
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
    } finally {
      setIsBusy(false)
    }
  }, [disconnectLiveEvents, endpointBase, formatRequestError, setStopRequested])

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
    if (!plannedStatus?.runId) {
      return
    }

    if (!plannedStatus.running && !plannedStatus.stopRequested) {
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled) {
        return
      }
      await refreshStatus(true)
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [plannedStatus?.runId, plannedStatus?.running, plannedStatus?.stopRequested, refreshStatus])

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
      pathNarrator: 'llm',
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
        void startOrResume()
        return
      }

      void requestStop()
    },
    refresh: () => {
      void refreshStatus()
    },
    reset: () => {
      void reset()
    },
  }
}
