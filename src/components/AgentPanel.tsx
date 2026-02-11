import type { AgentLogEntry, CoverageState, Diagram } from '../types'

interface AgentPanelProps {
  diagrams: Diagram[]
  coverage: CoverageState
  logs: AgentLogEntry[]
  currentStateId: string | null
  running: boolean
  intervalMs: number
  onStart: () => void
  onStop: () => void
  onStep: () => void
  onReset: () => void
  onIntervalChange: (value: number) => void
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString()

export const AgentPanel = ({
  diagrams,
  coverage,
  logs,
  currentStateId,
  running,
  intervalMs,
  onStart,
  onStop,
  onStep,
  onReset,
  onIntervalChange,
}: AgentPanelProps) => {
  const allStates = diagrams.flatMap((diagram) => diagram.states)
  const totalStates = allStates.length
  const visitedStates = coverage.visitedNodes.size
  const totalTransitions = diagrams.reduce((acc, diagram) => acc + diagram.transitions.length, 0)
  const passCount = Object.values(coverage.transitionResults).filter((value) => value === 'pass').length
  const failCount = Object.values(coverage.transitionResults).filter((value) => value === 'fail').length

  return (
    <div className="panel agent-panel">
      <div className="agent-header">
        <h3>Agent Control</h3>
        <span className={`status-pill ${running ? 'running' : ''}`}>
          {running ? 'Running' : 'Idle'}
        </span>
      </div>

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

      <label className="slider">
        <span>Speed</span>
        <input
          type="range"
          min={600}
          max={2200}
          step={100}
          value={intervalMs}
          onChange={(event) => onIntervalChange(Number(event.target.value))}
        />
        <span>{intervalMs}ms</span>
      </label>

      <div className="agent-summary">
        <div>
          <strong>{visitedStates}</strong>
          <span>Visited states / {totalStates}</span>
        </div>
        <div>
          <strong>{passCount}</strong>
          <span>Transitions passed</span>
        </div>
        <div>
          <strong>{failCount}</strong>
          <span>Transitions failed</span>
        </div>
        <div>
          <strong>{totalTransitions}</strong>
          <span>Total transitions</span>
        </div>
      </div>

      <div className="agent-current">
        <h4>Current State</h4>
        <p>{currentStateId ?? 'Awaiting signal'}</p>
      </div>

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
