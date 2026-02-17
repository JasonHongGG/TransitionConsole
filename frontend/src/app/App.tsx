import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import '../App.css'
import type { DiagramConnector, GraphData } from '../types'
import { DiagramList, DiagramView } from '../features/diagram'
import { SystemView } from '../features/system'
import { AgentPanel, usePlannedRunner } from '../features/agent'
import { TemporaryRunnerSettingsButtons } from '../features/agent/components/TemporaryRunnerSettingsButtons'

type ViewMode = 'diagram' | 'system'
type FocusMode = 'off' | 'current' | 'path'

const FOCUS_MODE_ORDER: FocusMode[] = ['off', 'current', 'path']

function App() {
  const [data, setData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('diagram')
  const [selectedDiagramId, setSelectedDiagramId] = useState<string>('')
  const [dataSource, setDataSource] = useState<string>('public/data.json')
  const [showGoals, setShowGoals] = useState(false)
  const [focusDiagramId, setFocusDiagramId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)
  const [focusMode, setFocusMode] = useState<FocusMode>('path')

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/data.json')
        if (!response.ok) {
          throw new Error(`Failed to load data.json (${response.status})`)
        }
        const payload = (await response.json()) as GraphData
        setData(payload)
        setDataSource('public/data.json')
        if (payload.diagrams.length > 0) {
          setSelectedDiagramId(payload.diagrams[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    }

    loadData()
  }, [])

  const connectors = useMemo(() => {
    if (!data) {
      return []
    }
    const map = new Map<string, DiagramConnector>()
    data.diagrams.forEach((diagram) => {
      diagram.connectors.forEach((connector) => {
        map.set(connector.id, connector)
      })
    })
    return Array.from(map.values())
  }, [data])

  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.type !== 'contains'),
    [connectors],
  )

  const agentRunner = usePlannedRunner(data?.diagrams ?? [], visibleConnectors, data?.spec.raw ?? null)
  const isTestingPhase = agentRunner.running || agentRunner.plannedStatus !== null

  const cycleFocusMode = () => {
    setFocusMode((prev) => {
      const index = FOCUS_MODE_ORDER.indexOf(prev)
      const nextIndex = index === -1 ? 0 : (index + 1) % FOCUS_MODE_ORDER.length
      return FOCUS_MODE_ORDER[nextIndex]
    })
  }

  const selectedDiagram = useMemo(
    () => data?.diagrams.find((diagram) => diagram.id === selectedDiagramId) ?? null,
    [data, selectedDiagramId],
  )

  const diagramById = useMemo(() => {
    if (!data) {
      return new Map<string, GraphData['diagrams'][number]>()
    }
    return new Map(data.diagrams.map((diagram) => [diagram.id, diagram]))
  }, [data])

  const selectedVariantNotes = useMemo(() => {
    if (!selectedDiagram) {
      return [] as string[]
    }
    if (selectedDiagram.variant.kind === 'base') {
      const entries = Object.entries(selectedDiagram.variant.deltaDiagramIdsByRole)
      return entries.map(([role, deltaId]) => {
        const deltaName = diagramById.get(deltaId)?.name ?? deltaId
        return `${role} → ${deltaName}`
      })
    }
    if (selectedDiagram.variant.kind === 'delta' && selectedDiagram.variant.baseDiagramId) {
      const baseName =
        diagramById.get(selectedDiagram.variant.baseDiagramId)?.name ?? selectedDiagram.variant.baseDiagramId
      const roles = selectedDiagram.variant.appliesToRoles.join(', ')
      return [`extends ${baseName}`, roles ? `roles: ${roles}` : 'roles: none']
    }
    return [] as string[]
  }, [diagramById, selectedDiagram])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as GraphData
      setData(payload)
      setSelectedDiagramId(payload.diagrams[0]?.id ?? '')
      setDataSource(file.name)
      setError(null)
      setFocusDiagramId(null)
      setViewMode('diagram')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON file')
    }
  }

  const handleExport = () => {
    if (!data) {
      return
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${data.system ?? 'transition-diagram'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="app-shell error-shell">
        <h2>Data Load Failed</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="app-shell loading-shell">
        {dataSource === '' ? (
          <>
            <p>尚未載入任何資料</p>
            <label className="header-file" style={{ marginTop: 16, cursor: 'pointer' }}>
              <span className="button-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="icon">
                  <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </span>
              匯入 JSON
              <input type="file" accept="application/json" onChange={handleFileChange} />
            </label>
          </>
        ) : (
          <>
            <div className="pulse" />
            <p>Loading diagram data…</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="header-title-group">
            <h1 className="header-title">Transition Console</h1>
          </div>
        </div>
        <div className="header-actions">
          <label className="header-file">
            <input type="file" accept="application/json" onChange={handleFileChange} />
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="icon">
                <path
                  d="M7 4h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M14 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 17V9" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9.5 11.5 12 9l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            匯入
          </label>
          <button type="button" className="header-button" onClick={handleExport}>
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="icon">
                <path
                  d="M7 4h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M14 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 9v8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9.5 14.5 12 17l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            匯出
          </button>
          <TemporaryRunnerSettingsButtons
            getSettings={agentRunner.getTemporarySettings}
            applySettings={agentRunner.applyTemporarySettings}
          />
          <button
            type="button"
            className="header-button"
            onClick={() => {
              setData(null)
              setSelectedDiagramId('')
              setDataSource('')
              setError(null)
              setFocusDiagramId(null)
              setViewMode('diagram')
            }}
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="icon">
                <path d="M3 6h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </span>
            清空
          </button>
          <span className="header-source">來源: {dataSource}</span>
        </div>
      </header>
      <main className="main">
        <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${agentPanelCollapsed ? 'agent-collapsed' : ''}`}>
          <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="sidebar-handle"
              aria-label={sidebarCollapsed ? 'Expand left panel' : 'Collapse left panel'}
              title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
              onClick={() => {
                setSidebarCollapsed((prev) => !prev)
                setShowGoals(false)
              }}
            >
              <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                {sidebarCollapsed ? (
                  <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>

            <div className="sidebar-content">
            <div className="overlay-card">
              <div className="overlay-header">
                <span className="section-title">
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                    <rect x="3" y="4" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="14" y="4" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="3" y="14" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="14" y="14" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  Diagrams
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowGoals(true)}
                  aria-label="Open coverage goals"
                  title="Coverage goals"
                >
                  <svg
                    className="icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
                  </svg>
                </button>
              </div>
              <div className="view-toggle">
                <button
                  type="button"
                  className={viewMode === 'diagram' ? 'active' : ''}
                  onClick={() => setViewMode('diagram')}
                >
                  Diagram View
                </button>
                <button
                  type="button"
                  className={viewMode === 'system' ? 'active' : ''}
                  onClick={() => { setViewMode('system'); setFocusDiagramId(null) }}
                >
                  System View
                </button>
              </div>
              <div className="diagrams-panel">
                <DiagramList
                  diagrams={data.diagrams}
                  selectedId={viewMode === 'system' ? (focusDiagramId ?? '') : selectedDiagramId}
                  onSelect={(id) => {
                    if (viewMode === 'system') {
                      setFocusDiagramId((prev) => (prev === id ? null : id))
                    } else {
                      setSelectedDiagramId(id)
                    }
                  }}
                />
              </div>
            </div>

            </div>
          </aside>

          <section className="content">
            <div className="diagram-stage">
              <div className="panel canvas-panel">
                <div className="panel-header compact">
                  <div className="panel-heading">
                    <div className="panel-context">
                      <h2 className="panel-system">
                        <svg viewBox="0 0 24 24" className="panel-title-icon" aria-hidden="true">
                          <path
                            d="M12 3.5 4.5 7v5.2c0 4.3 3 7.9 7.5 8.8 4.5-.9 7.5-4.5 7.5-8.8V7L12 3.5z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <path
                            d="M9.5 12.5 11 14l3.5-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {data.spec.summary.productName}
                      </h2>
                      <span className="panel-mode">
                        {viewMode === 'system' ? 'System View' : 'Diagram View'}
                      </span>
                    </div>
                    {viewMode === 'diagram' && selectedDiagram ? (
                      <div className="panel-title-block">
                        <div className="panel-title-row">
                          <h3 className="panel-title">{selectedDiagram.name}</h3>
                          <span
                            className="panel-info"
                            data-tooltip={`${selectedDiagram.id}`}
                            aria-label={`${selectedDiagram.id}`}
                          >
                            <span aria-hidden="true">!</span>
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {viewMode === 'diagram' && selectedDiagram ? (
                    <div className="panel-header-tags">
                      <div className="badge-stack">
                        <span className="badge">{selectedDiagram.level}</span>
                        <span className="badge">{selectedDiagram.variant.kind}</span>
                      </div>
                      {selectedVariantNotes.length > 0 ? (
                        <div className="variant-notes">
                          {selectedVariantNotes.map((note) => (
                            <span key={note} className="variant-note">
                              {note}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {viewMode === 'diagram' && selectedDiagram ? (
                  <DiagramView
                    diagram={selectedDiagram}
                    coverage={agentRunner.coverage}
                    currentStateId={agentRunner.currentStateId}
                    isTesting={isTestingPhase}
                    activeEdgeId={agentRunner.activeEdgeId}
                    nextStateId={agentRunner.nextStateId}
                    focusMode={focusMode}
                  />
                ) : (
                  <SystemView
                    diagrams={data.diagrams}
                    connectors={visibleConnectors}
                    coverage={agentRunner.coverage}
                    currentStateId={agentRunner.currentStateId}
                    selectedDiagramId={focusDiagramId ?? undefined}
                    isTesting={isTestingPhase}
                    activeEdgeId={agentRunner.activeEdgeId}
                    nextStateId={agentRunner.nextStateId}
                    focusMode={focusMode}
                  />
                )}
              </div>
            </div>
          </section>

          <aside className={`agent-dock ${agentPanelCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="agent-dock-handle"
              aria-label={agentPanelCollapsed ? 'Expand agent panel' : 'Collapse agent panel'}
              title={agentPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
              onClick={() => setAgentPanelCollapsed((prev) => !prev)}
            >
              <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                {agentPanelCollapsed ? (
                  <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>

            <div className="agent-dock-content">
              <AgentPanel
                diagrams={data.diagrams}
                coverage={agentRunner.coverage}
                logs={agentRunner.logs}
                currentStateId={agentRunner.currentStateId}
                latestEvent={agentRunner.latestEvent}
                running={agentRunner.running}
                isBusy={agentRunner.isBusy}
                nextStateId={agentRunner.nextStateId}
                statusMessage={agentRunner.statusMessage}
                statusTone={agentRunner.statusTone}
                waitingElapsedSeconds={agentRunner.waitingElapsedSeconds}
                plannerRound={agentRunner.plannerRound}
                completed={agentRunner.completed}
                fullCoveragePassed={agentRunner.fullCoveragePassed}
                onStart={() => agentRunner.setRunning(true)}
                onStop={() => agentRunner.setRunning(false)}
                onStep={agentRunner.step}
                onReset={agentRunner.reset}
                targetUrl={agentRunner.targetUrl}
                onTargetUrlChange={agentRunner.setTargetUrl}
                testingNotes={agentRunner.testingNotes}
                onTestingNotesChange={agentRunner.setTestingNotes}
                testAccounts={agentRunner.testAccounts}
                onTestAccountFieldChange={agentRunner.setTestAccountField}
                onAddTestAccount={agentRunner.addTestAccount}
                onRemoveTestAccount={agentRunner.removeTestAccount}
                plannedStatus={agentRunner.plannedStatus}
                focusMode={focusMode}
                onCycleFocusMode={cycleFocusMode}
              />
            </div>
          </aside>
        </div>
      </main>

      {showGoals ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGoals(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Coverage goals"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">Coverage</p>
                <h3 className="section-title">
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
                  </svg>
                  Coverage Goals
                </h3>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowGoals(false)}>
                <span aria-hidden="true">x</span>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Track scenario coverage targets to validate key flows across the system diagrams.
              </p>
              <div className="goal-scroll">
                <ul className="goal-list">
                  {data.spec.summary.goals.map((goal) => (
                    <li key={goal}>{goal}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
