import type {
  ExecutorContext,
  PathNarrativeTransitionInstruction,
  PathTransitionResult,
  PlannedLiveEventInput,
  PlannedTransitionPath,
  PlannedTransitionStep,
  StepNarrativeInstruction,
  StepValidationResult,
  StepValidationSpec,
  StepValidationSummary,
  ValidationObservability,
} from '../type/operatorExecutionContracts'
import type {
  BrowserOperator,
  BrowserOperatorRunResult,
  BrowserPage,
  BrowserSession,
  LoopCoordinateSpace,
  LoopElementState,
  LoopExploratoryIntent,
  LoopFunctionCall,
  LoopFunctionResponse,
  LoopPageState,
  LoopViewportState,
  OperatorLoopAgent,
} from './contracts'
import { OperatorLoopApi } from '../OperatorLoopApi'

type ToolPayload = Record<string, unknown>

type CurrentState = {
  screenshot: Buffer
  url: string
  title: string
  pageState: LoopPageState
}

type ToolExecutionResult = {
  state: CurrentState
  result?: unknown
  summary: string
}

type ViewportPoint = {
  x: number
  y: number
}

type CoordinateResolution = {
  coordinateSpace: LoopCoordinateSpace
  input: {
    x: number
    y: number
  }
  resolved: ViewportPoint
  viewport: LoopViewportState
}

type ToolVerification = {
  ok: boolean
  reason: string
}

type AgentCursorWindow = typeof globalThis & {
  __moveAgentCursor?: (x: number, y: number) => void
  __triggerAgentClickEffect?: () => void
}

const AGENT_CURSOR_INIT_SCRIPT = `
  if (window === window.top) {
    const initCursor = () => {
      if (document.getElementById('playwright-agent-cursor')) return;

      const cursorContainer = document.createElement('div');
      cursorContainer.id = 'playwright-agent-cursor';
      cursorContainer.style.position = 'fixed';
      // Adjust slightly so the SVG's visual tip aligns with the absolute coordinates
      cursorContainer.style.left = '-3px'; 
      cursorContainer.style.top = '-3px';
      cursorContainer.style.width = '32px';
      cursorContainer.style.height = '32px';
      cursorContainer.style.pointerEvents = 'none';
      cursorContainer.style.zIndex = '2147483647';
      cursorContainer.style.transition = 'transform 0.3s ease-out, opacity 0.2s ease-out';
      cursorContainer.style.transform = 'translate(-100px, -100px)';
      cursorContainer.style.opacity = '0';

      const svgPointer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgPointer.setAttribute('viewBox', '0 0 24 24');
      svgPointer.setAttribute('width', '28');
      svgPointer.setAttribute('height', '28');
      svgPointer.style.filter = 'drop-shadow(2px 2px 3px rgba(0,0,0,0.5))';
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L5.85 2.86a.5.5 0 0 0-.85.35Z');
      path.setAttribute('fill', '#ffffff');
      path.setAttribute('stroke', '#000000');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linejoin', 'round');
      
      svgPointer.appendChild(path);
      cursorContainer.appendChild(svgPointer);

      const ripple = document.createElement('div');
      ripple.id = 'playwright-agent-ripple';
      ripple.style.position = 'absolute';
      ripple.style.left = '-2px';
      ripple.style.top = '-2px';
      ripple.style.width = '18px';
      ripple.style.height = '18px';
      ripple.style.borderRadius = '50%';
      ripple.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
      ripple.style.border = '2px solid rgba(255, 0, 0, 0.8)';
      ripple.style.transform = 'scale(0)';
      ripple.style.opacity = '0';
      ripple.style.pointerEvents = 'none';
      
      cursorContainer.appendChild(ripple);

      if (document.documentElement) {
        document.documentElement.appendChild(cursorContainer);
      } else {
        document.addEventListener('DOMContentLoaded', () => document.documentElement.appendChild(cursorContainer));
      }

      let isVisible = false;

      window.__moveAgentCursor = (x, y) => {
        if (!isVisible) {
          cursorContainer.style.opacity = '1';
          isVisible = true;
        }
        cursorContainer.style.transform = \`translate(\${x}px, \${y}px)\`;
      };

      let clickTimeout;
      const triggerRipple = () => {
        if (!isVisible) {
           cursorContainer.style.opacity = '1';
           isVisible = true;
        }
        
        ripple.style.transition = 'none';
        ripple.style.transform = 'scale(0.5)';
        ripple.style.opacity = '1';
        
        void ripple.offsetWidth;
        
        ripple.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
        ripple.style.transform = 'scale(2.5)';
        ripple.style.opacity = '0';
        
        svgPointer.style.transition = 'transform 0.1s ease-in-out';
        svgPointer.style.transform = 'scale(0.85)';
        
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
          svgPointer.style.transition = 'transform 0.2s ease-in-out';
          svgPointer.style.transform = 'scale(1)';
        }, 150);
      };

      window.__triggerAgentClickEffect = triggerRipple;
    };

    if (document.documentElement) {
      initCursor();
    } else {
      window.addEventListener('DOMContentLoaded', initCursor);
    }
  }
`;

type BatchBoundary = 'batch-complete' | 'page-changed' | 'observation-required' | 'stop-requested'

type ObservationState = {
  summary: string
  source: 'initial' | 'tool-batch'
  boundary: BatchBoundary
  toolNames: string[]
}

type RunControlState = {
  stopRequested: boolean
  requestedPathExecutionId?: string
  interruptReason: 'reset' | null
}

const VISUAL_VALIDATION_TYPES: ReadonlySet<string> = new Set([
  'url-equals',
  'url-includes',
  'text-visible',
  'text-not-visible',
  'element-visible',
  'element-not-visible',
])

type ValidationLedgerEntry = StepValidationResult & {
  updatedIteration: number
}

const PLAYWRIGHT_KEY_MAP: Record<string, string> = {
  backspace: 'Backspace',
  tab: 'Tab',
  return: 'Enter',
  enter: 'Enter',
  shift: 'Shift',
  control: 'ControlOrMeta',
  alt: 'Alt',
  escape: 'Escape',
  space: 'Space',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  end: 'End',
  home: 'Home',
  left: 'ArrowLeft',
  up: 'ArrowUp',
  right: 'ArrowRight',
  down: 'ArrowDown',
  insert: 'Insert',
  delete: 'Delete',
  semicolon: ';',
  equals: '=',
  multiply: 'Multiply',
  add: 'Add',
  separator: 'Separator',
  subtract: 'Subtract',
  decimal: 'Decimal',
  divide: 'Divide',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  command: 'Meta',
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  return fallback
}

const parseIntegerEnv = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

const NORMALIZED_COORDINATE_SCALE = 1000
const OPERATOR_LOOP_EXPLORATORY_ACTION_LIMIT = parseIntegerEnv(process.env.OPERATOR_LOOP_EXPLORATORY_ACTION_LIMIT, 4)
const DEFAULT_VIEWPORT_WIDTH = parseIntegerEnv(process.env.OPERATOR_BROWSER_VIEWPORT_WIDTH, 1440)
const DEFAULT_VIEWPORT_HEIGHT = parseIntegerEnv(process.env.OPERATOR_BROWSER_VIEWPORT_HEIGHT, 1200)
const COORDINATE_SPACE: LoopCoordinateSpace = 'viewport-normalized-1000'

const READ_PAGE_STATE_SCRIPT = String.raw`(function (input) {
  const scale = input.scale;
  const coordinateSpace = input.coordinateSpace;
  const win = globalThis;
  const doc = win.document;
  const viewport = {
    width: Math.max(1, Math.round(Number(win.innerWidth ?? 0) || 0)),
    height: Math.max(1, Math.round(Number(win.innerHeight ?? 0) || 0)),
    scrollX: Math.round(Number(win.scrollX ?? 0) || 0),
    scrollY: Math.round(Number(win.scrollY ?? 0) || 0),
    devicePixelRatio: Number(win.devicePixelRatio ?? 1) || 1,
    coordinateSpace,
  };

  function normalizePoint(value, size) {
    if (!Number.isFinite(value) || size <= 1) return 0;
    if (value <= 0) return 0;
    if (value >= size) return scale;
    return Math.max(0, Math.min(scale, Math.round((value / Math.max(1, size - 1)) * scale)));
  }

  function getText(value, maxLength) {
    const limit = typeof maxLength === 'number' ? maxLength : 80;
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.slice(0, limit);
  }

  function getStyle(element) {
    return typeof win.getComputedStyle === 'function' ? win.getComputedStyle(element) : null;
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getStyle(element);
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getLabels(element) {
    const labels = Array.isArray(element?.labels) ? element.labels : [];
    const fromLabels = labels
      .map((label) => getText(label?.textContent))
      .filter(Boolean);

    const ariaLabel = getText(element?.getAttribute?.('aria-label'));
    if (ariaLabel) fromLabels.unshift(ariaLabel);

    if (typeof element?.id === 'string' && element.id && doc?.querySelectorAll) {
      const referencing = Array.from(doc.querySelectorAll('label[for="' + element.id + '"]'))
        .map((label) => getText(label?.textContent))
        .filter(Boolean);
      fromLabels.push(...referencing);
    }

    return Array.from(new Set(fromLabels)).slice(0, 3);
  }

  function getRole(element) {
    const explicitRole = getText(element?.getAttribute?.('role'));
    if (explicitRole) return explicitRole;
    const tagName = String(element?.tagName ?? '').toLowerCase();
    if (tagName === 'button') return 'button';
    if (tagName === 'a') return 'link';
    if (tagName === 'input') {
      const type = String(element?.type ?? '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tagName === 'textarea') return 'textbox';
    return null;
  }

  function isEditable(element) {
    const tagName = String(element?.tagName ?? '').toLowerCase();
    if (tagName === 'textarea' || tagName === 'select') return true;
    if (tagName === 'input') {
      const inputType = String(element?.type ?? 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color'].includes(inputType);
    }
    return Boolean(element?.isContentEditable);
  }

  function isClickable(element) {
    const tagName = String(element?.tagName ?? '').toLowerCase();
    const role = getRole(element);
    return tagName === 'button'
      || (tagName === 'input' && ['button', 'submit', 'reset'].includes(String(element?.type ?? '').toLowerCase()))
      || tagName === 'a'
      || role === 'button'
      || role === 'link'
      || typeof element?.onclick === 'function';
  }

  function snapshotElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function' || !isVisible(element)) return null;
    const rect = element.getBoundingClientRect();
    const valueRaw = typeof element?.value === 'string'
      ? element.value
      : element?.isContentEditable
        ? String(element?.textContent ?? '')
        : '';
    const inputType = String(element?.type ?? '').toLowerCase() || null;
    const valueLength = valueRaw.length;
    const isMasked = inputType === 'password';
    const valueState = isEditable(element)
      ? valueLength === 0
        ? 'empty'
        : isMasked
          ? 'masked'
          : 'filled'
      : 'none';
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);

    return {
      tagName: String(element.tagName ?? '').toLowerCase(),
      role: getRole(element),
      inputType,
      identifier: getText(element?.id) ?? getText(element?.getAttribute?.('data-testid')),
      name: getText(element?.getAttribute?.('name')),
      placeholder: getText(element?.getAttribute?.('placeholder')),
      text: getText(element?.textContent),
      labels: getLabels(element),
      disabled: Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true'),
      focused: doc?.activeElement === element,
      editable: isEditable(element),
      clickable: isClickable(element),
      visible: true,
      checked: typeof element?.checked === 'boolean' ? element.checked : null,
      valueState,
      valueLength,
      valuePreview: valueState === 'filled' ? (getText(valueRaw, 60) ?? undefined) : undefined,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: Math.round(centerX),
        centerY: Math.round(centerY),
        normalizedLeft: normalizePoint(rect.left, viewport.width),
        normalizedTop: normalizePoint(rect.top, viewport.height),
        normalizedCenterX: normalizePoint(centerX, viewport.width),
        normalizedCenterY: normalizePoint(centerY, viewport.height),
      },
    };
  }

  function collect(selector, limit) {
    if (!doc?.querySelectorAll) return [];
    return Array.from(doc.querySelectorAll(selector))
      .map((element) => snapshotElement(element))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.rect.top !== right.rect.top) return left.rect.top - right.rect.top;
        return left.rect.left - right.rect.left;
      })
      .slice(0, limit);
  }

  return {
    viewport,
    activeElement: snapshotElement(doc?.activeElement) ?? null,
    inputs: collect('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]', 8),
    buttons: collect('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]', 8),
    links: collect('a[href], [role="link"]', 8),
    clickables: collect('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], a[href], [role="link"]', 12),
  };
})`

const FOCUS_EDITABLE_AT_POINT_SCRIPT = String.raw`(function (point) {
  const win = globalThis;
  const doc = win.document;
  if (!doc?.querySelectorAll) return;

  const candidates = Array.from(doc.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'));
  let bestElement = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate.getBoundingClientRect !== 'function') continue;
    const rect = candidate.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;

    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const containsPoint = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    let score = containsPoint ? 100000 : 0;
    score -= Math.hypot(centerX - point.x, centerY - point.y);
    score -= Math.abs(rect.width * rect.height) / 1000;

    if (score > bestScore) {
      bestScore = score;
      bestElement = candidate;
    }
  }

  if (!bestElement) return;
  if (typeof bestElement.scrollIntoView === 'function') {
    bestElement.scrollIntoView({ block: 'center', inline: 'center' });
  }
  if (typeof bestElement.focus === 'function') {
    bestElement.focus();
  }
  if (typeof bestElement.select === 'function') {
    bestElement.select();
  }
})`

export class PlaywrightBrowserOperator implements BrowserOperator {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly runControls = new Map<string, RunControlState>()
  private readonly highlightMouseEnabled = process.env.PLANNED_RUNNER_HIGHLIGHT_MOUSE !== 'false'
  private readonly browserHeadless = parseBooleanEnv(process.env.OPERATOR_BROWSER_HEADLESS, true)
  private readonly viewport = {
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT,
  }
  private readonly loopAgent: OperatorLoopAgent
  private readonly onLiveEvent?: (event: PlannedLiveEventInput) => void
  private playwrightModulePromise: Promise<{ chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> } }> | null = null

  constructor(options?: { loopAgent?: OperatorLoopAgent; onLiveEvent?: (event: PlannedLiveEventInput) => void }) {
    this.loopAgent = options?.loopAgent ?? new OperatorLoopApi()
    this.onLiveEvent = options?.onLiveEvent
  }

  private emitLiveEvent(event: PlannedLiveEventInput): void {
    this.onLiveEvent?.(event)
  }

  private async getPlaywrightModule(): Promise<{ chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> } }> {
    if (!this.playwrightModulePromise) {
      const importFn = new Function('m', 'return import(m)') as (moduleName: string) => Promise<unknown>
      this.playwrightModulePromise = importFn('playwright') as Promise<{
        chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> }
      }>
    }
    return this.playwrightModulePromise
  }

  private sessionKey(runId: string, pathExecutionId: string): string {
    return `${runId}:${pathExecutionId}`
  }

  private getOrCreateRunControl(runId: string): RunControlState {
    const existing = this.runControls.get(runId)
    if (existing) {
      return existing
    }

    const created: RunControlState = {
      stopRequested: false,
      interruptReason: null,
    }
    this.runControls.set(runId, created)
    return created
  }

  private clearRunControl(runId: string): void {
    this.runControls.delete(runId)
  }

  private clearStopRequest(runId: string): void {
    const control = this.getOrCreateRunControl(runId)
    control.stopRequested = false
    control.requestedPathExecutionId = undefined
  }

  private matchesRequestedPath(control: RunControlState, pathExecutionId: string): boolean {
    return !control.requestedPathExecutionId || control.requestedPathExecutionId === pathExecutionId
  }

  private isStopRequested(runId: string, pathExecutionId: string): boolean {
    const control = this.runControls.get(runId)
    return Boolean(control?.stopRequested && this.matchesRequestedPath(control, pathExecutionId))
  }

  private getInterruptReason(runId: string): 'reset' | null {
    return this.runControls.get(runId)?.interruptReason ?? null
  }

  private setInterruptReason(runId: string, reason: 'reset'): void {
    const control = this.getOrCreateRunControl(runId)
    control.interruptReason = reason
  }

  private summarizeLocation(state: CurrentState): string {
    const title = state.title.replace(/\s+/g, ' ').trim() || 'untitled page'
    return `${title} @ ${state.url}`
  }

  private didPageBoundaryChange(previous: CurrentState, next: CurrentState, toolName: string): boolean {
    if (toolName === 'navigate' || toolName === 'go_back' || toolName === 'go_forward') {
      return true
    }

    try {
      const prevUrl = new URL(previous.url)
      const nextUrl = new URL(next.url)
      return `${prevUrl.origin}${prevUrl.pathname}${prevUrl.search}` !== `${nextUrl.origin}${nextUrl.pathname}${nextUrl.search}`
    } catch {
      return previous.url !== next.url
    }
  }

  private buildStateFingerprint(state: CurrentState): string {
    const normalize = (value: string | null | undefined, maxLength = 60): string =>
      (value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)

    const elementFingerprint = (element: LoopElementState | null): string => {
      if (!element) return 'none'
      return [
        normalize(element.tagName, 20),
        normalize(element.role, 20),
        normalize(element.identifier, 40),
        normalize(element.name, 40),
        normalize(element.placeholder, 40),
        normalize(element.text, 40),
        element.disabled ? 'disabled' : 'enabled',
        element.focused ? 'focused' : 'blurred',
        element.visible ? 'visible' : 'hidden',
        element.checked === null ? 'unchecked-state-unknown' : element.checked ? 'checked' : 'unchecked',
        element.valueState,
        `${element.rect.normalizedCenterX}:${element.rect.normalizedCenterY}`,
      ].join('|')
    }

    const listFingerprint = (elements: LoopElementState[]): string =>
      elements
        .slice(0, 8)
        .map((element) => elementFingerprint(element))
        .join('||')

    return [
      normalize(state.url, 160),
      normalize(state.title, 80),
      elementFingerprint(state.pageState.activeElement),
      listFingerprint(state.pageState.inputs),
      listFingerprint(state.pageState.buttons),
      listFingerprint(state.pageState.links),
      listFingerprint(state.pageState.clickables),
    ].join('###')
  }

  private didBatchMakeProgress(options: {
    before: CurrentState
    after: CurrentState
    boundary: BatchBoundary
    validationUpdates: Array<{ id: string; status: 'pass' | 'fail'; reason: string; actual?: string }>
  }): boolean {
    if (options.validationUpdates.length > 0) {
      return true
    }

    if (options.boundary === 'page-changed') {
      return true
    }

    return this.buildStateFingerprint(options.before) !== this.buildStateFingerprint(options.after)
  }

  private buildActionSignature(functionCalls: LoopFunctionCall[], exploratoryIntent?: LoopExploratoryIntent): string {
    const toolSignature = functionCalls
      .map((call) => `${call.name}:${JSON.stringify(call.args)}`)
      .join(' -> ')

    if (!exploratoryIntent) {
      return `direct|${toolSignature}`
    }

    return `${exploratoryIntent.kind}|${exploratoryIntent.summary}|${toolSignature}`
  }

  private buildObservationSummary(options: {
    before: CurrentState
    after: CurrentState
    toolNames: string[]
    toolSummaries: string[]
    boundary: BatchBoundary
  }): string {
    const toolSummary = options.toolNames.length > 0 ? options.toolNames.join(', ') : 'no tool executed'
    const factSummary = options.toolSummaries.length > 0 ? ` Facts: ${options.toolSummaries.join(' ')}` : ''
    const boundarySummary =
      options.boundary === 'page-changed'
        ? 'page changed, re-observe before next decision'
        : options.boundary === 'stop-requested'
          ? 'stop requested at tool boundary'
          : options.boundary === 'observation-required'
            ? 'fresh observation required'
            : 'same page batch completed'

    if (options.before.url === options.after.url && options.before.title === options.after.title) {
      return `Batch ran ${toolSummary}. Still on ${this.summarizeLocation(options.after)}; ${boundarySummary}.${factSummary}`
    }

    return `Batch ran ${toolSummary}. Moved from ${this.summarizeLocation(options.before)} to ${this.summarizeLocation(options.after)}; ${boundarySummary}.${factSummary}`
  }

  private buildInterruptedResult(options: {
    step: PlannedTransitionStep
    reason: string
    terminationReason: 'stopped' | 'reset'
    validationResults: StepValidationResult[]
    validationSummary: StepValidationSummary
    trace: PathTransitionResult['trace']
    currentUrl: string
    finalStateId: string | null
  }): BrowserOperatorRunResult {
    return {
      result: 'fail',
      blockedReason: options.reason,
      failureCode: 'run-interrupted',
      terminationReason: options.terminationReason,
      transitionResults: [
        {
          step: options.step,
          result: 'fail',
          blockedReason: options.reason,
          failureCode: 'run-interrupted',
          terminationReason: options.terminationReason,
          validationResults: options.validationResults,
          validationSummary: options.validationSummary,
          trace: options.trace,
          evidence: {
            domSummary: `current_url=${options.currentUrl}`,
          },
        },
      ],
      finalStateId: options.finalStateId,
    }
  }

  private async closeSessionByKey(key: string): Promise<void> {
    const session = this.sessions.get(key)
    if (!session) return

    try {
      await session.context.close()
    } catch {
      // ignore
    }
    try {
      await session.browser.close()
    } catch {
      // ignore
    }

    this.sessions.delete(key)
  }

  private async getOrCreateSession(context: ExecutorContext): Promise<BrowserSession> {
    const key = this.sessionKey(context.runId, context.pathExecutionId)
    const existing = this.sessions.get(key)
    if (existing) return existing

    if (!context.targetUrl || typeof context.targetUrl !== 'string' || context.targetUrl.trim().length === 0) {
      throw new Error('PlaywrightBrowserOperator: targetUrl is required and must be a non-empty string.')
    }

    const playwright = await this.getPlaywrightModule()
    const browser = (await playwright.chromium.launch({
      headless: this.browserHeadless,
    })) as BrowserSession['browser'] & {
      newContext: (options?: Record<string, unknown>) => Promise<BrowserSession['context']>
    }

    const contextInstance = await browser.newContext({
      viewport: this.viewport,
      screen: this.viewport,
      deviceScaleFactor: 1,
    })
    
    await contextInstance.addInitScript(AGENT_CURSOR_INIT_SCRIPT)
    
    const page = await contextInstance.newPage()

    const normalizedUrl = context.targetUrl.startsWith('http://') || context.targetUrl.startsWith('https://')
      ? context.targetUrl
      : `https://${context.targetUrl}`
    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    const session: BrowserSession = {
      browser,
      context: contextInstance,
      page: page as BrowserPage,
      network: [],
    }
    this.sessions.set(key, session)
    return session
  }

  private sanitizeText(value: string | null | undefined, maxLength = 80): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return null
    return normalized.slice(0, maxLength)
  }

  private summarizeElement(element: LoopElementState | null): string {
    if (!element) {
      return 'none'
    }

    const label = this.sanitizeText(
      element.labels[0]
        ?? element.placeholder
        ?? element.name
        ?? element.text
        ?? element.identifier
        ?? element.tagName,
      48,
    ) ?? element.tagName
    const kind = this.sanitizeText(element.inputType ?? element.role ?? element.tagName, 24) ?? element.tagName
    const position = `(${element.rect.normalizedCenterX}, ${element.rect.normalizedCenterY})`

    if (element.valueState === 'masked' || element.valueState === 'filled') {
      return `${label} [${kind}] at ${position}, ${element.valueState}, len=${element.valueLength}`
    }

    if (element.valueState === 'empty') {
      return `${label} [${kind}] at ${position}, empty`
    }

    return `${label} [${kind}] at ${position}`
  }

  private summarizeElementList(elements: LoopElementState[], emptyLabel: string): string {
    if (elements.length === 0) {
      return emptyLabel
    }

    return elements.slice(0, 3).map((element) => this.summarizeElement(element)).join('; ')
  }

  private summarizePageState(pageState: LoopPageState): string {
    return [
      `viewport ${pageState.viewport.width}x${pageState.viewport.height} using ${pageState.viewport.coordinateSpace}`,
      `active ${this.summarizeElement(pageState.activeElement)}`,
      `inputs ${this.summarizeElementList(pageState.inputs, 'none')}`,
      `buttons ${this.summarizeElementList(pageState.buttons, 'none')}`,
    ].join(' | ')
  }

  private normalizeCoordinateInput(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= NORMALIZED_COORDINATE_SCALE) return NORMALIZED_COORDINATE_SCALE
    return Math.round(value)
  }

  private toViewportPoint(viewport: LoopViewportState, x: number, y: number): ViewportPoint {
    const normalizedX = this.normalizeCoordinateInput(x)
    const normalizedY = this.normalizeCoordinateInput(y)

    return {
      x: Math.min(viewport.width - 1, Math.max(0, Math.round((normalizedX / NORMALIZED_COORDINATE_SCALE) * Math.max(1, viewport.width - 1)))),
      y: Math.min(viewport.height - 1, Math.max(0, Math.round((normalizedY / NORMALIZED_COORDINATE_SCALE) * Math.max(1, viewport.height - 1)))),
    }
  }

  private scoreDistance(element: LoopElementState, x: number, y: number): number {
    const dx = element.rect.normalizedCenterX - x
    const dy = element.rect.normalizedCenterY - y
    return Math.sqrt((dx * dx) + (dy * dy))
  }

  private containsViewportPoint(element: LoopElementState, point: ViewportPoint): boolean {
    const left = element.rect.left
    const top = element.rect.top
    const right = element.rect.left + Math.max(element.rect.width, 1)
    const bottom = element.rect.top + Math.max(element.rect.height, 1)
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
  }

  private isSameElementReference(expected: LoopElementState | null, actual: LoopElementState | null): boolean {
    if (!expected || !actual) return false

    if (expected.identifier && actual.identifier && expected.identifier === actual.identifier) {
      return true
    }

    return expected.tagName === actual.tagName
      && expected.inputType === actual.inputType
      && Math.abs(expected.rect.normalizedCenterX - actual.rect.normalizedCenterX) <= 24
      && Math.abs(expected.rect.normalizedCenterY - actual.rect.normalizedCenterY) <= 24
  }

  private hasMatchingElement(elements: LoopElementState[], target: LoopElementState | null): boolean {
    if (!target) return false
    return elements.some((element) => this.isSameElementReference(target, element))
  }

  private selectHitTarget(elements: LoopElementState[], point: ViewportPoint): LoopElementState | null {
    const ranked = elements
      .filter((element) => this.containsViewportPoint(element, point))
      .map((element) => ({
        element,
        distance: Math.hypot(element.rect.centerX - point.x, element.rect.centerY - point.y),
        area: Math.max(1, element.rect.width) * Math.max(1, element.rect.height),
      }))
      .sort((left, right) => {
        if (left.area !== right.area) {
          return left.area - right.area
        }
        return left.distance - right.distance
      })

    return ranked[0]?.element ?? null
  }

  private selectBestEditableTarget(pageState: LoopPageState, point: ViewportPoint): LoopElementState | null {
    return this.selectHitTarget(
      pageState.inputs.filter((element) => element.visible && element.editable && !element.disabled),
      point,
    )
  }

  private selectBestClickableTarget(pageState: LoopPageState, point: ViewportPoint): LoopElementState | null {
    const seen = new Set<string>()
    const candidates = [...pageState.buttons, ...pageState.links, ...pageState.clickables]
      .filter((element) => {
        const key = `${element.identifier ?? 'na'}:${element.rect.normalizedCenterX}:${element.rect.normalizedCenterY}:${element.tagName}`
        if (seen.has(key)) return false
        seen.add(key)
        return element.visible && element.clickable && !element.disabled
      })

    return this.selectHitTarget(candidates, point)
  }

  private async readPageState(page: BrowserPage): Promise<LoopPageState> {
    return this.evaluateBrowserScript<{ scale: number; coordinateSpace: LoopCoordinateSpace }, LoopPageState>(
      page,
      READ_PAGE_STATE_SCRIPT,
      { scale: NORMALIZED_COORDINATE_SCALE, coordinateSpace: COORDINATE_SPACE },
    )
  }

  private async focusEditableTarget(page: BrowserPage, point: ViewportPoint): Promise<void> {
    await this.evaluateBrowserScript<ViewportPoint, void>(page, FOCUS_EDITABLE_AT_POINT_SCRIPT, point)
  }

  private async evaluateBrowserScript<Arg, Result>(page: BrowserPage, script: string, payload: Arg): Promise<Result> {
    return page.evaluate<{ code: string; payload: Arg }, Result>(
      (input) => (0, eval)(input.code)(input.payload) as Result,
      { code: script, payload },
    )
  }

  private resolveCoordinates(viewport: LoopViewportState, payload: ToolPayload): CoordinateResolution {
    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')

    return {
      coordinateSpace: COORDINATE_SPACE,
      input: {
        x: this.normalizeCoordinateInput(x),
        y: this.normalizeCoordinateInput(y),
      },
      resolved: this.toViewportPoint(viewport, x, y),
      viewport,
    }
  }

  private verifyTypedElement(target: LoopElementState, element: LoopElementState | null, text: string): ToolVerification {
    if (!element || !element.editable) {
      return {
        ok: false,
        reason: 'no editable active element after typing',
      }
    }

    if (!this.isSameElementReference(target, element)) {
      return {
        ok: false,
        reason: 'typed text landed on a different editable element',
      }
    }

    if (element.valueLength !== text.length) {
      return {
        ok: false,
        reason: `typed length mismatch: expected ${text.length}, got ${element.valueLength}`,
      }
    }

    if (element.valueState === 'empty') {
      return {
        ok: false,
        reason: 'target element is still empty after typing',
      }
    }

    if (element.valueState === 'filled' && element.valuePreview !== text) {
      return {
        ok: false,
        reason: 'typed value preview does not match expected text',
      }
    }

    return {
      ok: true,
      reason: 'input value verified from active element',
    }
  }

  private readNumber(payload: ToolPayload, key: string): number {
    const value = payload[key]
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`tool payload missing numeric field: ${key}`)
    }
    return value
  }

  private readString(payload: ToolPayload, key: string): string {
    const value = payload[key]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`tool payload missing string field: ${key}`)
    }
    return value
  }

  private readFirstString(payload: ToolPayload, keys: string[]): string | null {
    for (const key of keys) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value
      }
    }
    return null
  }

  private readBoolean(payload: ToolPayload, key: string, fallback: boolean): boolean {
    const value = payload[key]
    return typeof value === 'boolean' ? value : fallback
  }

  private readStringArray(payload: ToolPayload, key: string): string[] {
    const value = payload[key]
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`tool payload missing string[] field: ${key}`)
    }
    return value as string[]
  }

  private normalizeKeys(keys: string[]): string[] {
    return keys.map((key) => PLAYWRIGHT_KEY_MAP[key.toLowerCase()] ?? key)
  }

  private async keyCombination(page: BrowserPage, keys: string[]): Promise<void> {
    const normalizedKeys = this.normalizeKeys(keys)

    for (const key of normalizedKeys.slice(0, -1)) {
      await page.keyboard.down(key)
    }

    await page.keyboard.press(normalizedKeys[normalizedKeys.length - 1])

    for (const key of normalizedKeys.slice(0, -1).reverse()) {
      await page.keyboard.up(key)
    }
  }

  private async highlightMouse(page: BrowserPage, x: number, y: number, isAction = true): Promise<void> {
    if (!this.highlightMouseEnabled) return

    // Move the visual demonstration cursor
    await page.evaluate(({ targetX, targetY }) => {
      const w = globalThis as AgentCursorWindow
      if (typeof w.__moveAgentCursor === 'function') {
        w.__moveAgentCursor(targetX, targetY)
      }
    }, { targetX: x, targetY: y })

    // Move Playwright's CDP pointer to ensure hover states trigger correctly
    await page.mouse.move(x, y)

    // Wait for the smoother CSS transition on the cursor to mostly complete
    await page.waitForTimeout(300)

    if (isAction) {
      // Trigger the custom ripple effect
      await page.evaluate((unused: null) => {
        void unused
        const w = globalThis as AgentCursorWindow
        if (typeof w.__triggerAgentClickEffect === 'function') {
          w.__triggerAgentClickEffect()
        }
      }, null)
      // Allow animation to peak for screenshot capture
      await page.waitForTimeout(200)
    } else {
      await page.waitForTimeout(50)
    }
  }

  private async clickAt(page: BrowserPage, payload: ToolPayload): Promise<ToolExecutionResult> {
    const before = await this.currentState(page)
    const coordinate = this.resolveCoordinates(before.pageState.viewport, payload)
    const chosenTarget = this.selectBestClickableTarget(before.pageState, coordinate.resolved)
    const clickPoint = coordinate.resolved

    await this.highlightMouse(page, clickPoint.x, clickPoint.y)
    await page.mouse.click(clickPoint.x, clickPoint.y)

    const after = await this.currentState(page)
    const pageChanged = this.didPageBoundaryChange(before, after, 'click_at')
    const targetStillVisible = this.hasMatchingElement(after.pageState.clickables, chosenTarget)

    return {
      state: after,
      summary: chosenTarget
        ? `click_at hit ${this.summarizeElement(chosenTarget)}; page ${pageChanged ? 'changed' : 'unchanged'}; target ${targetStillVisible ? 'is still visible' : 'is no longer visible'}.`
        : `click_at used normalized point (${coordinate.input.x}, ${coordinate.input.y}); page ${pageChanged ? 'changed' : 'unchanged'}.`,
      result: {
        tool: 'click_at',
        coordinate,
        chosenTarget,
        pageChanged,
        targetStillVisible,
        activeElementAfter: after.pageState.activeElement,
      },
    }
  }

  private async hoverAt(page: BrowserPage, payload: ToolPayload): Promise<ToolExecutionResult> {
    const before = await this.currentState(page)
    const coordinate = this.resolveCoordinates(before.pageState.viewport, payload)
    const chosenTarget = this.selectBestClickableTarget(before.pageState, coordinate.resolved)
    const hoverPoint = coordinate.resolved

    await this.highlightMouse(page, hoverPoint.x, hoverPoint.y, false)

    const after = await this.currentState(page)
    return {
      state: after,
      summary: chosenTarget
        ? `hover_at moved over ${this.summarizeElement(chosenTarget)}.`
        : `hover_at moved to normalized point (${coordinate.input.x}, ${coordinate.input.y}).`,
      result: {
        tool: 'hover_at',
        coordinate,
        chosenTarget,
        activeElementAfter: after.pageState.activeElement,
      },
    }
  }

  private async typeTextAt(page: BrowserPage, payload: ToolPayload): Promise<ToolExecutionResult> {
    const before = await this.currentState(page)
    const coordinate = this.resolveCoordinates(before.pageState.viewport, payload)
    const text = this.readString(payload, 'text')
    const pressEnter = this.readBoolean(payload, 'pressEnter', false)
    const clearBeforeTyping = this.readBoolean(payload, 'clearBeforeTyping', true)
    const chosenTarget = this.selectBestEditableTarget(before.pageState, coordinate.resolved)

    if (!chosenTarget) {
      throw new Error('type_text_at requires the provided point to hit an editable target')
    }

    await this.highlightMouse(page, coordinate.resolved.x, coordinate.resolved.y)
    await page.mouse.click(coordinate.resolved.x, coordinate.resolved.y)

    let afterClick = await this.currentState(page)
    let forcedFocus = false
    const activeAfterClick = afterClick.pageState.activeElement
    const activeTargetMatches = this.isSameElementReference(chosenTarget, activeAfterClick)

    if (!activeAfterClick?.editable || !activeTargetMatches) {
      forcedFocus = true
      await this.focusEditableTarget(page, coordinate.resolved)
      afterClick = await this.currentState(page)
    }

    if (!afterClick.pageState.activeElement?.editable) {
      throw new Error('type_text_at failed to focus an editable target before typing')
    }

    if (clearBeforeTyping) {
      await this.keyCombination(page, ['control', 'a'])
      await this.keyCombination(page, ['delete'])
    }

    await page.keyboard.type(text)

    if (pressEnter) {
      await this.keyCombination(page, ['enter'])
    }

    const afterType = await this.currentState(page)
    const verification = this.verifyTypedElement(chosenTarget, afterType.pageState.activeElement, text)
    if (!verification.ok) {
      throw new Error(`type_text_at verification failed: ${verification.reason}`)
    }

    return {
      state: afterType,
      summary: `type_text_at filled ${this.summarizeElement(afterType.pageState.activeElement)} from normalized point (${coordinate.input.x}, ${coordinate.input.y}).${forcedFocus ? ' Used geometry fallback focus.' : ''}`,
      result: {
        tool: 'type_text_at',
        coordinate,
        textLength: text.length,
        clearBeforeTyping,
        pressEnter,
        chosenTarget,
        forcedFocus,
        activeElementAfterClick: afterClick.pageState.activeElement,
        activeElementAfterType: afterType.pageState.activeElement,
        verification,
      },
    }
  }

  private async scrollDocument(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const direction = this.readString(payload, 'direction').toLowerCase()

    if (direction === 'down') {
      await this.keyCombination(page, ['pagedown'])
      return
    }
    if (direction === 'up') {
      await this.keyCombination(page, ['pageup'])
      return
    }
    if (direction === 'left') {
      await page.mouse.wheel(-600, 0)
      return
    }
    if (direction === 'right') {
      await page.mouse.wheel(600, 0)
      return
    }

    throw new Error(`unsupported scroll_document direction: ${direction}`)
  }

  private async scrollAt(page: BrowserPage, payload: ToolPayload): Promise<ToolExecutionResult> {
    const before = await this.currentState(page)
    const coordinate = this.resolveCoordinates(before.pageState.viewport, payload)
    const direction = this.readString(payload, 'direction').toLowerCase()
    const magnitudeRaw = payload.magnitude
    const magnitude = typeof magnitudeRaw === 'number' && magnitudeRaw > 0 ? magnitudeRaw : 800

    await this.highlightMouse(page, coordinate.resolved.x, coordinate.resolved.y, false)

    let dx = 0
    let dy = 0
    if (direction === 'up') dy = -magnitude
    else if (direction === 'down') dy = magnitude
    else if (direction === 'left') dx = -magnitude
    else if (direction === 'right') dx = magnitude
    else throw new Error(`unsupported scroll_at direction: ${direction}`)

    await page.mouse.wheel(dx, dy)

    const after = await this.currentState(page)
    return {
      state: after,
      summary: `scroll_at moved ${direction} from normalized point (${coordinate.input.x}, ${coordinate.input.y}) with magnitude ${magnitude}.`,
      result: {
        tool: 'scroll_at',
        coordinate,
        direction,
        magnitude,
      },
    }
  }

  private async goBack(page: BrowserPage): Promise<void> {
    await page.goBack()
  }

  private async goForward(page: BrowserPage): Promise<void> {
    await page.goForward()
  }

  private async navigate(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const rawUrl = this.readString(payload, 'url')
    const normalizedUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`
    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  }

  private async dragAndDrop(page: BrowserPage, payload: ToolPayload): Promise<ToolExecutionResult> {
    const before = await this.currentState(page)
    const start = this.resolveCoordinates(before.pageState.viewport, payload)
    const destination = this.toViewportPoint(before.pageState.viewport, this.readNumber(payload, 'destination_x'), this.readNumber(payload, 'destination_y'))

    await this.highlightMouse(page, start.resolved.x, start.resolved.y, true)
    await page.mouse.down()
    await this.highlightMouse(page, destination.x, destination.y, false)
    await page.mouse.up()

    const after = await this.currentState(page)
    return {
      state: after,
      summary: `drag_and_drop moved from (${start.input.x}, ${start.input.y}) to (${this.normalizeCoordinateInput(this.readNumber(payload, 'destination_x'))}, ${this.normalizeCoordinateInput(this.readNumber(payload, 'destination_y'))}).`,
      result: {
        tool: 'drag_and_drop',
        start,
        destination: {
          x: this.normalizeCoordinateInput(this.readNumber(payload, 'destination_x')),
          y: this.normalizeCoordinateInput(this.readNumber(payload, 'destination_y')),
          resolved: destination,
        },
      },
    }
  }

  private async wait5Seconds(page: BrowserPage): Promise<void> {
    await page.waitForTimeout(5000)
  }

  private async evaluateScript(page: BrowserPage, payload: ToolPayload): Promise<unknown> {
    const script = this.readFirstString(payload, ['script', 'expression', 'code'])
    if (!script) {
      throw new Error('tool payload missing string field: script')
    }
    const modeRaw = payload.mode
    const mode = typeof modeRaw === 'string' ? modeRaw.toLowerCase() : 'expression'

    if (mode === 'function') {
      const executable = new Function(`return (${script});`)() as (arg: unknown) => unknown
      if (typeof executable !== 'function') {
        throw new Error('evaluate tool requires script to resolve to a function when mode=function')
      }

      return page.evaluate(executable, payload.arg)
    }

    return page.evaluate((code) => {
      return (0, eval)(code)
    }, script)
  }

  private async currentState(page: BrowserPage): Promise<CurrentState> {
    const pageState = await this.readPageState(page)
    const screenshotBytes = (await page.screenshot({ type: 'png', fullPage: false })) as Buffer
    const title = await page.title()
    return {
      screenshot: screenshotBytes,
      url: page.url(),
      title,
      pageState,
    }
  }

  private async executeTool(
    page: BrowserPage,
    toolName: string,
    payload: ToolPayload,
  ): Promise<ToolExecutionResult> {
    switch (toolName) {
      case 'open_web_browser':
        return {
          state: await this.currentState(page),
          summary: 'open_web_browser reused the existing browser session.',
          result: {
            tool: 'open_web_browser',
          },
        }
      case 'click_at':
        return this.clickAt(page, payload)
      case 'hover_at':
        return this.hoverAt(page, payload)
      case 'type_text_at':
        return this.typeTextAt(page, payload)
      case 'scroll_document':
        await this.scrollDocument(page, payload)
        return {
          state: await this.currentState(page),
          summary: `scroll_document moved ${this.readString(payload, 'direction').toLowerCase()} using keyboard or wheel scrolling.`,
          result: {
            tool: 'scroll_document',
            direction: this.readString(payload, 'direction').toLowerCase(),
          },
        }
      case 'scroll_at':
        return this.scrollAt(page, payload)
      case 'wait_5_seconds':
        await this.wait5Seconds(page)
        return {
          state: await this.currentState(page),
          summary: 'wait_5_seconds completed.',
          result: {
            tool: 'wait_5_seconds',
            waitedMs: 5000,
          },
        }
      case 'evaluate': {
        const result = await this.evaluateScript(page, payload)
        return {
          state: await this.currentState(page),
          summary: 'evaluate executed a DOM script.',
          result: {
            tool: 'evaluate',
            value: result,
          },
        }
      }
      case 'go_back':
        await this.goBack(page)
        return {
          state: await this.currentState(page),
          summary: 'go_back navigated to the previous history entry.',
          result: {
            tool: 'go_back',
          },
        }
      case 'go_forward':
        await this.goForward(page)
        return {
          state: await this.currentState(page),
          summary: 'go_forward navigated to the next history entry.',
          result: {
            tool: 'go_forward',
          },
        }
      case 'navigate':
        await this.navigate(page, payload)
        return {
          state: await this.currentState(page),
          summary: `navigate opened ${this.readString(payload, 'url')}.`,
          result: {
            tool: 'navigate',
            url: this.readString(payload, 'url'),
          },
        }
      case 'key_combination': {
        const keys = this.readStringArray(payload, 'keys')
        await this.keyCombination(page, keys)
        return {
          state: await this.currentState(page),
          summary: `key_combination sent ${keys.join('+')}.`,
          result: {
            tool: 'key_combination',
            keys,
          },
        }
      }
      case 'drag_and_drop':
        return this.dragAndDrop(page, payload)
      case 'current_state': {
        const state = await this.currentState(page)
        return {
          state,
          summary: `current_state observed ${this.summarizePageState(state.pageState)}.`,
          result: {
            tool: 'current_state',
            pageState: state.pageState,
          },
        }
      }
      default:
        throw new Error(`unsupported tool: ${toolName}`)
    }
  }

  private inferObservability(validation: StepValidationSpec): ValidationObservability {
    if (validation.observability === 'visual' || validation.observability === 'deferred') {
      return validation.observability
    }
    return VISUAL_VALIDATION_TYPES.has(validation.type) ? 'visual' : 'deferred'
  }

  private validationCacheKey(context: ExecutorContext, step: PlannedTransitionStep, validationId: string): string {
    return `${context.pathExecutionId}::${step.id}::${validationId}`
  }

  private buildValidationResults(
    context: ExecutorContext,
    step: PlannedTransitionStep,
    validations: StepValidationSpec[],
    ledger: Map<string, ValidationLedgerEntry>,
    finalIteration: number,
  ): StepValidationResult[] {
    const now = new Date().toISOString()
    return validations.map((validation) => {
      const cacheKey = this.validationCacheKey(context, step, validation.id)
      const existing = ledger.get(cacheKey)
      if (!existing) {
        const observability = this.inferObservability(validation)
        if (observability === 'deferred') {
          return {
            id: validation.id,
            label: validation.description,
            validationType: validation.type,
            observability: 'deferred',
            status: 'pass',
            reason: 'auto-passed: not observable via browser',
            cacheKey,
            resolution: 'unverified',
            checkedAt: now,
            expected: validation.expected,
            actual: 'deferred — requires non-visual verification',
          }
        }
        return {
          id: validation.id,
          label: validation.description,
          validationType: validation.type,
          observability: 'visual',
          status: 'pending',
          reason: 'not-yet-verified',
          cacheKey,
          resolution: 'unverified',
          checkedAt: now,
          expected: validation.expected,
          actual: undefined,
        }
      }

      return {
        ...existing,
        resolution: existing.updatedIteration === finalIteration ? 'newly-verified' : 'reused-cache',
      }
    })
  }

  private summarizeValidationResults(results: StepValidationResult[]): StepValidationSummary {
    return results.reduce<StepValidationSummary>(
      (summary, item) => {
        summary.total += 1
        if (item.status === 'pass') summary.pass += 1
        else if (item.status === 'fail') summary.fail += 1
        else summary.pending += 1
        return summary
      },
      { total: 0, pass: 0, fail: 0, pending: 0 },
    )
  }

  private formatValidationResultForBlockedReason(result: StepValidationResult): string {
    const segments = [result.label]

    if (result.reason && result.reason !== 'not-yet-verified') {
      segments.push(result.reason)
    }
    if (result.actual) {
      segments.push(`actual=${result.actual}`)
    }
    if (result.expected) {
      segments.push(`expected=${result.expected}`)
    }

    return segments.join(' | ')
  }

  private buildValidationFailureBlockedReason(results: StepValidationResult[]): string {
    const summarizeBucket = (status: 'fail' | 'pending', label: string): string | null => {
      const matches = results.filter((result) => result.status === status)
      if (matches.length === 0) return null

      const maxItems = 3
      const items = matches.slice(0, maxItems).map((result) => this.formatValidationResultForBlockedReason(result))
      const remaining = matches.length - items.length
      const suffix = remaining > 0 ? `; +${remaining} more` : ''
      return `${label}: ${items.join('; ')}${suffix}`
    }

    const details = [
      summarizeBucket('fail', 'failed validations'),
      summarizeBucket('pending', 'pending validations'),
    ].filter((item): item is string => Boolean(item))

    if (details.length === 0) {
      return 'validation issues recorded: validations were not fully satisfied'
    }

    return `validation issues recorded: ${details.join(' | ')}`
  }

  private applyValidationUpdates(
    context: ExecutorContext,
    step: PlannedTransitionStep,
    validationsById: Map<string, StepValidationSpec>,
    ledger: Map<string, ValidationLedgerEntry>,
    updates: Array<{ id: string; status: 'pass' | 'fail'; reason: string; actual?: string }>,
    iteration: number,
  ): void {
    const checkedAt = new Date().toISOString()

    for (const update of updates) {
      const validation = validationsById.get(update.id)
      if (!validation) continue

      const cacheKey = this.validationCacheKey(context, step, validation.id)
      const existing = ledger.get(cacheKey)
      if (existing?.status === 'pass') {
        continue
      }

      ledger.set(cacheKey, {
        id: validation.id,
        label: validation.description,
        validationType: validation.type,
        status: update.status,
        reason: update.reason,
        cacheKey,
        resolution: 'newly-verified',
        checkedAt,
        expected: validation.expected,
        actual: update.actual,
        updatedIteration: iteration,
      })
    }
  }

  private resolveTransitionNarrative(
    narrative: StepNarrativeInstruction,
    step: PlannedTransitionStep,
  ): PathNarrativeTransitionInstruction | undefined {
    return narrative.transitions?.find((item) => item.stepId === step.id || item.edgeId === step.edgeId)
  }

  private normalizeFunctionCallsFromDecision(decision: { functionCalls?: LoopFunctionCall[] }): LoopFunctionCall[] {
    if (decision.functionCalls && decision.functionCalls.length > 0) {
      return decision.functionCalls
    }
    return []
  }

  async runPath(
    path: PlannedTransitionPath,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
  ): Promise<BrowserOperatorRunResult> {
    this.clearStopRequest(context.runId)
    const session = await this.getOrCreateSession(context)
    const page = session.page
    const transitionResults: PathTransitionResult[] = []
    let lastState: CurrentState = await this.currentState(page)
    let latestObservation: ObservationState = {
      summary: `Initial observation on ${this.summarizeLocation(lastState)}. Facts: ${this.summarizePageState(lastState.pageState)}.`,
      source: 'initial',
      boundary: 'observation-required',
      toolNames: [],
    }
    let actionCursor = 0
    const maxLoopRounds = 12
    const validationLedger = new Map<string, ValidationLedgerEntry>()
    let latestStableStateId = path.steps[0]?.fromStateId ?? null

    for (let stepIndex = 0; stepIndex < path.steps.length; stepIndex += 1) {
      const step = path.steps[stepIndex]
      const narrativeForStep = this.resolveTransitionNarrative(narrative, step)
      const rawValidations = narrativeForStep?.validations ?? step.validations
      const validations = rawValidations.map((v) => ({ ...v, observability: this.inferObservability(v) }))
      const validationsById = new Map(validations.map((validation) => [validation.id, validation] as const))
      const trace: PathTransitionResult['trace'] = []
      const exploratoryActionLimit = OPERATOR_LOOP_EXPLORATORY_ACTION_LIMIT
      let exploratoryActionCount = 0
      let noProgressRounds = 0
      let repeatedActionCount = 0
      let lastActionSignature: string | undefined
      let currentExploratoryIntent: LoopExploratoryIntent | undefined

      this.emitLiveEvent({
        type: 'transition.started',
        level: 'info',
        message: `Transition started: ${step.label}`,
        phase: 'operating',
        kind: 'progress',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        stepId: step.id,
        stepLabel: step.label,
        edgeId: step.edgeId,
        semanticGoal: context.semanticGoal,
        currentStateId: step.fromStateId,
        nextStateId: step.toStateId,
        activeEdgeId: step.edgeId,
        currentStepOrder: stepIndex + 1,
        currentPathStepTotal: path.steps.length,
        pathOrder: context.pathIndexInBatch + 1,
        totalPaths: context.totalPathsInBatch,
      })

      for (let iteration = 1; iteration <= maxLoopRounds; iteration += 1) {
        const titleSummary = lastState.title.replace(/\s+/g, ' ').slice(0, 120)
        const runtimeState = {
          url: page.url(),
          title: titleSummary,
          iteration,
          actionCursor,
          currentStepOrder: stepIndex + 1,
          totalSteps: path.steps.length,
          currentStateId: step.fromStateId,
          nextStateId: step.toStateId,
          completedTransitions: transitionResults.length,
          coordinateSpace: lastState.pageState.viewport.coordinateSpace,
          viewport: lastState.pageState.viewport,
          lastObservationSummary: latestObservation.summary,
          lastObservationSource: latestObservation.source,
          lastBatchToolNames: latestObservation.toolNames,
          lastBatchBoundary: latestObservation.boundary,
          exploratoryActionCount,
          exploratoryActionLimit,
          noProgressRounds,
          repeatedActionCount,
          lastActionSignature,
          currentExploratoryIntent,
        }

        if (this.getInterruptReason(context.runId) === 'reset') {
          const validationResults = this.buildValidationResults(context, step, validations, validationLedger, iteration)
          const validationSummary = this.summarizeValidationResults(validationResults)
          return this.buildInterruptedResult({
            step,
            reason: 'Run reset requested',
            terminationReason: 'reset',
            validationResults,
            validationSummary,
            trace,
            currentUrl: lastState.url,
            finalStateId: latestStableStateId,
          })
        }

        if (this.isStopRequested(context.runId, context.pathExecutionId)) {
          const validationResults = this.buildValidationResults(context, step, validations, validationLedger, iteration)
          const validationSummary = this.summarizeValidationResults(validationResults)
          return this.buildInterruptedResult({
            step,
            reason: 'Stop requested at tool boundary',
            terminationReason: 'stopped',
            validationResults,
            validationSummary,
            trace,
            currentUrl: lastState.url,
            finalStateId: latestStableStateId,
          })
        }

        this.emitLiveEvent({
          type: 'operator.iteration.started',
          level: 'info',
          message: `Operator iteration ${iteration} started`,
          phase: 'operating',
          kind: 'progress',
          runId: context.runId,
          pathId: context.pathId,
          pathName: context.pathName,
          pathExecutionId: context.pathExecutionId,
          attemptId: context.attemptId,
          stepId: step.id,
          stepLabel: step.label,
          edgeId: step.edgeId,
          semanticGoal: context.semanticGoal,
          iteration,
          actionCursor,
          currentStateId: step.fromStateId,
          nextStateId: step.toStateId,
          activeEdgeId: step.edgeId,
          currentStepOrder: stepIndex + 1,
          currentPathStepTotal: path.steps.length,
        })

        const decisionStartedAt = Date.now()
        const decision = await this.loopAgent.decide({
          agentMode: context.agentModes?.operatorLoop,
          context: {
            runId: context.runId,
            pathId: context.pathId,
            pathExecutionId: context.pathExecutionId,
            attemptId: context.attemptId,
            pathName: context.pathName,
            targetUrl: context.targetUrl,
            specRaw: context.specRaw,
            userTestingInfo: context.userTestingInfo,
          },
          path: {
            id: path.id,
            name: path.name,
            semanticGoal: path.semanticGoal,
            totalSteps: path.steps.length,
            actorHint: path.actorHint,
            steps: path.steps.map((pathStep) => ({
              id: pathStep.id,
              edgeId: pathStep.edgeId,
              summary: pathStep.label,
              from: {
                stateId: pathStep.fromStateId,
                diagramId: pathStep.fromDiagramId,
              },
              to: {
                stateId: pathStep.toStateId,
                diagramId: pathStep.toDiagramId,
              },
            })),
          },
          currentTransition: {
            stepId: step.id,
            edgeId: step.edgeId,
            stepOrder: stepIndex + 1,
            from: {
              stateId: step.fromStateId,
              diagramId: step.fromDiagramId,
            },
            to: {
              stateId: step.toStateId,
              diagramId: step.toDiagramId,
            },
            summary: narrativeForStep?.summary ?? step.label,
            semanticGoal: step.semantic,
          },
          runtimeState,
          screenshotBase64: lastState.screenshot.toString('base64'),
          narrative: {
            pathSummary: narrative.summary,
            executionStrategy: narrative.executionStrategy,
            currentTransitionSummary: narrativeForStep?.taskDescription ?? step.label,
            pendingValidations: validations
              .filter((validation) => validation.observability !== 'deferred')
              .filter((validation) => !validationLedger.has(this.validationCacheKey(context, step, validation.id)))
              .map((validation) => ({
                id: validation.id,
                type: validation.type,
                description: validation.description,
                expected: validation.expected,
                selector: validation.selector,
                timeoutMs: validation.timeoutMs,
              })),
            confirmedValidations: validations
              .map((validation) => {
                const existing = validationLedger.get(this.validationCacheKey(context, step, validation.id))
                if (!existing || existing.status === 'pending') return null
                return {
                  id: validation.id,
                  status: existing.status,
                  reason: existing.reason,
                }
              })
              .filter((item): item is { id: string; status: 'pass' | 'fail'; reason: string } => Boolean(item)),
            remainingTransitions: path.steps.slice(stepIndex + 1).map((remainingStep) => ({
              stepId: remainingStep.id,
              summary: remainingStep.label,
            })),
          },
        })
        const decisionElapsedMs = Date.now() - decisionStartedAt
        const decisionElapsedSeconds = toElapsedSeconds(decisionElapsedMs)

        const nextExploratoryActionCount = decision.kind === 'act' && decision.exploratoryIntent
          ? exploratoryActionCount + 1
          : exploratoryActionCount
        const explorationBudgetExceeded = decision.kind === 'act'
          && Boolean(decision.exploratoryIntent)
          && exploratoryActionCount >= exploratoryActionLimit
        const effectiveDecision = explorationBudgetExceeded
          ? {
              kind: 'fail' as const,
              reason: `Exploration budget exhausted for ${step.label}. ${exploratoryActionCount}/${exploratoryActionLimit} exploratory batches were already used without reaching the transition goal.`,
              progressSummary: 'exploration budget exhausted before the current transition could return to the main line',
              validationUpdates: decision.validationUpdates,
              exploratoryIntent: decision.exploratoryIntent,
              failureCode: 'operator-no-progress' as const,
              terminationReason: 'criteria-unmet' as const,
            }
          : decision

        this.emitLiveEvent({
          type: 'agent.generation.completed',
          level: 'success',
          message: `[operator-loop] 生成完成，花費 ${decisionElapsedSeconds}s`,
          phase: 'operating',
          kind: 'progress',
          runId: context.runId,
          pathId: context.pathId,
          pathName: context.pathName,
          pathExecutionId: context.pathExecutionId,
          attemptId: context.attemptId,
          stepId: step.id,
          stepLabel: step.label,
          edgeId: step.edgeId,
          semanticGoal: context.semanticGoal,
          iteration,
          actionCursor,
          meta: {
            agentTag: 'operator-loop',
            elapsedMs: decisionElapsedMs,
            elapsedSeconds: decisionElapsedSeconds,
          },
        })

        this.emitLiveEvent({
          type: 'operator.decision',
          level: effectiveDecision.kind === 'fail' ? 'error' : 'info',
          message: effectiveDecision.reason,
          phase: effectiveDecision.kind === 'fail' ? 'failed' : 'operating',
          kind: effectiveDecision.kind === 'fail' ? 'issue' : 'progress',
          runId: context.runId,
          pathId: context.pathId,
          pathName: context.pathName,
          pathExecutionId: context.pathExecutionId,
          attemptId: context.attemptId,
          stepId: step.id,
          stepLabel: step.label,
          edgeId: step.edgeId,
          semanticGoal: context.semanticGoal,
          iteration,
          actionCursor,
          blockedReason: effectiveDecision.kind === 'fail' ? effectiveDecision.reason : undefined,
          failureCode: effectiveDecision.kind === 'fail' ? effectiveDecision.failureCode : undefined,
          terminationReason: effectiveDecision.kind === 'fail' ? effectiveDecision.terminationReason : undefined,
          meta: {
            exploratory: Boolean(decision.exploratoryIntent),
            exploratoryIntentKind: decision.exploratoryIntent?.kind,
            exploratoryIntentSummary: decision.exploratoryIntent?.summary,
            exploratoryActionCount: nextExploratoryActionCount,
            exploratoryActionLimit,
            noProgressRounds,
            repeatedActionCount,
            lastActionSignature,
          },
        })

        this.applyValidationUpdates(context, step, validationsById, validationLedger, effectiveDecision.validationUpdates, iteration)

        const currentValidationResults = this.buildValidationResults(context, step, validations, validationLedger, iteration)
        const currentValidationSummary = this.summarizeValidationResults(currentValidationResults)

        if (effectiveDecision.kind === 'advance' || effectiveDecision.kind === 'complete') {
          const visualResults = currentValidationResults.filter((r) => r.observability !== 'deferred')
          const visualSummary = this.summarizeValidationResults(visualResults)
          const allVisualPassed = visualSummary.total === 0 || visualSummary.pass === visualSummary.total
          const validationIssueReason = allVisualPassed
            ? undefined
            : this.buildValidationFailureBlockedReason(currentValidationResults)
          trace.push({
            iteration,
            url: runtimeState.url,
            observation: JSON.stringify(runtimeState),
            action: effectiveDecision.kind === 'complete' ? 'path_complete' : 'advance_transition',
            outcome: 'success',
            detail: validationIssueReason ?? effectiveDecision.reason,
          })

          latestStableStateId = step.toStateId
          transitionResults.push({
            step,
            result: 'pass',
            validationResults: currentValidationResults,
            validationSummary: currentValidationSummary,
            trace,
            evidence: {
              domSummary: `current_url=${page.url()}`,
            },
          })

          this.emitLiveEvent({
            type: 'transition.advanced',
            level: allVisualPassed ? 'success' : 'info',
            message: allVisualPassed
              ? `Transition completed: ${step.label}`
              : `Transition completed with validation issues: ${step.label}`,
            phase: 'validating',
            kind: 'validation',
            runId: context.runId,
            pathId: context.pathId,
            pathName: context.pathName,
            pathExecutionId: context.pathExecutionId,
            attemptId: context.attemptId,
            stepId: step.id,
            stepLabel: step.label,
            edgeId: step.edgeId,
            semanticGoal: context.semanticGoal,
            currentStateId: step.fromStateId,
            nextStateId: step.toStateId,
            activeEdgeId: step.edgeId,
            currentStepOrder: stepIndex + 1,
            currentPathStepTotal: path.steps.length,
            validationSummary: currentValidationSummary,
            validationResults: currentValidationResults,
            blockedReason: validationIssueReason,
          })

          break
        }

        if (effectiveDecision.kind === 'fail') {
          transitionResults.push({
            step,
            result: 'fail',
            blockedReason: effectiveDecision.reason,
            failureCode: effectiveDecision.failureCode ?? 'operator-no-progress',
            terminationReason: effectiveDecision.terminationReason ?? 'criteria-unmet',
            validationResults: currentValidationResults,
            validationSummary: currentValidationSummary,
            trace,
            evidence: {
              domSummary: `current_url=${page.url()}`,
            },
          })
          return {
            result: 'fail',
            blockedReason: effectiveDecision.reason,
            failureCode: effectiveDecision.failureCode ?? 'operator-no-progress',
            terminationReason: effectiveDecision.terminationReason ?? 'criteria-unmet',
            transitionResults,
            finalStateId: latestStableStateId,
          }
        }

        const nextFunctionCalls = this.normalizeFunctionCallsFromDecision(effectiveDecision)
        if (nextFunctionCalls.length === 0) {
          transitionResults.push({
            step,
            result: 'fail',
            blockedReason: 'loop agent returned act without action payload',
            failureCode: 'operator-no-progress',
            terminationReason: 'criteria-unmet',
            validationResults: currentValidationResults,
            validationSummary: currentValidationSummary,
            trace,
            evidence: {
              domSummary: `current_url=${page.url()}`,
            },
          })
          return {
            result: 'fail',
            blockedReason: 'loop agent returned act without action payload',
            failureCode: 'operator-no-progress',
            terminationReason: 'criteria-unmet',
            transitionResults,
            finalStateId: latestStableStateId,
          }
        }

        const actionSignature = this.buildActionSignature(nextFunctionCalls, effectiveDecision.exploratoryIntent)
        repeatedActionCount = actionSignature === lastActionSignature ? repeatedActionCount + 1 : 1
        lastActionSignature = actionSignature
        if (effectiveDecision.exploratoryIntent) {
          exploratoryActionCount += 1
          currentExploratoryIntent = effectiveDecision.exploratoryIntent
        } else {
          currentExploratoryIntent = undefined
        }

        const functionResponses: LoopFunctionResponse[] = []
        const batchStartedFrom = lastState
        const batchToolNames: string[] = []
        const batchToolSummaries: string[] = []
        let batchBoundary: BatchBoundary = 'batch-complete'
        let activeFunctionCall: LoopFunctionCall | null = null

        try {
          for (let callIndex = 0; callIndex < nextFunctionCalls.length; callIndex += 1) {
            const functionCall = nextFunctionCalls[callIndex]
            if (this.isStopRequested(context.runId, context.pathExecutionId)) {
              batchBoundary = 'stop-requested'
              break
            }

            activeFunctionCall = functionCall
            const toolName = functionCall.name.trim().toLowerCase()
            const payload = functionCall.args
            const previousState = lastState
            batchToolNames.push(toolName)

            this.emitLiveEvent({
              type: 'operator.tool.started',
              level: 'info',
              message: functionCall.description?.trim() || `Running tool: ${toolName}`,
              phase: 'operating',
              kind: 'tool',
              runId: context.runId,
              pathId: context.pathId,
              pathName: context.pathName,
              pathExecutionId: context.pathExecutionId,
              attemptId: context.attemptId,
              stepId: step.id,
              stepLabel: step.label,
              edgeId: step.edgeId,
              semanticGoal: context.semanticGoal,
              iteration,
              actionCursor,
              meta: {
                toolName,
              },
            })

            const execution = await this.executeTool(page, toolName, payload)
            lastState = execution.state
            batchToolSummaries.push(execution.summary)

            functionResponses.push({
              name: toolName,
              arguments: payload,
              response: {
                url: lastState.url,
                status: 'success',
                message: execution.summary,
                result: execution.result,
              },
              screenshotBase64: lastState.screenshot.toString('base64'),
            })

            trace.push({
              iteration,
              url: lastState.url,
              observation: JSON.stringify({
                url: lastState.url,
                title: lastState.title,
                viewport: lastState.pageState.viewport,
                iteration,
                actionCursor,
                summary: execution.summary,
              }),
              action: `function_call:${toolName}`,
              functionCall: {
                name: functionCall.name,
                args: functionCall.args,
                description: functionCall.description,
              },
              outcome: 'success',
              detail: effectiveDecision.reason,
            })

            this.emitLiveEvent({
              type: 'operator.tool.completed',
              level: 'success',
              message: functionCall.description?.trim() || `Tool completed: ${toolName}`,
              phase: 'operating',
              kind: 'tool',
              runId: context.runId,
              pathId: context.pathId,
              pathName: context.pathName,
              pathExecutionId: context.pathExecutionId,
              attemptId: context.attemptId,
              stepId: step.id,
              stepLabel: step.label,
              edgeId: step.edgeId,
              semanticGoal: context.semanticGoal,
              iteration,
              actionCursor,
              meta: {
                toolName,
                url: lastState.url,
              },
            })

            actionCursor += 1

            if (this.isStopRequested(context.runId, context.pathExecutionId)) {
              batchBoundary = 'stop-requested'
              break
            }

            if (callIndex < nextFunctionCalls.length - 1 && this.didPageBoundaryChange(previousState, lastState, toolName)) {
              batchBoundary = 'page-changed'
              this.emitLiveEvent({
                type: 'operator.batch.boundary',
                level: 'info',
                message: `Batch paused after ${toolName} because page context changed`,
                phase: 'operating',
                kind: 'progress',
                runId: context.runId,
                pathId: context.pathId,
                pathName: context.pathName,
                pathExecutionId: context.pathExecutionId,
                attemptId: context.attemptId,
                stepId: step.id,
                stepLabel: step.label,
                edgeId: step.edgeId,
                semanticGoal: context.semanticGoal,
                iteration,
                actionCursor,
                meta: {
                  toolName,
                  boundary: batchBoundary,
                  remainingCalls: nextFunctionCalls.length - callIndex - 1,
                },
              })
              break
            }
          }

          latestObservation = {
            summary: this.buildObservationSummary({
              before: batchStartedFrom,
              after: lastState,
              toolNames: batchToolNames,
              toolSummaries: batchToolSummaries,
              boundary: batchBoundary,
            }),
            source: 'tool-batch',
            boundary: batchBoundary,
            toolNames: [...batchToolNames],
          }

          noProgressRounds = this.didBatchMakeProgress({
            before: batchStartedFrom,
            after: lastState,
            boundary: batchBoundary,
            validationUpdates: effectiveDecision.validationUpdates,
          })
            ? 0
            : noProgressRounds + 1

          if (this.loopAgent.appendFunctionResponses) {
            await this.loopAgent.appendFunctionResponses({
              agentMode: context.agentModes?.operatorLoop,
              runId: context.runId,
              pathId: context.pathId,
              pathExecutionId: context.pathExecutionId,
              attemptId: context.attemptId,
              stepId: step.id,
              stepOrder: stepIndex + 1,
              narrativeSummary: narrativeForStep?.summary ?? step.label,
              runtimeState: {
                ...runtimeState,
                url: lastState.url,
                title: lastState.title.replace(/\s+/g, ' ').slice(0, 120),
                actionCursor,
                coordinateSpace: lastState.pageState.viewport.coordinateSpace,
                viewport: lastState.pageState.viewport,
                lastObservationSummary: latestObservation.summary,
                lastObservationSource: latestObservation.source,
                lastBatchToolNames: latestObservation.toolNames,
                lastBatchBoundary: latestObservation.boundary,
                exploratoryActionCount,
                exploratoryActionLimit,
                noProgressRounds,
                repeatedActionCount,
                lastActionSignature,
                currentExploratoryIntent,
              },
              observationSummary: latestObservation.summary,
              observationSource: latestObservation.source,
              batchBoundary: latestObservation.boundary,
              responses: functionResponses,
            })
          }

          if (batchBoundary === 'stop-requested') {
            return this.buildInterruptedResult({
              step,
              reason: 'Stop requested at tool boundary',
              terminationReason: 'stopped',
              validationResults: currentValidationResults,
              validationSummary: currentValidationSummary,
              trace,
              currentUrl: lastState.url,
              finalStateId: latestStableStateId,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'tool execution failed'
          const interruptionReason = this.getInterruptReason(context.runId)
          if (interruptionReason === 'reset') {
            return this.buildInterruptedResult({
              step,
              reason: 'Run reset requested',
              terminationReason: 'reset',
              validationResults: currentValidationResults,
              validationSummary: currentValidationSummary,
              trace,
              currentUrl: lastState?.url ?? page.url(),
              finalStateId: latestStableStateId,
            })
          }

          batchBoundary = 'observation-required'
          batchToolSummaries.push(message)
          latestObservation = {
            summary: this.buildObservationSummary({
              before: batchStartedFrom,
              after: lastState ?? batchStartedFrom,
              toolNames: batchToolNames,
              toolSummaries: batchToolSummaries,
              boundary: batchBoundary,
            }),
            source: 'tool-batch',
            boundary: batchBoundary,
            toolNames: [...batchToolNames],
          }
          noProgressRounds += 1

          if (this.loopAgent.appendFunctionResponses) {
            const failedResponse: LoopFunctionResponse = {
              name: activeFunctionCall?.name ?? 'unknown_tool',
              arguments: activeFunctionCall?.args ?? {},
              response: {
                url: lastState?.url ?? page.url(),
                status: 'failed',
                message,
              },
              screenshotBase64: lastState?.screenshot?.toString('base64'),
            }
            await this.loopAgent.appendFunctionResponses({
              agentMode: context.agentModes?.operatorLoop,
              runId: context.runId,
              pathId: context.pathId,
              pathExecutionId: context.pathExecutionId,
              attemptId: context.attemptId,
              stepId: step.id,
              stepOrder: stepIndex + 1,
              narrativeSummary: narrativeForStep?.summary ?? step.label,
              runtimeState: {
                ...runtimeState,
                url: lastState?.url ?? page.url(),
                title: lastState?.title ?? titleSummary,
                actionCursor,
                coordinateSpace: lastState?.pageState.viewport.coordinateSpace ?? runtimeState.coordinateSpace,
                viewport: lastState?.pageState.viewport ?? runtimeState.viewport,
                lastObservationSummary: latestObservation.summary,
                lastObservationSource: latestObservation.source,
                lastBatchToolNames: latestObservation.toolNames,
                lastBatchBoundary: latestObservation.boundary,
                exploratoryActionCount,
                exploratoryActionLimit,
                noProgressRounds,
                repeatedActionCount,
                lastActionSignature,
                currentExploratoryIntent,
              },
              observationSummary: latestObservation.summary,
              observationSource: latestObservation.source,
              batchBoundary: latestObservation.boundary,
              responses: [...functionResponses, failedResponse],
            })
          }

          trace.push({
            iteration,
            url: lastState?.url ?? page.url(),
            observation: JSON.stringify({
              url: lastState?.url ?? page.url(),
              title: lastState?.title ?? '',
              iteration,
              actionCursor,
            }),
            action: `function_call:${activeFunctionCall?.name ?? 'unknown_tool'}`,
            functionCall: activeFunctionCall
              ? {
                  name: activeFunctionCall.name,
                  args: activeFunctionCall.args,
                  description: activeFunctionCall.description,
                }
              : undefined,
            outcome: 'failed',
            detail: message,
          })

          this.emitLiveEvent({
            type: 'operator.tool.failed',
            level: 'info',
            message,
            phase: 'operating',
            kind: 'issue',
            runId: context.runId,
            pathId: context.pathId,
            pathName: context.pathName,
            pathExecutionId: context.pathExecutionId,
            attemptId: context.attemptId,
            stepId: step.id,
            stepLabel: step.label,
            edgeId: step.edgeId,
            semanticGoal: context.semanticGoal,
            iteration,
            actionCursor,
            blockedReason: message,
            failureCode: 'operator-action-failed',
            terminationReason: 'operator-error',
            validationSummary: currentValidationSummary,
            validationResults: currentValidationResults,
            meta: {
              toolName: activeFunctionCall?.name,
              recoverable: true,
            },
          })

          actionCursor += 1
          continue
        }
      }

      if (transitionResults.length <= stepIndex) {
        const finalValidationResults = this.buildValidationResults(context, step, validations, validationLedger, maxLoopRounds)
        const finalValidationSummary = this.summarizeValidationResults(finalValidationResults)
        transitionResults.push({
          step,
          result: 'fail',
          blockedReason: 'Max iterations reached before Copilot completed the transition',
          failureCode: 'operator-timeout',
          terminationReason: 'max-iterations',
          validationResults: finalValidationResults,
          validationSummary: finalValidationSummary,
          trace: [],
          evidence: {
            domSummary: `current_url=${lastState?.url ?? page.url()}`,
          },
        })
        return {
          result: 'fail',
          blockedReason: 'Max iterations reached before Copilot completed the transition',
          failureCode: 'operator-timeout',
          terminationReason: 'max-iterations',
          transitionResults,
          finalStateId: latestStableStateId,
        }
      }
    }

    return {
      result: 'pass',
      transitionResults,
      finalStateId: path.steps[path.steps.length - 1]?.toStateId ?? latestStableStateId,
    }
  }

  async cleanupRun(runId: string): Promise<void> {
    if (this.loopAgent.cleanupRun) {
      await this.loopAgent.cleanupRun(runId)
    }

    const entries = Array.from(this.sessions.entries()).filter(([key]) => key.startsWith(`${runId}:`))
    await Promise.all(entries.map(async ([key]) => this.closeSessionByKey(key)))
    this.clearRunControl(runId)
  }

  async requestStop(runId: string, pathExecutionId?: string): Promise<void> {
    const control = this.getOrCreateRunControl(runId)
    control.stopRequested = true
    control.requestedPathExecutionId = pathExecutionId
  }

  async interruptRun(runId: string, reason: 'reset'): Promise<void> {
    this.setInterruptReason(runId, reason)

    const entries = Array.from(this.sessions.entries()).filter(([key]) => key.startsWith(`${runId}:`))
    await Promise.all(entries.map(async ([key]) => this.closeSessionByKey(key)))
  }

  async cleanupPath(runId: string, pathExecutionId: string): Promise<void> {
    if (this.loopAgent.cleanupPath) {
      await this.loopAgent.cleanupPath(runId, pathExecutionId)
    }
    const key = this.sessionKey(runId, pathExecutionId)
    await this.closeSessionByKey(key)
  }

  async resetReplayCursor(): Promise<void> {
    if (this.loopAgent.resetReplayCursor) {
      await this.loopAgent.resetReplayCursor()
    }
  }
}
