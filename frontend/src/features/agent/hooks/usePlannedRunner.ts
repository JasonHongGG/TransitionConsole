import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Diagram, DiagramConnector } from '../../../shared/types/diagram'
import type {
  AgentMode,
  CoverageState,
  ExecutionIssue,
  ExecutionOverview,
  ExecutionPhase,
  ExecutionTimelineEntry,
  PathExecutionSummary,
  PlannedLiveEvent,
  PlannedRunSnapshot,
  PlannedRunnerStatus,
  RunnerAgentModes,
  StepValidationResult,
  StepValidationSummary,
  TestingAccount,
  TransitionResult,
  UserTestingInfo,
} from '../../../shared/types/execution'

const MAX_TIMELINE_ENTRIES = 80
const TARGET_URL_REQUIRED_MESSAGE = '請先輸入 URL 以開始流程。'
const ACTIVE_RECONCILE_INTERVAL_MS = 450
const ACTIVE_RECONCILE_DEBOUNCE_MS = 90

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

type SyncState = 'idle' | 'live' | 'reconnecting'
type ControlPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'paused' | 'resetting' | 'completed'

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
  controlPhase: ControlPhase
  canStop: boolean
  canReset: boolean
  statusMessage: string
  statusTone: 'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'warning' | 'error'
  waitingElapsedSeconds: number
  lastError: string | null
  plannerRound: number
  completed: boolean
  fullCoveragePassed: boolean | null
  currentStateId: string | null
  nextStateId: string | null
  activeEdgeId: string | null
  coverage: CoverageState
  plannedStatus: PlannedRunnerStatus | null
  targetUrl: string
  testingNotes: string
  testAccounts: TestingAccount[]
  runId: string | null
  agentModes: RunnerAgentModes
  isSettingsBusy: boolean
  timeline: ExecutionTimelineEntry[]
  issues: ExecutionIssue[]
  overview: ExecutionOverview
  syncState: SyncState
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const VALIDATION_MESSAGE_ITEM_LIMIT = 3
const GENERIC_VALIDATION_BLOCKED_REASON = 'validation issues recorded: validations were not fully satisfied'

const formatValidationSummary = (summary: StepValidationSummary): string =>
  `${summary.pass}/${summary.total} passed${summary.fail > 0 ? ` · ${summary.fail} failed` : ''}${summary.pending > 0 ? ` · ${summary.pending} pending` : ''}`

const formatValidationResultDetail = (result: StepValidationResult): string => {
  const segments = [result.label]

  if (result.reason && result.reason !== 'not-yet-verified') {
    segments.push(result.reason)
  }
  if (result.actual) {
    segments.push(`actual: ${result.actual}`)
  }
  if (result.expected) {
    segments.push(`expected: ${result.expected}`)
  }

  return segments.join(' | ')
}

const formatValidationBucket = (
  label: string,
  results: StepValidationResult[] | undefined,
  status: StepValidationResult['status'],
): string | null => {
  const matches = results?.filter((result) => result.status === status) ?? []
  if (matches.length === 0) return null

  const items = matches.slice(0, VALIDATION_MESSAGE_ITEM_LIMIT).map(formatValidationResultDetail)
  const remaining = matches.length - items.length
  return `${label}: ${items.join('; ')}${remaining > 0 ? `; +${remaining} more` : ''}`
}

const formatBlockedReasonDetail = (
  blockedReason: string | null | undefined,
  validationSummary?: StepValidationSummary,
  validationResults?: StepValidationResult[],
): string | null => {
  const details: string[] = []

  if (blockedReason && blockedReason !== GENERIC_VALIDATION_BLOCKED_REASON && !blockedReason.startsWith('validation issues recorded:')) {
    details.push(blockedReason)
  }
  if (validationSummary && (validationSummary.fail > 0 || validationSummary.pending > 0)) {
    details.push(formatValidationSummary(validationSummary))
  }

  const failed = formatValidationBucket('Failed', validationResults, 'fail')
  const pending = formatValidationBucket('Pending', validationResults, 'pending')
  if (failed) details.push(failed)
  if (pending) details.push(pending)

  if (details.length > 0) {
    return details.join(' | ')
  }

  return blockedReason ?? null
}

const phaseLabel = (phase: ExecutionPhase): string => {
  switch (phase) {
    case 'planning':
      return 'Planning'
    case 'narrating':
      return 'Narrating'
    case 'operating':
      return 'Operating'
    case 'validating':
      return 'Validating'
    case 'paused':
      return 'Paused'
    case 'stopping':
      return 'Stopping'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'reset':
      return 'Reset'
    case 'resetting':
      return 'Resetting'
    default:
      return 'Idle'
  }
}

const kindLabel = (kind: ExecutionTimelineEntry['kind']): string => {
  switch (kind) {
    case 'validation':
      return 'Validation'
    case 'issue':
      return 'Issue'
    case 'tool':
      return 'Tool'
    case 'progress':
      return 'Progress'
    default:
      return 'Lifecycle'
  }
}

const derivePhaseFromSnapshot = (snapshot: PlannedRunSnapshot | null): ExecutionPhase => {
  if (!snapshot?.runId) return 'idle'
  if (snapshot.completed) {
    const hasFailure = Object.values(snapshot.edgeStatuses).some((status) => status === 'fail')
    return hasFailure ? 'failed' : 'completed'
  }
  if (snapshot.stopRequested) return snapshot.running ? 'stopping' : 'paused'
  if (!snapshot.running) return 'paused'
  if (snapshot.currentPathId) return 'operating'
  return 'planning'
}

const deriveEventKind = (event: PlannedLiveEvent): ExecutionTimelineEntry['kind'] => {
  if (event.kind) return event.kind
  if (event.level === 'error') return 'issue'
  if (event.type.includes('tool')) return 'tool'
  if (event.type.includes('transition')) return 'validation'
  if (event.type.includes('path') || event.type.includes('batch') || event.type.includes('replan')) return 'progress'
  return 'lifecycle'
}

const deriveEventPhase = (event: PlannedLiveEvent): ExecutionPhase => {
  if (event.phase) return event.phase
  if (event.level === 'error') return 'failed'
  if (event.type === 'run.completed') return 'completed'
  if (event.type === 'run.reset') return 'reset'
  if (event.type === 'run.reset-requested') return 'resetting'
  if (event.type === 'path.paused') return 'paused'
  if (event.type === 'run.stop-requested') return 'stopping'
  if (event.type === 'run.stopped') return 'paused'
  if (event.type.startsWith('narrator')) return 'narrating'
  if (event.type.startsWith('operator') || event.type.startsWith('transition')) return 'operating'
  if (event.type.includes('planner') || event.type.startsWith('batch') || event.type.startsWith('replan')) return 'planning'
  return 'idle'
}

const shouldSurfaceEvent = (event: PlannedLiveEvent): boolean => {
  if (event.level === 'error') return true
  if (event.type === 'operator.decision' && isRecord(event.meta) && event.meta.exploratory === true) return true
  switch (event.type) {
    case 'run.starting':
    case 'run.started':
    case 'run.resumed':
    case 'run.stop-requested':
    case 'run.stopped':
    case 'run.reset-requested':
    case 'run.completed':
    case 'run.reset':
    case 'batch.started':
    case 'replan.started':
    case 'replan.completed':
    case 'path.started':
    case 'path.completed':
    case 'path.failed':
    case 'path.paused':
    case 'narrator.started':
    case 'narrator.completed':
    case 'operator.started':
    case 'operator.completed':
    case 'transition.started':
    case 'transition.completed':
    case 'transition.advanced':
    case 'operator.tool.started':
    case 'operator.tool.completed':
    case 'operator.tool.failed':
    case 'operator.batch.boundary':
    case 'agent.generation.completed':
    case 'executor.failed':
      return true
    default:
      return false
  }
}

const eventTitle = (event: PlannedLiveEvent): string => {
  if (event.type === 'agent.generation.completed') {
    const tag = isRecord(event.meta) && typeof event.meta.agentTag === 'string' ? event.meta.agentTag : 'agent'
    if (tag === 'path-planner') return 'Planner completed'
    if (tag === 'path-narrator') return 'Narrator completed'
    if (tag === 'path-narrator-input') return 'Narrator input loaded'
    if (tag === 'operator-loop') return 'Operator decision ready'
  }
  if (event.type === 'operator.decision' && isRecord(event.meta) && event.meta.exploratory === true) {
    return 'Exploration'
  }
  if (event.type.startsWith('path.') && event.pathName) return event.pathName
  if (event.stepLabel) return event.stepLabel
  if (event.type.startsWith('operator.tool.')) {
    const toolName = isRecord(event.meta) && typeof event.meta.toolName === 'string' ? event.meta.toolName : 'tool'
    return `Tool: ${toolName}`
  }
  if (event.type.startsWith('run.')) return 'Run'
  if (event.type.startsWith('batch.')) return 'Batch'
  if (event.type.startsWith('replan.')) return 'Replan'
  if (event.type.startsWith('operator.')) return 'Operator'
  if (event.type.startsWith('narrator.')) return 'Narrator'
  if (event.type.startsWith('transition.')) return 'Transition'
  return event.type
}

const toTimelineEntry = (event: PlannedLiveEvent): ExecutionTimelineEntry => ({
  id: `${event.runId ?? 'global'}:${event.seq}:${event.type}`,
  seq: event.seq,
  timestamp: event.emittedAt,
  level: event.level,
  phase: deriveEventPhase(event),
  kind: deriveEventKind(event),
  title: eventTitle(event),
  detail: formatBlockedReasonDetail(event.blockedReason, event.validationSummary, event.validationResults) ?? event.message,
  context: {
    pathId: event.pathId,
    pathName: event.pathName,
    semanticGoal: event.semanticGoal,
    pathOrder: event.pathOrder,
    totalPaths: event.totalPaths,
    stepId: event.stepId,
    stepLabel: event.stepLabel,
    stepOrder: event.currentStepOrder,
    totalSteps: event.currentPathStepTotal,
    currentStateId: event.currentStateId,
    nextStateId: event.nextStateId,
    activeEdgeId: event.activeEdgeId ?? event.edgeId,
  },
  diagnostics: {
    blockedReason: event.blockedReason,
    failureCode: event.failureCode,
    terminationReason: event.terminationReason,
    validationSummary: event.validationSummary,
    validationResults: event.validationResults,
    toolName: isRecord(event.meta) && typeof event.meta.toolName === 'string' ? event.meta.toolName : undefined,
    url: isRecord(event.meta) && typeof event.meta.url === 'string' ? event.meta.url : undefined,
    exploratory: isRecord(event.meta) && event.meta.exploratory === true,
    exploratoryKind:
      isRecord(event.meta) &&
      (event.meta.exploratoryIntentKind === 'prerequisite' || event.meta.exploratoryIntentKind === 'recovery' || event.meta.exploratoryIntentKind === 'diagnostic')
        ? event.meta.exploratoryIntentKind
        : undefined,
    exploratorySummary: isRecord(event.meta) && typeof event.meta.exploratoryIntentSummary === 'string' ? event.meta.exploratoryIntentSummary : undefined,
    exploratoryActionCount: isRecord(event.meta) && typeof event.meta.exploratoryActionCount === 'number' ? event.meta.exploratoryActionCount : undefined,
    exploratoryActionLimit: isRecord(event.meta) && typeof event.meta.exploratoryActionLimit === 'number' ? event.meta.exploratoryActionLimit : undefined,
    noProgressRounds: isRecord(event.meta) && typeof event.meta.noProgressRounds === 'number' ? event.meta.noProgressRounds : undefined,
    repeatedActionCount: isRecord(event.meta) && typeof event.meta.repeatedActionCount === 'number' ? event.meta.repeatedActionCount : undefined,
  },
  rawType: event.type,
})

const resolveActivePath = (plannedStatus: PlannedRunnerStatus | null): PathExecutionSummary | null => {
  if (!plannedStatus) return null
  if (plannedStatus.currentPathExecutionId) {
    const currentByExecution = plannedStatus.paths.find(
      (path) => path.pathExecutionId === plannedStatus.currentPathExecutionId,
    )
    if (currentByExecution) return currentByExecution
  }
  if (plannedStatus.currentPathId) {
    const currentById = [...plannedStatus.paths].reverse().find((path) => path.pathId === plannedStatus.currentPathId)
    if (currentById) return currentById
  }
  return [...plannedStatus.paths].reverse().find((path) => path.status !== 'pending') ?? null
}

const pathLabel = (plannedStatus: PlannedRunnerStatus | null): string => {
  if (!plannedStatus || plannedStatus.totalPaths === 0) return 'No path selected'
  const currentIndex = plannedStatus.currentPathId
    ? Math.min(plannedStatus.totalPaths, plannedStatus.completedPaths + plannedStatus.failedPaths + 1)
    : plannedStatus.completedPaths + plannedStatus.failedPaths
  const activePath = resolveActivePath(plannedStatus)
  return activePath ? `Path ${currentIndex}/${plannedStatus.totalPaths} · ${activePath.pathName}` : `Path ${currentIndex}/${plannedStatus.totalPaths}`
}

const latestValidationLabel = (timeline: ExecutionTimelineEntry[]): string => {
  const latestValidation = timeline.find((entry) => entry.diagnostics.validationSummary)
  if (!latestValidation?.diagnostics.validationSummary) {
    return 'No validation result yet'
  }
  return formatValidationSummary(latestValidation.diagnostics.validationSummary)
}

const buildOverview = (
  plannedStatus: PlannedRunnerStatus | null,
  timeline: ExecutionTimelineEntry[],
  statusMessage: string,
  currentStateId: string | null,
  nextStateId: string | null,
): ExecutionOverview => {
  const latestEntry = timeline[0] ?? null
  const activePath = resolveActivePath(plannedStatus)
  const phase = latestEntry?.phase ?? derivePhaseFromSnapshot(plannedStatus)
  const stepOrder = activePath?.currentTransitionOrder ?? plannedStatus?.currentStepOrder ?? null
  const stepTotal = activePath?.totalTransitions ?? plannedStatus?.currentPathStepTotal ?? null
  const stepName = activePath?.currentTransitionLabel ?? latestEntry?.context.stepLabel ?? 'Waiting for next step'
  const latestValidationSummary = activePath?.latestValidationSummary ?? latestEntry?.diagnostics.validationSummary
  return {
    phase,
    phaseLabel: phaseLabel(phase),
    statusLabel: statusMessage,
    pathLabel: pathLabel(plannedStatus),
    stepLabel: stepOrder && stepTotal ? `Step ${stepOrder}/${stepTotal} · ${stepName}` : stepName,
    goal: activePath?.semanticGoal ?? latestEntry?.context.semanticGoal ?? 'Start a run to generate an execution path.',
    routeLabel: currentStateId || nextStateId ? `${currentStateId ?? 'Unknown'} → ${nextStateId ?? 'Pending'}` : 'Route not active yet',
    latestValidationLabel: latestValidationSummary ? formatValidationSummary(latestValidationSummary) : latestValidationLabel(timeline),
    latestOutcomeLabel:
      activePath?.isExploring && activePath.latestExploratorySummary
        ? `Exploring · ${activePath.latestExploratorySummary}${activePath.exploratoryActionLimit > 0 ? ` (${activePath.exploratoryActionCount}/${activePath.exploratoryActionLimit})` : ''}`
        : activePath?.hasValidationWarnings && activePath.latestValidationSummary
        ? `Validation warning · ${formatValidationSummary(activePath.latestValidationSummary)}`
        : latestEntry
          ? `${kindLabel(latestEntry.kind)} · ${latestEntry.detail}`
          : statusMessage,
    blockedReason: formatBlockedReasonDetail(
      activePath?.blockedReason ?? latestEntry?.diagnostics.blockedReason ?? null,
      activePath?.blockedReason ? latestEntry?.diagnostics.validationSummary : activePath?.latestValidationSummary ?? latestEntry?.diagnostics.validationSummary,
      activePath?.blockedReason ? latestEntry?.diagnostics.validationResults : activePath?.latestValidationResults ?? latestEntry?.diagnostics.validationResults,
    ),
  }
}

const buildIssues = (
  plannedStatus: PlannedRunnerStatus | null,
  timeline: ExecutionTimelineEntry[],
  lastError: string | null,
  syncState: SyncState,
): ExecutionIssue[] => {
  const issues: ExecutionIssue[] = []
  const pushIssue = (issue: ExecutionIssue) => {
    if (issues.some((item) => item.title === issue.title && item.detail === issue.detail)) return
    issues.push(issue)
  }

  if (lastError) {
    pushIssue({
      id: `sync-error:${lastError}`,
      severity: 'error',
      title: 'State synchronization failed',
      detail: lastError,
      context: {},
      diagnostics: {},
      timestamp: new Date().toISOString(),
    })
  }

  if (syncState === 'reconnecting') {
    pushIssue({
      id: 'live-reconnect',
      severity: 'warning',
      title: 'Live stream reconnecting',
      detail: 'Execution is still running, but the live event stream is reconnecting. Snapshot reconcile remains active in the background.',
      context: {},
      diagnostics: {},
      timestamp: new Date().toISOString(),
    })
  }

  plannedStatus?.paths
    .filter((path) => Boolean(path.blockedReason))
    .slice()
    .reverse()
    .slice(0, 3)
    .forEach((path) => {
      const diagnostic = timeline.find(
        (entry) =>
          entry.context.pathId === path.pathId &&
          (Boolean(entry.diagnostics.validationSummary) || Boolean(entry.diagnostics.validationResults?.length) || entry.diagnostics.blockedReason === path.blockedReason),
      )

      pushIssue({
        id: `path-blocked:${path.pathId}:${path.blockedReason}`,
        severity: 'error',
        title: 'Path blocked',
        detail:
          formatBlockedReasonDetail(
            path.blockedReason,
            diagnostic?.diagnostics.validationSummary,
            diagnostic?.diagnostics.validationResults,
            ) ?? path.blockedReason ?? 'Execution blocked',
        context: {
          pathId: path.pathId,
          pathName: path.pathName,
          semanticGoal: path.semanticGoal,
          stepOrder: path.currentTransitionOrder,
          totalSteps: path.totalTransitions,
          currentStateId: path.currentStateId,
          nextStateId: path.nextStateId,
          activeEdgeId: path.activeEdgeId,
        },
        diagnostics: {
          blockedReason: path.blockedReason,
          validationSummary: diagnostic?.diagnostics.validationSummary,
          validationResults: diagnostic?.diagnostics.validationResults,
        },
        timestamp: path.completedAt ?? path.startedAt ?? new Date().toISOString(),
      })
    })

  plannedStatus?.paths
    .filter((path) => path.hasValidationWarnings && !path.blockedReason)
    .slice()
    .reverse()
    .slice(0, 3)
    .forEach((path) => {
      pushIssue({
        id: `path-validation-warning:${path.pathId}:${path.validationWarningCount}`,
        severity: 'warning',
        title: 'Path completed with validation issues',
        detail: formatBlockedReasonDetail(
          null,
          path.latestValidationSummary,
          path.latestValidationResults,
        ) ?? `Validation issues recorded on ${path.pathName}`,
        context: {
          pathId: path.pathId,
          pathName: path.pathName,
          semanticGoal: path.semanticGoal,
          stepOrder: path.currentTransitionOrder,
          totalSteps: path.totalTransitions,
          currentStateId: path.currentStateId,
          nextStateId: path.nextStateId,
          activeEdgeId: path.activeEdgeId,
        },
        diagnostics: {
          validationSummary: path.latestValidationSummary,
          validationResults: path.latestValidationResults,
        },
        timestamp: path.completedAt ?? path.startedAt ?? new Date().toISOString(),
      })
    })

  timeline
    .filter((entry) => entry.level === 'error')
    .slice(0, 5)
    .forEach((entry) => {
      pushIssue({
        id: `timeline-issue:${entry.id}`,
        severity: entry.level === 'error' ? 'error' : 'warning',
        title: entry.title,
        detail: entry.detail,
        context: entry.context,
        diagnostics: entry.diagnostics,
        timestamp: entry.timestamp,
      })
    })

  return issues.slice(0, 6)
}

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
  const [controlPhase, setControlPhase] = useState<ControlPhase>('idle')
  const [statusMessage, setStatusMessage] = useState('Idle')
  const [statusTone, setStatusTone] = useState<'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'warning' | 'error'>('idle')
  const [waitingElapsedSeconds, setWaitingElapsedSeconds] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [plannerRound, setPlannerRound] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [fullCoveragePassed, setFullCoveragePassed] = useState<boolean | null>(null)
  const [currentStateId, setCurrentStateId] = useState<string | null>(null)
  const [nextStateId, setNextStateId] = useState<string | null>(null)
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)
  const [targetUrl, setTargetUrl] = useState(import.meta.env.VITE_TARGET_URL || '')
  const [testingNotes, setTestingNotes] = useState('')
  const [testAccounts, setTestAccountsState] = useState<TestingAccount[]>([])
  const [timeline, setTimeline] = useState<ExecutionTimelineEntry[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [agentModes, setAgentModes] = useState<RunnerAgentModes>({
    pathPlanner: 'llm',
    pathNarrator: 'llm',
    operatorLoop: 'llm',
  })
  const [isSettingsBusy, setIsSettingsBusy] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [coverage, setCoverage] = useState<CoverageState>({
    visitedNodes: new Set<string>(),
    transitionResults: {},
    nodeStatuses: {},
    edgeStatuses: {},
  })
  const [plannedStatus, setPlannedStatus] = useState<PlannedRunnerStatus | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const pollInFlightRef = useRef(false)
  const reconcileTimerRef = useRef<number | null>(null)

  const setStopRequested = useCallback((next: boolean) => {
    setStopRequestedState(next)
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

  const applyLiveCursor = useCallback((event: PlannedLiveEvent) => {
    if (event.currentStateId !== undefined) {
      setCurrentStateId(event.currentStateId)
    }
    if (event.nextStateId !== undefined) {
      setNextStateId(event.nextStateId)
    }
    if (event.activeEdgeId !== undefined) {
      setActiveEdgeId(event.activeEdgeId)
    } else if (event.edgeId !== undefined) {
      setActiveEdgeId(event.edgeId)
    }
    if (isRecord(event.meta) && typeof event.meta.batchNumber === 'number') {
      setPlannerRound(event.meta.batchNumber)
    }
  }, [])

  const appendTimelineEvent = useCallback((event: PlannedLiveEvent) => {
    if (!shouldSurfaceEvent(event)) {
      return
    }
    const entry = toTimelineEntry(event)
    setTimeline((prev) => {
      if (prev.some((item) => item.id === entry.id)) {
        return prev
      }
      return [entry, ...prev].slice(0, MAX_TIMELINE_ENTRIES)
    })
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

  const applySnapshot = useCallback((snapshot: PlannedRunSnapshot, source: 'start' | 'status' | 'stop' | 'reconcile') => {
    setRunId(snapshot.runId)
    setAgentModes(snapshot.agentModes)
    setPlannerRound(snapshot.batchNumber)
    setCurrentStateId(snapshot.currentStateId)
    setNextStateId(snapshot.nextStateId)
    setActiveEdgeId(snapshot.activeEdgeId)
    setRunningState(snapshot.running)
    setStopRequested(snapshot.stopRequested)

    const visitedNodes = new Set(
      Object.entries(snapshot.nodeStatuses)
        .filter(([, status]) => status === 'pass' || status === 'running' || status === 'fail')
        .map(([nodeId]) => nodeId),
    )

    const transitionResults: Record<string, TransitionResult> = {}
    Object.entries(snapshot.edgeStatuses).forEach(([edgeId, status]) => {
      if (status === 'pass' || status === 'fail') {
        transitionResults[edgeId] = status
      }
    })

    setCoverage({
      visitedNodes,
      transitionResults,
      nodeStatuses: snapshot.nodeStatuses,
      edgeStatuses: snapshot.edgeStatuses,
    })

    if (!snapshot.runId) {
      setPlannedStatus(null)
      setCompleted(false)
      setFullCoveragePassed(null)
      setControlPhase('idle')
      setStatusTone('idle')
      setStatusMessage('Idle')
      setSyncState('idle')
      return
    }

    setPlannedStatus(snapshot)

    if (snapshot.completed) {
      setCompleted(true)
      setControlPhase('completed')
      const uncoveredTotal = snapshot.coverage.uncoveredEdgeIds.length + snapshot.coverage.uncoveredNodeIds.length
      const hasFailure = Object.values(snapshot.edgeStatuses).some((status) => status === 'fail')
      const hasValidationWarnings = snapshot.paths.some((path) => path.hasValidationWarnings)
      const passed = uncoveredTotal === 0 && !hasFailure && !hasValidationWarnings
      setFullCoveragePassed(passed)
      if (passed) {
        setStatusMessage('Full coverage complete: PASS')
        setStatusTone('success')
      } else if (hasFailure) {
        setStatusMessage('Run complete: execution failed on one or more paths')
        setStatusTone('error')
      } else if (hasValidationWarnings) {
        setStatusMessage('Run complete: execution continued, but validation issues were recorded')
        setStatusTone('warning')
      } else {
        setStatusMessage('Run complete: coverage incomplete')
        setStatusTone('warning')
      }
      return
    }

    setCompleted(false)
    setFullCoveragePassed(null)

    if (snapshot.stopRequested) {
      setControlPhase(snapshot.running ? 'stopping' : 'paused')
      setStatusTone(snapshot.running ? 'waiting' : 'paused')
      setStatusMessage(snapshot.running ? 'Stop requested. Waiting for the next tool boundary...' : 'Paused. Press Start to resume.')
      return
    }

    if (snapshot.running && snapshot.currentPathName) {
      const activePath = resolveActivePath(snapshot)
      setControlPhase('running')
      setStatusTone('running')
      setStatusMessage(
        activePath?.isExploring
          ? `Exploring ${snapshot.currentPathName} · ${activePath.latestExploratorySummary ?? 'establishing immediate prerequisite'}`
          : `Running ${snapshot.currentPathName} · step ${snapshot.currentStepOrder ?? 0}/${snapshot.currentPathStepTotal ?? 0}`,
      )
      return
    }

    if (snapshot.running) {
      setControlPhase('running')
      setStatusTone('running')
      setStatusMessage(source === 'start' ? 'Path batch started.' : 'Execution in progress...')
      return
    }

    setControlPhase('paused')
    setStatusTone('paused')
    setStatusMessage('Paused. Press Start to resume.')
  }, [setStopRequested])

  const reconcileStatus = useCallback(async (silent = false): Promise<boolean> => {
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
        const failureMessage = await formatHttpFailure(response, `Status reconcile failed (${response.status}).`)
        setLastError(failureMessage)
        setStatusTone('error')
        setStatusMessage('State sync failed.')
        return false
      }

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'reconcile')
      setLastError(null)
      if (eventSourceRef.current) {
        setSyncState('live')
      }
      return Boolean(data.snapshot.runId)
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setStatusTone('error')
      setStatusMessage('State sync failed: backend unavailable.')
      return false
    } finally {
      pollInFlightRef.current = false
      if (!silent) {
        setIsBusy(false)
      }
    }
  }, [applySnapshot, endpointBase, formatHttpFailure, formatRequestError])

  const scheduleReconcile = useCallback((delayMs = ACTIVE_RECONCILE_DEBOUNCE_MS) => {
    if (reconcileTimerRef.current !== null) {
      window.clearTimeout(reconcileTimerRef.current)
    }
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null
      void reconcileStatus(true)
    }, delayMs)
  }, [reconcileStatus])

  const connectLiveEvents = useCallback(() => {
    if (eventSourceRef.current) {
      return
    }

    const source = new EventSource(`${endpointBase}/events`)
    source.onopen = () => {
      setSyncState('live')
    }
    source.onmessage = (messageEvent) => {
      try {
        const payload = JSON.parse(messageEvent.data) as PlannedLiveEvent
        if (!payload || typeof payload.seq !== 'number' || typeof payload.message !== 'string') {
          return
        }
        setLastError(null)
        setSyncState('live')
        applyLiveCursor(payload)
        appendTimelineEvent(payload)
        if (payload.level === 'error' || deriveEventKind(payload) !== 'tool') {
          scheduleReconcile(payload.level === 'error' ? 0 : ACTIVE_RECONCILE_DEBOUNCE_MS)
        }
      } catch {
        // ignore malformed stream chunks
      }
    }
    source.onerror = () => {
      setSyncState('reconnecting')
      scheduleReconcile(0)
    }

    eventSourceRef.current = source
  }, [appendTimelineEvent, applyLiveCursor, endpointBase, scheduleReconcile])

  const disconnectLiveEvents = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setSyncState('idle')
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

  const startOrResume = useCallback(async (): Promise<boolean> => {
    if (diagrams.length === 0) return false
    if (!ensureTargetUrl()) return false

    if (!plannedStatus || plannedStatus.completed) {
      setTimeline([])
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
    setControlPhase('starting')
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
        const failureMessage = await formatHttpFailure(response, `Failed to start planned run (${response.status}).`)
        setLastError(failureMessage)
        setControlPhase(plannedStatus?.runId ? 'paused' : 'idle')
        setStatusTone('error')
        setStatusMessage('Start failed.')
        return false
      }

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'start')
      setSyncState('live')
      return true
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setControlPhase(plannedStatus?.runId ? 'paused' : 'idle')
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

    setControlPhase('stopping')
    setLastError(null)
    setStatusTone('waiting')
    setStatusMessage('Stop requested. Waiting for the next tool boundary...')

    try {
      const response = await fetch(`${endpointBase}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const failureMessage = await formatHttpFailure(response, `Stop request failed (${response.status}).`)
        setLastError(failureMessage)
        setControlPhase('running')
        setStatusTone('error')
        setStatusMessage('Stop failed.')
        return false
      }

      const data = (await response.json()) as PlannedRunnerResponse
      applySnapshot(data.snapshot, 'stop')
      scheduleReconcile(0)
      return true
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setControlPhase('running')
      setStatusTone('error')
      setStatusMessage('Stop failed: backend unavailable.')
      return false
    }
  }, [applySnapshot, endpointBase, formatHttpFailure, formatRequestError, plannedStatus, scheduleReconcile])

  const reset = useCallback(async () => {
    setIsBusy(true)
    setControlPhase('resetting')
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
        setControlPhase(plannedStatus?.runId ? 'paused' : 'idle')
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
      setTimeline([])
      setControlPhase('idle')
      setStatusTone('idle')
      setStatusMessage('Idle')
      setCoverage({
        visitedNodes: new Set<string>(),
        transitionResults: {},
        nodeStatuses: {},
        edgeStatuses: {},
      })
      setSyncState('idle')
    } catch (error) {
      const failureMessage = formatRequestError(error)
      setLastError(failureMessage)
      setControlPhase(plannedStatus?.runId ? 'paused' : 'idle')
      setStatusTone('error')
      setStatusMessage('Reset failed: backend unavailable.')
    } finally {
      setIsBusy(false)
    }
  }, [disconnectLiveEvents, endpointBase, formatRequestError, plannedStatus?.runId, setStopRequested])

  useEffect(() => {
    return () => {
      if (reconcileTimerRef.current !== null) {
        window.clearTimeout(reconcileTimerRef.current)
      }
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
    if (!plannedStatus.running && !plannedStatus.stopRequested && syncState !== 'reconnecting') {
      return
    }

    void reconcileStatus(true)
    const timer = window.setInterval(() => {
      void reconcileStatus(true)
    }, ACTIVE_RECONCILE_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [plannedStatus?.runId, plannedStatus?.running, plannedStatus?.stopRequested, reconcileStatus, syncState])

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

  const overview = useMemo(
    () => buildOverview(plannedStatus, timeline, statusMessage, currentStateId, nextStateId),
    [plannedStatus, timeline, statusMessage, currentStateId, nextStateId],
  )

  const issues = useMemo(
    () => buildIssues(plannedStatus, timeline, lastError, syncState),
    [plannedStatus, timeline, lastError, syncState],
  )

  const canStop = running && !stopRequested && controlPhase !== 'resetting'
  const canReset = controlPhase !== 'resetting' && Boolean(runId || plannedStatus?.runId || running || stopRequested || timeline.length > 0)

  return {
    running,
    stopRequested,
    isBusy,
    controlPhase,
    canStop,
    canReset,
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
    coverage,
    plannedStatus,
    targetUrl,
    testingNotes,
    testAccounts,
    runId,
    agentModes,
    isSettingsBusy,
    timeline,
    issues,
    overview,
    syncState,
    applyAgentModes,
    setAgentMode,
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
    reset: () => {
      void reset()
    },
  }
}