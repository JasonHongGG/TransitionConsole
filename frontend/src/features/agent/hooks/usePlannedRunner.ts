import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentLogEntry,
  CoverageState,
  Diagram,
  DiagramConnector,
  PlannedRunSnapshot,
  PlannedRunnerStatus,
  PlannedStepEvent,
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
}

interface PlannedStepResponse {
  ok: boolean
  event: PlannedStepEvent | null
  snapshot: PlannedRunSnapshot
}

export interface TemporaryRunnerSettings {
  targetUrl: string
  testingNotes: string
  testAccounts: TestingAccount[]
}

export interface PlannedRunnerState {
  running: boolean
  isBusy: boolean
  statusMessage: string
  statusTone: 'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'
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
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Idle')
  const [statusTone, setStatusTone] = useState<'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'>('idle')
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
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
    nodeStatuses: {},
    edgeStatuses: {},
  })
  const [plannedStatus, setPlannedStatus] = useState<PlannedRunnerStatus | null>(null)
  const maxKnownPathCountRef = useRef(0)

  const appendLog = useCallback((entry: AgentLogEntry) => {
    setLogs((prev) => [entry, ...prev].slice(0, MAX_LOGS))
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
    }
  }, [diagrams, connectors, specRaw, targetUrl, testAccounts, testingNotes])

  const applySnapshot = useCallback((snapshot: PlannedRunSnapshot, source: 'start' | 'step' | 'auto') => {
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
      appendLog(createLog('success', 'Planned run completed.'))
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
  }, [appendLog, running])

  const ensureTargetUrl = useCallback((): boolean => {
    if (targetUrl.trim().length > 0) {
      return true
    }

    setLastError(TARGET_URL_REQUIRED_MESSAGE)
    setStatusTone('error')
    setStatusMessage(TARGET_URL_REQUIRED_MESSAGE)
    appendLog(createLog('error', TARGET_URL_REQUIRED_MESSAGE))
    return false
  }, [appendLog, targetUrl])

  const start = useCallback(async (): Promise<boolean> => {
    if (diagrams.length === 0) return false
    if (!ensureTargetUrl()) return false
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
        appendLog(createLog('error', failureMessage))
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Start failed.')
        return false
      }

      const data = (await response.json()) as PlannedStepResponse
      applySnapshot(data.snapshot, 'start')
      setLatestEvent(null)
      appendLog(createLog('info', 'Planned run started.'))
      return true
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Backend unavailable. Please check server connection.')
      appendLog(createLog('error', failureMessage))
      return false
    } finally {
      setIsBusy(false)
    }
  }, [appendLog, applySnapshot, diagrams.length, endpointBase, ensureTargetUrl, formatHttpFailure, formatRequestError, requestPayload])

  const stop = useCallback(async () => {
    setIsBusy(true)
    setLastError(null)
    setStatusTone('waiting')
    try {
      const response = await fetch(`${endpointBase}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) {
        const failureMessage = `Failed to pause planned run (${response.status}).`
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('Pause failed.')
        appendLog(createLog('error', failureMessage))
        return
      }
      setRunningState(false)
      setStatusTone('paused')
      setStatusMessage('Paused.')
      appendLog(createLog('info', 'Planned run paused.'))
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Pause failed: backend unavailable.')
      appendLog(createLog('error', failureMessage))
    } finally {
      setIsBusy(false)
    }
  }, [appendLog, endpointBase, formatRequestError])

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
        appendLog(createLog('error', failureMessage))
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

      if (data.event) {
        const event = data.event
        const level = data.event.result === 'pass' ? 'success' : 'error'
        const message = `[${event.result.toUpperCase()}] ${event.step.label} : ${event.pathName}`
        appendLog(createLog(level, message, event))

        if (event.narrativeTaskDescription) {
          appendLog(createLog('info', `[Step Narrator] ${event.narrativeTaskDescription}`, event))
        }

        if (event.operatorDecisionReason) {
          appendLog(createLog('info', `[Operator Loop] ${event.operatorDecisionReason}`, event))
        }

        if (Array.isArray(event.operatorToolDescriptions) && event.operatorToolDescriptions.length > 0) {
          event.operatorToolDescriptions.forEach((description) => {
            appendLog(createLog('info', `[Tool] ${description}`, event))
          })
        }

        if (event.blockedReason) {
          appendLog(createLog('error', `Blocked: ${event.blockedReason}`, event))
        }
      } else if (!data.snapshot.completed) {
        appendLog(createLog('info', running ? 'Planner preparing next executable step.' : 'Planner updated. Press Step to continue.'))
      }

      return !data.snapshot.completed
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setRunningState(false)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Step failed: backend unavailable.')
      appendLog(createLog('error', failureMessage))
      return false
    } finally {
      setIsBusy(false)
    }
  }, [appendLog, applySnapshot, endpointBase, ensureTargetUrl, formatHttpFailure, formatRequestError, running])

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
        appendLog(createLog('error', failureMessage))
        return
      }

      setRunningState(false)
      setCompleted(false)
      setFullCoveragePassed(null)
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
      appendLog(createLog('info', 'Planned run reset.'))
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('Reset failed: backend unavailable.')
      appendLog(createLog('error', failureMessage))
    }
    finally {
      setIsBusy(false)
    }
  }, [appendLog, endpointBase, formatRequestError, running])

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

  const getTemporarySettings = useCallback<() => TemporaryRunnerSettings>(() => ({
    targetUrl,
    testingNotes,
    testAccounts,
  }), [targetUrl, testingNotes, testAccounts])

  const applyTemporarySettings = useCallback((settings: TemporaryRunnerSettings) => {
    setTargetUrl(settings.targetUrl ?? '')
    setTestingNotes(settings.testingNotes ?? '')
    setTestAccounts((settings.testAccounts ?? []).map((account) => normalizeAccount(account)))
  }, [setTargetUrl, setTestingNotes, setTestAccounts])

  return {
    running,
    isBusy,
    statusMessage,
    statusTone,
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
