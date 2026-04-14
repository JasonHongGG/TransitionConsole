import { useEffect, useMemo, useRef, useState } from 'react'
import type { Diagram, DiagramConnector } from '../../../types'
import { computeSystemLayout } from '../../../shared/utils/systemLayout'
import { SystemGraphSvg } from './SystemGraphSvg'
import { downloadSystemPng, downloadSystemSvg } from '../utils/systemExport'
import {
  PAPER_FULL_SYSTEM_PRESET,
  formatSnapshotTimestamp,
  getSystemGraphViewBox,
  toExportBaseFileName,
  type SystemRenderSnapshot,
} from '../utils/systemGraph'

type ExportFormat = 'png' | 'svg'
type ExportScale = 2 | 3

const PARTIAL_EXPORT_TITLE = '部分系統論文圖'
const PARTIAL_EXPORT_FILE_SUFFIX = 'paper-partial-system'

const DIAGRAM_LEVEL_LABEL: Record<Diagram['level'], string> = {
  page: 'Page',
  feature: 'Feature',
}

const DIAGRAM_LEVEL_SECTION_TITLE: Record<Diagram['level'], string> = {
  page: 'Page diagrams',
  feature: 'Feature diagrams',
}

const compareDiagrams = (left: Diagram, right: Diagram) => {
  const rank = left.level === right.level ? 0 : left.level === 'page' ? -1 : 1
  if (rank !== 0) return rank
  return left.name.localeCompare(right.name, 'en')
}

const summarizeHiddenDiagramNames = (diagrams: Diagram[]) => {
  if (diagrams.length === 0) return ''
  if (diagrams.length <= 3) {
    return diagrams.map((diagram) => diagram.name).join(', ')
  }

  const preview = diagrams
    .slice(0, 3)
    .map((diagram) => diagram.name)
    .join(', ')
  return `${preview} 等 ${diagrams.length} 個`
}

interface SystemViewExportModalProps {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  snapshot: SystemRenderSnapshot
  systemName: string
  onClose: () => void
}

export const SystemViewExportModal = ({
  diagrams,
  connectors,
  snapshot,
  systemName,
  onClose,
}: SystemViewExportModalProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState<ExportScale>(3)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [includedDiagramIds, setIncludedDiagramIds] = useState<string[]>(() => diagrams.map((diagram) => diagram.id))

  useEffect(() => {
    setIncludedDiagramIds(diagrams.map((diagram) => diagram.id))
  }, [diagrams])

  const sortedDiagrams = useMemo(() => diagrams.slice().sort(compareDiagrams), [diagrams])
  const pageDiagrams = useMemo(
    () => sortedDiagrams.filter((diagram) => diagram.level === 'page'),
    [sortedDiagrams],
  )
  const featureDiagrams = useMemo(
    () => sortedDiagrams.filter((diagram) => diagram.level === 'feature'),
    [sortedDiagrams],
  )
  const includedDiagramIdSet = useMemo(() => new Set(includedDiagramIds), [includedDiagramIds])
  const hiddenDiagramIds = useMemo(
    () => diagrams.filter((diagram) => !includedDiagramIdSet.has(diagram.id)).map((diagram) => diagram.id),
    [diagrams, includedDiagramIdSet],
  )
  const hiddenDiagrams = useMemo(
    () => sortedDiagrams.filter((diagram) => !includedDiagramIdSet.has(diagram.id)),
    [includedDiagramIdSet, sortedDiagrams],
  )
  const visibleDiagrams = useMemo(
    () => sortedDiagrams.filter((diagram) => includedDiagramIdSet.has(diagram.id)),
    [includedDiagramIdSet, sortedDiagrams],
  )
  const hasHiddenDiagrams = hiddenDiagramIds.length > 0
  const isEmptySelection = visibleDiagrams.length === 0

  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.type === 'invokes'),
    [connectors],
  )
  const systemLayout = useMemo(
    () =>
      computeSystemLayout(diagrams, visibleConnectors, {
        mode: PAPER_FULL_SYSTEM_PRESET.mode,
        hiddenDiagramIds,
      }),
    [diagrams, hiddenDiagramIds, visibleConnectors],
  )
  const viewBox = useMemo(
    () => getSystemGraphViewBox(systemLayout, PAPER_FULL_SYSTEM_PRESET.viewBoxPadding),
    [systemLayout],
  )
  const previewTitle = `${systemName} ${hasHiddenDiagrams ? PARTIAL_EXPORT_TITLE : PAPER_FULL_SYSTEM_PRESET.title}`
  const snapshotLabel = useMemo(() => formatSnapshotTimestamp(snapshot.capturedAt), [snapshot.capturedAt])
  const exportBaseName = useMemo(() => {
    const stamp = snapshot.capturedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    const fileSuffix = hasHiddenDiagrams ? PARTIAL_EXPORT_FILE_SUFFIX : PAPER_FULL_SYSTEM_PRESET.fileSuffix
    return `${toExportBaseFileName(systemName)}-${fileSuffix}-${stamp}`
  }, [hasHiddenDiagrams, snapshot.capturedAt, systemName])
  const hiddenDiagramSummary = useMemo(() => summarizeHiddenDiagramNames(hiddenDiagrams), [hiddenDiagrams])

  useEffect(() => {
    setDownloadError(null)
  }, [hiddenDiagramIds])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const toggleDiagram = (diagramId: string) => {
    setIncludedDiagramIds((current) => {
      if (current.includes(diagramId)) {
        return current.filter((id) => id !== diagramId)
      }
      return [...current, diagramId]
    })
  }

  const selectAllDiagrams = () => {
    setIncludedDiagramIds(diagrams.map((diagram) => diagram.id))
  }

  const clearAllDiagrams = () => {
    setIncludedDiagramIds([])
  }

  const handleDownload = async () => {
    if (!svgRef.current || isDownloading || isEmptySelection) {
      return
    }

    setIsDownloading(true)
    setDownloadError(null)

    try {
      if (format === 'svg') {
        await downloadSystemSvg(svgRef.current, {
          fileBaseName: exportBaseName,
          title: previewTitle,
        })
      } else {
        await downloadSystemPng(svgRef.current, {
          fileBaseName: exportBaseName,
          title: previewTitle,
          scale,
        })
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '下載失敗，請再試一次。')
    } finally {
      setIsDownloading(false)
    }
  }

  const renderDiagramSection = (level: Diagram['level'], items: Diagram[]) => {
    if (items.length === 0) return null

    return (
      <section className="system-export-filter-section" aria-label={DIAGRAM_LEVEL_SECTION_TITLE[level]}>
        <div className="system-export-filter-section-header">
          <h4>{DIAGRAM_LEVEL_SECTION_TITLE[level]}</h4>
          <span>{items.length}</span>
        </div>
        <div className="system-export-filter-list">
          {items.map((diagram) => {
            const checked = includedDiagramIdSet.has(diagram.id)
            const descriptor = diagram.meta.pageName ?? diagram.meta.featureName ?? diagram.id
            return (
              <label key={diagram.id} className={`system-export-diagram-option${checked ? ' is-selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleDiagram(diagram.id)} />
                <span className="system-export-diagram-option-body">
                  <span className="system-export-diagram-option-name">{diagram.name}</span>
                  <span className="system-export-diagram-option-meta">
                    {DIAGRAM_LEVEL_LABEL[diagram.level]} · {descriptor}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="modal-backdrop system-export-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal system-export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="System view export preview"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header system-export-modal-header">
          <div className="system-export-title-block">
            <h3>{hasHiddenDiagrams ? PARTIAL_EXPORT_TITLE : PAPER_FULL_SYSTEM_PRESET.title}</h3>
            <span className="system-export-title-meta">{snapshotLabel}</span>
          </div>
          <div className="system-export-header-actions">
            <button
              type="button"
              className="header-file system-export-download-btn system-export-header-download"
              onClick={handleDownload}
              disabled={isDownloading || isEmptySelection}
            >
              {isDownloading ? '下載中…' : `下載 ${format.toUpperCase()}`}
            </button>

            <div className="system-export-inline-group">
              <span className="system-export-field-label">格式</span>
              <div className="system-export-toggle" role="tablist" aria-label="Export format">
                <button
                  type="button"
                  className={format === 'png' ? 'active' : ''}
                  onClick={() => setFormat('png')}
                >
                  PNG
                </button>
                <button
                  type="button"
                  className={format === 'svg' ? 'active' : ''}
                  onClick={() => setFormat('svg')}
                >
                  SVG
                </button>
              </div>
            </div>

            <div className="system-export-inline-group">
              <span className="system-export-field-label">解析度</span>
              <div className="system-export-toggle" role="tablist" aria-label="PNG scale">
                <button
                  type="button"
                  className={scale === 2 ? 'active' : ''}
                  onClick={() => setScale(2)}
                  disabled={format !== 'png'}
                >
                  2x
                </button>
                <button
                  type="button"
                  className={scale === 3 ? 'active' : ''}
                  onClick={() => setScale(3)}
                  disabled={format !== 'png'}
                >
                  3x
                </button>
              </div>
            </div>

            <button type="button" className="icon-button" onClick={onClose} aria-label="Close export preview">
              <span aria-hidden="true">x</span>
            </button>
          </div>
        </div>

        <div className="modal-body system-export-modal-body">
          <div className="system-export-layout">
            <aside className="system-export-filter-panel" aria-label="Partial export filter">
              <div className="system-export-filter-card">
                <div className="system-export-filter-card-header">
                  <div>
                    <span className="system-export-field-label">Partial export</span>
                    <h4>選擇要保留的子 diagram</h4>
                  </div>
                  <span className="system-export-selection-count">
                    已選 {visibleDiagrams.length} / {diagrams.length}
                  </span>
                </div>
                <p className="system-export-filter-help">
                  取消勾選後，該子 diagram 與所有落到它的跨圖連線都會從匯出圖移除。
                </p>
                <div className="system-export-filter-actions">
                  <button type="button" className="header-button" onClick={selectAllDiagrams}>
                    全選
                  </button>
                  <button type="button" className="header-button" onClick={clearAllDiagrams}>
                    全部取消
                  </button>
                </div>
                <div className="system-export-filter-sections">
                  {renderDiagramSection('page', pageDiagrams)}
                  {renderDiagramSection('feature', featureDiagrams)}
                </div>
              </div>
            </aside>

            <div className="system-export-preview-shell">
              <div className="system-export-preview-meta">
                {hasHiddenDiagrams ? (
                  <p className="system-export-preview-note">
                    已排除 {hiddenDiagrams.length} 個子 diagram：{hiddenDiagramSummary}
                  </p>
                ) : (
                  <p className="system-export-preview-note">目前將匯出完整系統圖。</p>
                )}
              </div>

              <div className="system-export-preview-frame" style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}` }}>
                {isEmptySelection ? (
                  <div className="system-export-empty-state">
                    <strong>目前沒有可匯出的子 diagram</strong>
                    <span>請至少保留一個子 diagram，才能產生 partial system export。</span>
                  </div>
                ) : (
                  <SystemGraphSvg
                    svgRef={svgRef}
                    diagrams={visibleDiagrams}
                    connectors={visibleConnectors}
                    systemLayout={systemLayout}
                    coverage={snapshot.coverage}
                    currentStateId={snapshot.currentStateId}
                    isTesting={snapshot.isTesting}
                    activeEdgeId={snapshot.activeEdgeId}
                    nextStateId={snapshot.nextStateId}
                    renderMode={PAPER_FULL_SYSTEM_PRESET.mode}
                    className="system-export-preview-svg"
                    graphClassName="system-export-graph"
                    viewBox={viewBox.value}
                    viewBoxBounds={viewBox}
                    preserveAspectRatio="xMidYMid meet"
                    ariaLabel={`${systemName} export preview`}
                  />
                )}
              </div>
            </div>
          </div>

          {downloadError ? <p className="system-export-error">{downloadError}</p> : null}
        </div>
      </div>
    </div>
  )
}
