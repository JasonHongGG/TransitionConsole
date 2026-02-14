import type { AgentLogEntry, CoverageState, Diagram, PlannedRunnerStatus, PlannedStepEvent } from '../../../types'

interface AgentPanelProps {
  diagrams: Diagram[]
  coverage: CoverageState
  logs: AgentLogEntry[]
  currentStateId: string | null
  latestEvent: PlannedStepEvent | null
  running: boolean
  onStart: () => void
  onStop: () => void
  onStep: () => void
  onReset: () => void
  targetUrl: string
  onTargetUrlChange: (value: string) => void
  plannedStatus: PlannedRunnerStatus | null
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString()

export const AgentPanel = ({
  diagrams,
  coverage,
  logs,
  currentStateId,
  latestEvent,
  running,
  onStart,
  onStop,
  onStep,
  onReset,
  targetUrl,
  onTargetUrlChange,
  plannedStatus,
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
          plannedStatus.currentPathStepTotal ?? 0,
          plannedStatus.currentStepOrder ?? 0,
        )
      : 0

  const stepTotal = plannedStatus?.currentPathStepTotal ?? 0

  const edgeToNextStateId = new Map<string, string>()
  diagrams.forEach((diagram) => {
    diagram.transitions.forEach((transition) => {
      edgeToNextStateId.set(transition.id, transition.to)
    })
    diagram.connectors
      .filter((connector) => connector.type === 'invokes' && connector.to.stateId)
      .forEach((connector) => {
        edgeToNextStateId.set(connector.id, connector.to.stateId as string)
      })
  })

  const currentStepEdgeId = plannedStatus?.currentStepId
    ? plannedStatus.currentStepId.replace(/\.step\.\d+$/, '')
    : null
  const nextStateId = currentStepEdgeId ? (edgeToNextStateId.get(currentStepEdgeId) ?? 'N/A') : 'N/A'

  return (
    <div className="panel agent-panel">
      <div className="agent-header">
        <h3>Agent Control (planned)</h3>
        <span className={`status-pill ${running ? 'running' : ''}`}>
          {running ? 'Running' : 'Idle'}
        </span>
      </div>

      <label className="agent-url-field">
        <input
          type="url"
          placeholder="https://your-site.example"
          value={targetUrl}
          onChange={(event) => onTargetUrlChange(event.target.value)}
        />
      </label>

      <div className="agent-controls">
        <button type="button" onClick={running ? onStop : onStart}>
          {running ? 'Pause' : 'Start'}
        </button>
        <button type="button" onClick={onStep}>
          Step
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="agent-summary">
        <div className="summary-card">
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
        <div className="summary-card">
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

      {plannedStatus ? (
        <div className="agent-planned-progress">
          <h4>Path Progress</h4>
          <p>path: {pathCurrentIndex}/{plannedStatus.plannedPaths}</p>
          <p>step: {stepCurrentIndex}/{stepTotal}</p>
          <p>current state: {currentStateId ?? 'Awaiting signal'}</p>
          <p>next state: {nextStateId}</p>
        </div>
      ) : null}

      {latestEvent ? (
        <div className="agent-planned-progress">
          <h4>Validation Results</h4>
          <p>
            {latestEvent.pathName}: {latestEvent.step.label} → {latestEvent.result.toUpperCase()}
          </p>
          {latestEvent.blockedReason ? <p>Blocked: {latestEvent.blockedReason}</p> : null}
          {(latestEvent.validationResults?.length ?? 0) === 0 ? (
            <p className="muted">No validations for this step.</p>
          ) : (
            <div className="agent-logs" style={{ maxHeight: 180, marginTop: 8 }}>
              <ul>
                {(latestEvent.validationResults ?? []).map((validation) => (
                  <li key={validation.id} className={`log ${validation.status === 'pass' ? 'success' : 'error'}`} style={{ borderBottom: 'none', paddingBottom: 0 }}>
                    <span>{validation.status.toUpperCase()}</span>
                    <span>{validation.label}</span>
                    <span>{validation.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      <div className="agent-logs">
        <h4>Live Events</h4>
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
    </div>
  )
}
