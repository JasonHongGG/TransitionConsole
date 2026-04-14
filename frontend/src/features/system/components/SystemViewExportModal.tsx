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

  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.type === 'invokes'),
    [connectors],
  )
  const systemLayout = useMemo(
    () => computeSystemLayout(diagrams, visibleConnectors, { mode: PAPER_FULL_SYSTEM_PRESET.mode }),
    [diagrams, visibleConnectors],
  )
  const viewBox = useMemo(
    () => getSystemGraphViewBox(systemLayout, PAPER_FULL_SYSTEM_PRESET.viewBoxPadding),
    [systemLayout],
  )
  const previewTitle = `${systemName} ${PAPER_FULL_SYSTEM_PRESET.title}`
  const snapshotLabel = useMemo(() => formatSnapshotTimestamp(snapshot.capturedAt), [snapshot.capturedAt])
  const exportBaseName = useMemo(() => {
    const stamp = snapshot.capturedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    return `${toExportBaseFileName(systemName)}-${PAPER_FULL_SYSTEM_PRESET.fileSuffix}-${stamp}`
  }, [snapshot.capturedAt, systemName])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleDownload = async () => {
    if (!svgRef.current || isDownloading) {
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
            <h3>{PAPER_FULL_SYSTEM_PRESET.title}</h3>
            <span className="system-export-title-meta">{snapshotLabel}</span>
          </div>
          <div className="system-export-header-actions">
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

          <div className="system-export-preview-shell">
            <div className="system-export-preview-frame" style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}` }}>
              <SystemGraphSvg
                svgRef={svgRef}
                diagrams={diagrams}
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
            </div>
          </div>

          {downloadError ? <p className="system-export-error">{downloadError}</p> : null}
        </div>

        <div className="system-export-actions">
          <button type="button" className="header-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="header-file system-export-download-btn"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? '下載中…' : `下載 ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}
