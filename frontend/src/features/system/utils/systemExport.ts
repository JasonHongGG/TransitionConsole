const SVG_NS = 'http://www.w3.org/2000/svg'

interface SerializeSystemSvgOptions {
  title?: string
}

interface DownloadSystemSvgOptions extends SerializeSystemSvgOptions {
  fileBaseName: string
}

interface DownloadSystemPngOptions extends SerializeSystemSvgOptions {
  fileBaseName: string
  scale: number
}

function buildExportCss(): string {
  return `
    .system-export-svg-root {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      text-rendering: geometricPrecision;
      shape-rendering: geometricPrecision;
    }

    .system-export-svg-root .system-export-bg {
      fill: #ffffff;
    }

    .system-export-svg-root .diagram-group-bg {
      fill: rgba(15, 23, 42, 0.03);
      stroke: rgba(15, 23, 42, 0.14);
      stroke-width: 1.8;
    }

    .system-export-svg-root .diagram-group-label {
      fill: #334155;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }

    .system-export-svg-root .node rect {
      fill: #ffffff;
      stroke: rgba(15, 23, 42, 0.26);
      stroke-width: 2;
    }

    .system-export-svg-root .node text {
      fill: #0f172a;
      font-size: 30px;
      font-weight: 700;
    }

    .system-export-svg-root .node.start rect {
      stroke: #0369a1;
    }

    .system-export-svg-root .node.end rect {
      stroke: #b91c1c;
    }

    .system-export-svg-root .node.current rect,
    .system-export-svg-root .node.selected rect,
    .system-export-svg-root .node.node-status-running rect {
      fill: rgba(245, 158, 11, 0.16);
      stroke: #b7791f;
      stroke-width: 2.6;
    }

    .system-export-svg-root .node.node-status-pass rect {
      fill: rgba(116, 203, 177, 0.18);
      stroke: #74cbb1;
      stroke-width: 2.4;
    }

    .system-export-svg-root .node.node-status-fail rect {
      fill: rgba(220, 38, 38, 0.11);
      stroke: #dc2626;
      stroke-width: 2.4;
    }

    .system-export-svg-root .node.node-status-untested rect {
      fill: rgba(255, 255, 255, 0.98);
      stroke: rgba(71, 85, 105, 0.45);
      stroke-width: 1.9;
    }

    .system-export-svg-root .edge-path,
    .system-export-svg-root .cross-edge-path,
    .system-export-svg-root .variant-edge-path {
      fill: none;
      stroke: #6b7280;
      stroke-width: 2.2;
      opacity: 1;
    }

    .system-export-svg-root .edge-path {
      stroke-width: 1.8;
      opacity: 0.92;
    }

    .system-export-svg-root .variant-edge-path {
      stroke-width: 2.25;
      stroke-dasharray: 8 6;
    }

    .system-export-svg-root .edge-label,
    .system-export-svg-root .cross-edge-label,
    .system-export-svg-root .variant-edge-label {
      display: none;
    }

    .system-export-svg-root .edge-status-running .edge-path,
    .system-export-svg-root .edge-status-running .cross-edge-path,
    .system-export-svg-root .edge-status-running .variant-edge-path {
      stroke: #b7791f;
    }

    .system-export-svg-root .edge-status-pass .edge-path,
    .system-export-svg-root .edge-status-pass .cross-edge-path,
    .system-export-svg-root .edge-status-pass .variant-edge-path {
      stroke: #74cbb1;
    }

    .system-export-svg-root .edge-status-fail .edge-path,
    .system-export-svg-root .edge-status-fail .cross-edge-path,
    .system-export-svg-root .edge-status-fail .variant-edge-path {
      stroke: #dc2626;
    }

    .system-export-svg-root .edge-status-untested .edge-path,
    .system-export-svg-root .edge-status-untested .cross-edge-path,
    .system-export-svg-root .edge-status-untested .variant-edge-path {
      stroke: #6b7280;
    }

    .system-export-svg-root .edge-status-untested .cross-edge-label,
    .system-export-svg-root .edge-status-untested .variant-edge-label {
      fill: #6b7280;
    }
  `
}

function ensureSvgMetadata(svg: SVGSVGElement, options: SerializeSystemSvgOptions): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const viewBox = clone.viewBox.baseVal
  const exportWidth = viewBox?.width || clone.clientWidth || Number(clone.getAttribute('width')) || 1600
  const exportHeight = viewBox?.height || clone.clientHeight || Number(clone.getAttribute('height')) || 900
  clone.setAttribute('width', String(exportWidth))
  clone.setAttribute('height', String(exportHeight))
  clone.setAttribute('preserveAspectRatio', clone.getAttribute('preserveAspectRatio') || 'xMidYMid meet')

  if (!clone.classList.contains('system-export-svg-root')) {
    clone.classList.add('system-export-svg-root')
  }

  clone.querySelectorAll('[data-export-style]').forEach((node) => node.remove())
  const style = document.createElementNS(SVG_NS, 'style')
  style.setAttribute('data-export-style', 'true')
  style.textContent = buildExportCss()
  clone.insertBefore(style, clone.firstChild)

  clone.querySelectorAll('title').forEach((node) => node.remove())
  if (options.title) {
    const title = document.createElementNS(SVG_NS, 'title')
    title.textContent = options.title
    clone.insertBefore(title, clone.firstChild)
  }

  return clone
}

export function serializeSystemSvg(svg: SVGSVGElement, options: SerializeSystemSvgOptions = {}): string {
  const clone = ensureSvgMetadata(svg, options)
  return new XMLSerializer().serializeToString(clone)
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to render export preview image.'))
    image.src = url
  })
}

export async function downloadSystemSvg(svg: SVGSVGElement, options: DownloadSystemSvgOptions) {
  const xml = serializeSystemSvg(svg, options)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  downloadBlob(blob, `${options.fileBaseName}.svg`)
}

export async function downloadSystemPng(svg: SVGSVGElement, options: DownloadSystemPngOptions) {
  const xml = serializeSystemSvg(svg, options)
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = await loadImage(url)
    const viewBox = svg.viewBox.baseVal
    const width = Math.max(1, Math.round(viewBox?.width || image.width || svg.clientWidth || 1600))
    const height = Math.max(1, Math.round(viewBox?.height || image.height || svg.clientHeight || 900))
    const scale = Math.max(1, Math.min(options.scale, 4))

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is unavailable.')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(scale, scale)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('Failed to encode PNG export.'))
      }, 'image/png')
    })

    downloadBlob(pngBlob, `${options.fileBaseName}.png`)
  } finally {
    URL.revokeObjectURL(url)
  }
}
