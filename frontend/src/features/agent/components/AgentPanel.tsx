import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CoverageState,
  Diagram,
  ExecutionIssue,
  ExecutionOverview,
  ExecutionTimelineEntry,
  PlannedRunnerStatus,
  RunnerAgentModes,
  TestingAccount,
} from '../../../types'

interface AgentPanelProps {
  diagrams: Diagram[]
  coverage: CoverageState
  currentStateId: string | null
  nextStateId: string | null
  running: boolean
  stopRequested: boolean
  isBusy: boolean
  controlPhase: 'idle' | 'starting' | 'running' | 'stopping' | 'paused' | 'resetting' | 'completed'
  canStop: boolean
  canReset: boolean
  statusMessage: string
  statusTone: 'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'
  waitingElapsedSeconds: number
  plannerRound: number
  completed: boolean
  fullCoveragePassed: boolean | null
  onStart: () => void
  onStop: () => void
  onReset: () => void
  targetUrl: string
  onTargetUrlChange: (value: string) => void
  testingNotes: string
  onTestingNotesChange: (value: string) => void
  testAccounts: TestingAccount[]
  agentModes: RunnerAgentModes
  isSettingsBusy: boolean
  onAgentModeChange: (agent: keyof RunnerAgentModes, mode: 'llm' | 'mock') => void
  onTestAccountFieldChange: (index: number, field: keyof TestingAccount, value: string) => void
  onAddTestAccount: () => void
  onRemoveTestAccount: (index: number) => void
  plannedStatus: PlannedRunnerStatus | null
  focusMode: 'off' | 'current' | 'path'
  onCycleFocusMode: () => void
  timeline: ExecutionTimelineEntry[]
  issues: ExecutionIssue[]
  overview: ExecutionOverview
  syncState: 'idle' | 'live' | 'reconnecting'
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString()

const formatSyncState = (syncState: AgentPanelProps['syncState']): string => {
  switch (syncState) {
    case 'live':
      return 'Live Sync'
    case 'reconnecting':
      return 'Reconnecting'
    default:
      return 'Standby'
  }
}

const formatTimelineKind = (entry: ExecutionTimelineEntry): string => {
  switch (entry.kind) {
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

export const AgentPanel = ({
  diagrams,
  coverage,
  currentStateId,
  nextStateId,
  running,
  stopRequested,
  isBusy,
  controlPhase,
  canStop,
  canReset,
  statusMessage,
  statusTone,
  waitingElapsedSeconds,
  plannerRound,
  completed,
  fullCoveragePassed,
  onStart,
  onStop,
  onReset,
  targetUrl,
  onTargetUrlChange,
  testingNotes,
  onTestingNotesChange,
  testAccounts,
  agentModes,
  isSettingsBusy,
  onAgentModeChange,
  onTestAccountFieldChange,
  onAddTestAccount,
  onRemoveTestAccount,
  plannedStatus,
  focusMode,
  onCycleFocusMode,
  timeline,
  issues,
  overview,
  syncState,
}: AgentPanelProps) => {
  const [showTestingInfoModal, setShowTestingInfoModal] = useState(false)
  const [showAgentSettingsModal, setShowAgentSettingsModal] = useState(false)
  const [consoleTab, setConsoleTab] = useState<'overview' | 'issues' | 'timeline'>('overview')
  const allStates = diagrams.flatMap((diagram) => diagram.states)
  const totalStates = allStates.length
  const visitedStates = coverage.visitedNodes.size
  const fallbackTransitions = diagrams.reduce((acc, diagram) => acc + diagram.transitions.length, 0)
  const fallbackInvokedConnectors = diagrams.reduce(
    (acc, diagram) => acc + diagram.connectors.filter((connector) => connector.type === 'invokes').length,
    0,
  )
  const edgeStatusCount = Object.keys(coverage.edgeStatuses ?? {}).length
  const totalTransitions =
    edgeStatusCount > 0
      ? edgeStatusCount
      : fallbackTransitions + fallbackInvokedConnectors
  const passCount = Object.values(coverage.transitionResults).filter((value) => value === 'pass').length
  const failCount = Object.values(coverage.transitionResults).filter((value) => value === 'fail').length
  const stateSummary = `${visitedStates} / ${totalStates}`
  const transitionSummary = `${passCount} / ${failCount} / ${totalTransitions}`
  const pathCurrentIndex =
    plannedStatus && plannedStatus.totalPaths > 0
      ? Math.min(
          plannedStatus.totalPaths,
          plannedStatus.currentPathId
            ? plannedStatus.completedPaths + plannedStatus.failedPaths + 1
            : plannedStatus.completedPaths + plannedStatus.failedPaths,
        )
      : 0

  const stepCurrentIndex =
    plannedStatus && (plannedStatus.currentPathStepTotal ?? 0) > 0
      ? Math.min(
          Math.max(0, plannedStatus.currentStepOrder ?? 0),
          Math.max(0, plannedStatus.currentPathStepTotal ?? 0),
        )
      : 0

  const stepTotal = plannedStatus?.currentPathStepTotal ?? 0
  const runModeLabel = controlPhase === 'stopping' ? 'Stopping' : running ? 'Auto' : plannedStatus ? 'Standby' : 'Idle'
  const coverageLabel = completed ? (fullCoveragePassed ? 'Pass' : 'Not Pass') : 'In Progress'
  const plannerLabel = plannerRound > 0 ? `Round ${plannerRound}` : 'Not Started'

  const toneLabel =
    statusTone === 'waiting'
      ? 'Waiting'
      : statusTone === 'running'
        ? 'Running'
        : statusTone === 'paused'
          ? 'Paused'
          : statusTone === 'success'
            ? 'Success'
            : statusTone === 'error'
              ? 'Error'
              : 'Idle'

  const focusModeLabel =
    focusMode === 'off' ? 'Focus: Off' : focusMode === 'current' ? 'Focus: Current Node' : 'Focus: Path'

  const nextStateLabel = nextStateId ?? 'N/A'
  const activePath = useMemo(() => {
    if (!plannedStatus) {
      return null
    }

    if (plannedStatus.currentPathExecutionId) {
      const currentByExecution = plannedStatus.paths.find(
        (path) => path.pathExecutionId === plannedStatus.currentPathExecutionId,
      )
      if (currentByExecution) {
        return currentByExecution
      }
    }

    if (plannedStatus.currentPathId) {
      const currentById = [...plannedStatus.paths]
        .reverse()
        .find((path) => path.pathId === plannedStatus.currentPathId)
      if (currentById) {
        return currentById
      }
    }

    return [...plannedStatus.paths]
      .reverse()
      .find((path) => path.status !== 'pending') ?? null
  }, [plannedStatus])

  const testingInfoModal =
    showTestingInfoModal && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-backdrop testing-info-backdrop" role="presentation" onClick={() => setShowTestingInfoModal(false)}>
            <div
              className="modal testing-info-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Testing Info"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header testing-info-modal-header">
                <div className="testing-info-title-wrap">
                  <h3 className="section-title testing-info-modal-title">
                    <span className="testing-info-title-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M8 9h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M8 13h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    Testing Info
                  </h3>
                </div>
                <button
                  type="button"
                  className="icon-button testing-info-close"
                  onClick={() => setShowTestingInfoModal(false)}
                  aria-label="Close testing info"
                >
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                    <path d="M7 7 17 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="modal-body testing-info-modal-body">
                <section className="agent-card agent-testing-info testing-info-section">
                  <div className="agent-card-header testing-info-section-header">
                    <h4>
                      <span className="testing-info-section-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M5.5 18.5c1.5-3.1 4-4.7 6.5-4.7s5 1.6 6.5 4.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      Accounts
                    </h4>
                    <button type="button" className="agent-mini-btn testing-info-add-btn" onClick={onAddTestAccount}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      Add Account
                    </button>
                  </div>

                  <div className="agent-test-accounts">
                    {testAccounts.length === 0 ? (
                      <p className="muted">No test accounts yet.</p>
                    ) : (
                      testAccounts.map((account, index) => (
                        <div key={`test-account-${index}`} className="agent-account-card">
                          <div className="agent-account-inline">
                            <span className="agent-account-order" aria-label={`Account ${index + 1}`}>
                              {index + 1}.
                            </span>
                            <input
                              type="text"
                              placeholder="Role"
                              value={account.role ?? ''}
                              onChange={(event) => onTestAccountFieldChange(index, 'role', event.target.value)}
                            />
                            <input
                              type="text"
                              placeholder="Username"
                              value={account.username ?? ''}
                              onChange={(event) => onTestAccountFieldChange(index, 'username', event.target.value)}
                            />
                            <input
                              type="text"
                              placeholder="Password"
                              value={account.password ?? ''}
                              onChange={(event) => onTestAccountFieldChange(index, 'password', event.target.value)}
                            />
                            <input
                              type="text"
                              placeholder="Description"
                              value={account.description ?? ''}
                              onChange={(event) => onTestAccountFieldChange(index, 'description', event.target.value)}
                            />
                            <button
                              type="button"
                              className="agent-account-remove"
                              onClick={() => onRemoveTestAccount(index)}
                              aria-label={`Remove account ${index + 1}`}
                              title="Remove account"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4.5 7h15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <path d="M9.5 7V5.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <path d="M6.8 7.8h10.4l-.7 10.1a1.8 1.8 0 0 1-1.8 1.6H9.3a1.8 1.8 0 0 1-1.8-1.6L6.8 7.8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                                <path d="M10 11v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                <path d="M14 11v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="agent-card agent-testing-info testing-info-section">
                  <div className="agent-card-header testing-info-section-header">
                    <h4>
                      <span className="testing-info-section-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M6 5.5h9.5L19 9v9.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 6 5.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M15.5 5.5V9H19" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                      Notes
                    </h4>
                  </div>
                  <label className="agent-url-field" aria-label="Testing notes">
                    <textarea
                      placeholder="Additional notes (example: login route, OTP handling notes, prerequisites...)"
                      value={testingNotes}
                      onChange={(event) => onTestingNotesChange(event.target.value)}
                      rows={6}
                    />
                  </label>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  const agentSettingsModal =
    showAgentSettingsModal && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-backdrop testing-info-backdrop" role="presentation" onClick={() => setShowAgentSettingsModal(false)}>
            <div
              className="modal testing-info-modal agent-settings-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Agent Settings"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header testing-info-modal-header">
                <div className="testing-info-title-wrap">
                  <h3 className="section-title testing-info-modal-title">
                    <span className="testing-info-title-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M12 8v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <circle cx="12" cy="15.5" r="1" fill="currentColor" />
                      </svg>
                    </span>
                    Agent Settings
                  </h3>
                </div>
                <button
                  type="button"
                  className="icon-button testing-info-close"
                  onClick={() => setShowAgentSettingsModal(false)}
                  aria-label="Close agent settings"
                >
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                    <path d="M7 7 17 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="modal-body testing-info-modal-body">
                <section className="agent-card agent-testing-info testing-info-section">
                  <div className="agent-card-header testing-info-section-header">
                    <h4>
                      Agent Mode
                      <span className="agent-settings-note">變更會在下一條 path 或下一次 resume 生效；目前進行中的 path 不會被中斷。</span>
                    </h4>
                  </div>

                  <div className="agent-settings-grid">
                    <label className="agent-settings-row">
                      <span>Path Planner</span>
                      <div className="agent-mode-switch" role="group" aria-label="Path Planner mode">
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.pathPlanner === 'llm' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('pathPlanner', 'llm')}
                          disabled={isSettingsBusy || agentModes.pathPlanner === 'llm'}
                          aria-pressed={agentModes.pathPlanner === 'llm'}
                        >
                          LLM
                        </button>
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.pathPlanner === 'mock' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('pathPlanner', 'mock')}
                          disabled={isSettingsBusy || agentModes.pathPlanner === 'mock'}
                          aria-pressed={agentModes.pathPlanner === 'mock'}
                        >
                          Mock
                        </button>
                      </div>
                    </label>

                    <label className="agent-settings-row">
                      <span>Path Narrator</span>
                      <div className="agent-mode-switch" role="group" aria-label="Path Narrator mode">
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.pathNarrator === 'llm' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('pathNarrator', 'llm')}
                          disabled={isSettingsBusy || agentModes.pathNarrator === 'llm'}
                          aria-pressed={agentModes.pathNarrator === 'llm'}
                        >
                          LLM
                        </button>
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.pathNarrator === 'mock' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('pathNarrator', 'mock')}
                          disabled={isSettingsBusy || agentModes.pathNarrator === 'mock'}
                          aria-pressed={agentModes.pathNarrator === 'mock'}
                        >
                          Mock
                        </button>
                      </div>
                    </label>

                    <label className="agent-settings-row">
                      <span>Operator Loop</span>
                      <div className="agent-mode-switch" role="group" aria-label="Operator Loop mode">
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.operatorLoop === 'llm' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('operatorLoop', 'llm')}
                          disabled={isSettingsBusy || agentModes.operatorLoop === 'llm'}
                          aria-pressed={agentModes.operatorLoop === 'llm'}
                        >
                          LLM
                        </button>
                        <button
                          type="button"
                          className={`agent-mode-option ${agentModes.operatorLoop === 'mock' ? 'active' : ''}`}
                          onClick={() => onAgentModeChange('operatorLoop', 'mock')}
                          disabled={isSettingsBusy || agentModes.operatorLoop === 'mock'}
                          aria-pressed={agentModes.operatorLoop === 'mock'}
                        >
                          Mock
                        </button>
                      </div>
                    </label>
                  </div>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className="panel agent-panel">
      <div className="agent-panel-title">
        <span className="section-title">
          <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 7v5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Agent Control
        </span>
      </div>

      <div className="agent-topbar">
        <label className="agent-url-field" aria-label="Target URL">
          <input
            type="url"
            placeholder="https://your-site.example"
            value={targetUrl}
            onChange={(event) => onTargetUrlChange(event.target.value)}
          />
        </label>

        <div className="agent-icon-controls" role="group" aria-label="Agent run controls">
          <button
            type="button"
            className="agent-icon-btn primary"
            onClick={running ? onStop : onStart}
            disabled={running ? !canStop : isBusy || controlPhase === 'resetting'}
            title={running ? (stopRequested ? 'Stopping...' : 'Stop') : (controlPhase === 'starting' ? 'Starting...' : 'Start')}
            aria-label={running ? (stopRequested ? 'Stopping...' : 'Stop') : (controlPhase === 'starting' ? 'Starting...' : 'Start')}
          >
            {running ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6.8v10.4a1 1 0 0 0 1.52.85l8-5.2a1 1 0 0 0 0-1.7l-8-5.2A1 1 0 0 0 8 6.8z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="agent-icon-btn"
            onClick={onReset}
            disabled={!canReset}
            title={controlPhase === 'resetting' ? 'Resetting...' : 'Reset'}
            aria-label={controlPhase === 'resetting' ? 'Resetting...' : 'Reset'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5a7 7 0 1 1-6.2 3.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M4.8 5.2v4.2H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-icon-btn"
            onClick={() => setShowTestingInfoModal(true)}
            title="Testing Info"
            aria-label="Testing Info"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 9h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M8 13h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-icon-btn"
            onClick={() => setShowAgentSettingsModal(true)}
            title="Agent Settings"
            aria-label="Agent Settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 4.2v2.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M12 17.7v2.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M4.2 12h2.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M17.7 12h2.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="m6.6 6.6 1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="m15.9 15.9 1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="m17.4 6.6-1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="m8.1 15.9-1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`agent-icon-btn focus-toggle mode-${focusMode}`}
            onClick={onCycleFocusMode}
            title={focusModeLabel}
            aria-label={focusModeLabel}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="2.1" fill="currentColor" />
              <path d="M12 3v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M12 18v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M3 12h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M18 12h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="agent-status-card">
        <div className="agent-header">
          <p className="agent-status-message">{statusMessage}</p>
          <span className={`status-pill ${statusTone}`}>
            {statusTone === 'waiting' ? <span className="status-spinner" aria-hidden="true" /> : null}
            {statusTone === 'waiting' ? `${toneLabel} ${waitingElapsedSeconds}s` : toneLabel}
          </span>
        </div>
        <div className="agent-status-meta">
          <span className="agent-meta-chip">Planner {plannerLabel}</span>
          <span className="agent-meta-chip">Mode {runModeLabel}</span>
          <span className="agent-meta-chip">Coverage {coverageLabel}</span>
        </div>
      </div>

      <div className="agent-summary">
        <div className="summary-card modern">
          <div className="summary-head">
            <h4>State</h4>
            <span
              className="summary-hint"
              role="note"
              tabIndex={0}
              aria-label="已拜訪 / 總數"
              data-tooltip="已拜訪 / 總數"
            >
              !
            </span>
          </div>
          <p className="summary-value">{stateSummary}</p>
        </div>
        <div className="summary-card modern">
          <div className="summary-head">
            <h4>Transition</h4>
            <span
              className="summary-hint"
              role="note"
              tabIndex={0}
              aria-label="成功 / 失敗 / 總數"
              data-tooltip="成功 / 失敗 / 總數"
            >
              !
            </span>
          </div>
          <p className="summary-value">{transitionSummary}</p>
        </div>
      </div>

      <div className="agent-card agent-path-card">
        <h4>Path Progress</h4>
        <dl className="agent-keyvals agent-keyvals-columns">
          <div className="agent-keyval-column compact">
            <div className="agent-keyval-row">
              <dt>Path</dt>
              <dd>{plannedStatus ? `${pathCurrentIndex}/${plannedStatus.totalPaths}` : 'N/A'}</dd>
            </div>
            <div className="agent-keyval-row">
              <dt>Step</dt>
              <dd>{plannedStatus ? `${stepCurrentIndex}/${stepTotal}` : 'N/A'}</dd>
            </div>
            <div className="agent-keyval-row">
              <dt>Failed</dt>
              <dd>{plannedStatus ? `${plannedStatus.failedPaths}` : 'N/A'}</dd>
            </div>
          </div>

          <div className="agent-keyval-column wide">
            <div className="agent-keyval-row">
              <dt>Batch</dt>
              <dd>{plannedStatus ? `${plannedStatus.batchNumber}` : 'N/A'}</dd>
            </div>
            <div className="agent-keyval-row">
              <dt>Current State</dt>
              <dd>{plannedStatus ? (currentStateId ?? 'N/A') : 'N/A'}</dd>
            </div>
            <div className="agent-keyval-row">
              <dt>Next State</dt>
              <dd>{plannedStatus ? nextStateLabel : 'N/A'}</dd>
            </div>
          </div>
        </dl>
      </div>

      <section className="agent-card agent-execution-console">
        <div className="agent-card-header agent-console-header">
          <div className="agent-console-heading">
            <h4>Execution Console</h4>
            <div className="agent-console-statuses">
              <span className={`agent-sync-pill ${syncState}`}>{formatSyncState(syncState)}</span>
              <span className="agent-sync-pill neutral">{overview.phaseLabel}</span>
            </div>
          </div>
          <div className="agent-console-actions" role="tablist" aria-label="Execution console tabs">
          <button
            type="button"
            role="tab"
            aria-selected={consoleTab === 'overview'}
            className={`agent-console-icon-tab ${consoleTab === 'overview' ? 'active' : ''}`}
            onClick={() => setConsoleTab('overview')}
            title="Overview"
            aria-label="Overview"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <rect x="14" y="4" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <rect x="4" y="14" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <rect x="14" y="14" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={consoleTab === 'issues'}
            className={`agent-console-icon-tab ${consoleTab === 'issues' ? 'active' : ''}`}
            onClick={() => setConsoleTab('issues')}
            title="Issues"
            aria-label="Issues"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4 20 19H4L12 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M12 9v4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="16.8" r="1" fill="currentColor" />
            </svg>
            {issues.length > 0 ? <span className="agent-console-icon-tab-count">{issues.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={consoleTab === 'timeline'}
            className={`agent-console-icon-tab ${consoleTab === 'timeline' ? 'active' : ''}`}
            onClick={() => setConsoleTab('timeline')}
            title="Timeline"
            aria-label="Timeline"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 7h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M6 17h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="17.5" cy="17" r="1.3" fill="currentColor" />
            </svg>
            {timeline.length > 0 ? <span className="agent-console-icon-tab-count">{Math.min(timeline.length, 99)}</span> : null}
          </button>
        </div>
        </div>

        <div className="agent-scroll-region agent-console-body">
          {consoleTab === 'overview' ? (
            <div className="agent-console-overview">
              <div className="agent-console-grid">
                <article className="agent-console-card accent">
                  <span className="agent-console-label">Current Route</span>
                  <strong>{overview.routeLabel}</strong>
                  <p>{overview.statusLabel}</p>
                </article>
                <article className="agent-console-card">
                  <span className="agent-console-label">Path</span>
                  <strong>{overview.pathLabel}</strong>
                  <p>{overview.stepLabel}</p>
                </article>
                <article className="agent-console-card">
                  <span className="agent-console-label">Validation</span>
                  <strong>{overview.latestValidationLabel}</strong>
                  <p>{overview.latestOutcomeLabel}</p>
                </article>
              </div>

              <div className="agent-console-summary-list">
                <div className="agent-console-summary-row">
                  <span>Goal</span>
                  <strong>{overview.goal}</strong>
                </div>
                <div className="agent-console-summary-row">
                  <span>Active Path</span>
                  <strong>{activePath?.pathName ?? 'Not started yet'}</strong>
                </div>
                <div className="agent-console-summary-row">
                  <span>Execution Context</span>
                  <strong>
                    {activePath
                      ? `batch ${activePath.batchNumber}${activePath.attemptId ? ` · attempt ${activePath.attemptId}` : ''}`
                      : 'No active batch'}
                  </strong>
                </div>
                <div className="agent-console-summary-row multiline">
                  <span>Blocked Reason</span>
                  <strong>{overview.blockedReason ?? 'None'}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {consoleTab === 'issues' ? (
            <div className="agent-console-issues">
              {issues.length === 0 ? (
                <p className="muted">No blocking issue detected. Validation and runtime errors will appear here first.</p>
              ) : (
                <ul className="agent-issue-list">
                  {issues.map((issue) => (
                    <li key={issue.id} className={`agent-issue-row ${issue.severity}`}>
                      <div className="agent-issue-topline">
                        <span className={`validation-status-tag ${issue.severity === 'error' ? 'fail' : issue.severity === 'warning' ? 'pending' : 'pass'}`}>
                          {issue.severity.toUpperCase()}
                        </span>
                        <strong>{issue.title}</strong>
                        <span className="agent-issue-time">{formatTime(issue.timestamp)}</span>
                      </div>
                      <p>{issue.detail}</p>
                      {issue.context.pathName || issue.context.stepLabel ? (
                        <div className="agent-issue-context">
                          {issue.context.pathName ? <span>Path: {issue.context.pathName}</span> : null}
                          {issue.context.stepLabel ? <span>Step: {issue.context.stepLabel}</span> : null}
                          {issue.context.activeEdgeId ? <span>Edge: {issue.context.activeEdgeId}</span> : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {consoleTab === 'timeline' ? (
            <div className="agent-console-timeline">
              {timeline.length === 0 ? (
                <p className="muted">No execution events yet.</p>
              ) : (
                <ul className="agent-timeline-list">
                  {timeline.map((entry) => (
                    <li key={entry.id} className={`agent-timeline-row ${entry.level}`}>
                      <div className="agent-timeline-head">
                        <span className="agent-timeline-time">{formatTime(entry.timestamp)}</span>
                        <span className={`validation-status-tag ${entry.level === 'error' ? 'fail' : entry.kind === 'validation' ? 'pending' : 'pass'}`}>
                          {formatTimelineKind(entry)}
                        </span>
                        <strong>{entry.title}</strong>
                      </div>
                      <p>{entry.detail}</p>
                      <div className="agent-timeline-meta">
                        <span>{entry.phase}</span>
                        {entry.context.pathName ? <span>{entry.context.pathName}</span> : null}
                        {entry.context.stepLabel ? <span>{entry.context.stepLabel}</span> : null}
                        {entry.diagnostics.toolName ? <span>{entry.diagnostics.toolName}</span> : null}
                        {entry.diagnostics.blockedReason ? <span>{entry.diagnostics.blockedReason}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {testingInfoModal}
      {agentSettingsModal}
    </div>
  )
}
