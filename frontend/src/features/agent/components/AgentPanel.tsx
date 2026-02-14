import type { AgentLogEntry, CoverageState, Diagram, PlannedRunnerStatus, PlannedStepEvent } from '../../../types'

interface AgentPanelProps {
  diagrams: Diagram[]
  coverage: CoverageState
  logs: AgentLogEntry[]
  currentStateId: string | null
  nextStateId: string | null
  latestEvent: PlannedStepEvent | null
  running: boolean
  isBusy: boolean
  statusMessage: string
  statusTone: 'idle' | 'waiting' | 'running' | 'paused' | 'success' | 'error'
  lastError: string | null
  plannerRound: number
  completed: boolean
  fullCoveragePassed: boolean | null
  onStart: () => void
  onStop: () => void
  onStep: () => void
  onReset: () => void
  targetUrl: string
  onTargetUrlChange: (value: string) => void
  plannedStatus: PlannedRunnerStatus | null
  focusMode: 'off' | 'current' | 'path'
  onCycleFocusMode: () => void
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString()

export const AgentPanel = ({
  diagrams,
  coverage,
  logs,
  currentStateId,
  nextStateId,
  latestEvent,
  running,
  isBusy,
  statusMessage,
  statusTone,
  lastError,
  plannerRound,
  completed,
  fullCoveragePassed,
  onStart,
  onStop,
  onStep,
  onReset,
  targetUrl,
  onTargetUrlChange,
  plannedStatus,
  focusMode,
  onCycleFocusMode,
}: AgentPanelProps) => {
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
    plannedStatus && plannedStatus.plannedPaths > 0
      ? Math.min(
          plannedStatus.plannedPaths,
          plannedStatus.currentPathId ? plannedStatus.completedPaths + 1 : plannedStatus.completedPaths,
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
  const hasValidationResults = (latestEvent?.validationResults?.length ?? 0) > 0
  const runModeLabel = running ? 'Auto' : 'Manual'
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
            disabled={isBusy}
            title={running ? 'Pause' : 'Start'}
            aria-label={running ? 'Pause' : 'Start'}
          >
            {running ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="6" width="3.6" height="12" rx="1" fill="currentColor" />
                <rect x="13.4" y="6" width="3.6" height="12" rx="1" fill="currentColor" />
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
            onClick={onStep}
            disabled={isBusy || running}
            title="Step"
            aria-label="Step"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6h2.4v12H6z" fill="currentColor" />
              <path d="M10 7v10a1 1 0 0 0 1.56.83l6.8-4.95a1 1 0 0 0 0-1.66l-6.8-4.95A1 1 0 0 0 10 7z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-icon-btn"
            onClick={onReset}
            disabled={isBusy}
            title="Reset"
            aria-label="Reset"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5a7 7 0 1 1-6.2 3.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M4.8 5.2v4.2H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
            {toneLabel}
          </span>
        </div>
        <div className="agent-status-meta">
          <span className="agent-meta-chip">Planner {plannerLabel}</span>
          <span className="agent-meta-chip">Mode {runModeLabel}</span>
          <span className="agent-meta-chip">Coverage {coverageLabel}</span>
        </div>
        {lastError ? <p className="agent-error-banner">{lastError}</p> : null}
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
              <dd>{plannedStatus ? `${pathCurrentIndex}/${plannedStatus.plannedPaths}` : 'N/A'}</dd>
            </div>
            <div className="agent-keyval-row">
              <dt>Step</dt>
              <dd>{plannedStatus ? `${stepCurrentIndex}/${stepTotal}` : 'N/A'}</dd>
            </div>
          </div>

          <div className="agent-keyval-column wide">
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

      <div className="agent-detail-stack">
        <section className="agent-card agent-scroll-card">
          <div className="agent-card-header">
            <h4>Validation Results</h4>
          </div>
          <div className="agent-scroll-region agent-validation-list">
            {latestEvent ? (
              <>
                <p className="agent-validation-summary">
                  [{latestEvent.result.toUpperCase()}] {latestEvent.step.label} : {latestEvent.pathName}
                </p>
                {latestEvent.blockedReason ? <p className="agent-validation-summary">Blocked: {latestEvent.blockedReason}</p> : null}
                {hasValidationResults ? (
                  <ul>
                    {(latestEvent.validationResults ?? []).map((validation) => (
                      <li key={validation.id} className="agent-validation-row">
                        <span className={`validation-status-tag ${validation.status}`}>
                          {validation.status.toUpperCase()}
                        </span>
                        <span className="validation-label">{validation.label}</span>
                        <span className="validation-reason">{validation.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No validations for this step.</p>
                )}
              </>
            ) : (
              <p className="muted">No step executed yet.</p>
            )}
          </div>
        </section>

        <section className="agent-card agent-scroll-card live-events-card">
          <div className="agent-card-header">
            <h4>Live Events</h4>
          </div>
          <div className="agent-scroll-region agent-logs">
            {logs.length === 0 ? (
              <p className="muted">No agent events yet.</p>
            ) : (
              <ul>
                {logs.map((log) => (
                  <li key={log.id} className={`log ${log.level}`}>
                    <span>{formatTime(log.timestamp)}</span>
                    <span>{log.message}</span>
                    <span>{log.role ?? 'system'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
