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
} from '../type/operatorExecutionContracts'
import type {
  BrowserOperator,
  BrowserOperatorRunResult,
  BrowserPage,
  BrowserSession,
  DocumentLike,
  LoopFunctionCall,
  LoopFunctionResponse,
  OperatorLoopAgent,
} from './contracts'
import { OperatorLoopApi } from '../OperatorLoopApi'

type ToolPayload = Record<string, unknown>

type CurrentState = {
  screenshot: Buffer
  url: string
  title: string
}

type ToolExecutionResult = {
  state: CurrentState
  result?: unknown
}

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

const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

export class PlaywrightBrowserOperator implements BrowserOperator {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly highlightMouseEnabled = process.env.PLANNED_RUNNER_HIGHLIGHT_MOUSE === 'true'
  private readonly browserHeadless = parseBooleanEnv(process.env.OPERATOR_BROWSER_HEADLESS, true)
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

    const contextInstance = await browser.newContext()
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

  private async highlightMouse(page: BrowserPage, x: number, y: number): Promise<void> {
    if (!this.highlightMouseEnabled) return

    await page.evaluate(
      ({ mouseX, mouseY }) => {
        const elementId = 'playwright-feedback-circle'
        const doc = (globalThis as { document?: DocumentLike }).document
        if (!doc) {
          return
        }

        let div = doc.getElementById(elementId)
        if (!div) {
          div = doc.createElement('div')
          div.id = elementId
          div.style.pointerEvents = 'none'
          div.style.border = '4px solid red'
          div.style.borderRadius = '50%'
          div.style.width = '20px'
          div.style.height = '20px'
          div.style.position = 'fixed'
          div.style.zIndex = '9999'
          doc.body.appendChild(div)
        }

        div.hidden = false
        div.style.left = `${mouseX - 10}px`
        div.style.top = `${mouseY - 10}px`

        setTimeout(() => {
          div.hidden = true
        }, 2000)
      },
      { mouseX: x, mouseY: y },
    )

    await page.waitForTimeout(1000)
  }

  private async clickAt(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const text = this.readFirstString(payload, ['text', 'label', 'targetText'])
    if (text) {
      await page.locator(`text=${text}`).first().click({ timeout: 5000 })
      return
    }

    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')
    await this.highlightMouse(page, x, y)
    await page.mouse.click(x, y)
  }

  private async hoverAt(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')
    await this.highlightMouse(page, x, y)
    await page.mouse.move(x, y)
  }

  private async typeTextAt(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')
    const text = this.readString(payload, 'text')
    const pressEnter = this.readBoolean(payload, 'pressEnter', false)
    const clearBeforeTyping = this.readBoolean(payload, 'clearBeforeTyping', true)

    await this.highlightMouse(page, x, y)
    await page.mouse.click(x, y)

    if (clearBeforeTyping) {
      await this.keyCombination(page, ['control', 'a'])
      await this.keyCombination(page, ['delete'])
    }

    await page.keyboard.type(text)

    if (pressEnter) {
      await this.keyCombination(page, ['enter'])
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

  private async scrollAt(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')
    const direction = this.readString(payload, 'direction').toLowerCase()
    const magnitudeRaw = payload.magnitude
    const magnitude = typeof magnitudeRaw === 'number' && magnitudeRaw > 0 ? magnitudeRaw : 800

    await this.highlightMouse(page, x, y)
    await page.mouse.move(x, y)

    let dx = 0
    let dy = 0
    if (direction === 'up') dy = -magnitude
    else if (direction === 'down') dy = magnitude
    else if (direction === 'left') dx = -magnitude
    else if (direction === 'right') dx = magnitude
    else throw new Error(`unsupported scroll_at direction: ${direction}`)

    await page.mouse.wheel(dx, dy)
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

  private async dragAndDrop(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const x = this.readNumber(payload, 'x')
    const y = this.readNumber(payload, 'y')
    const destinationX = this.readNumber(payload, 'destination_x')
    const destinationY = this.readNumber(payload, 'destination_y')

    await this.highlightMouse(page, x, y)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await this.highlightMouse(page, destinationX, destinationY)
    await page.mouse.move(destinationX, destinationY)
    await page.mouse.up()
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
    const screenshotBytes = (await page.screenshot({ type: 'png', fullPage: false })) as Buffer
    const title = await page.title()
    return {
      screenshot: screenshotBytes,
      url: page.url(),
      title,
    }
  }

  private async executeTool(page: BrowserPage, toolName: string, payload: ToolPayload): Promise<ToolExecutionResult> {
    switch (toolName) {
      case 'open_web_browser':
        return { state: await this.currentState(page) }
      case 'click_at':
        await this.clickAt(page, payload)
        return { state: await this.currentState(page) }
      case 'hover_at':
        await this.hoverAt(page, payload)
        return { state: await this.currentState(page) }
      case 'type_text_at':
        await this.typeTextAt(page, payload)
        return { state: await this.currentState(page) }
      case 'scroll_document':
        await this.scrollDocument(page, payload)
        return { state: await this.currentState(page) }
      case 'scroll_at':
        await this.scrollAt(page, payload)
        return { state: await this.currentState(page) }
      case 'wait_5_seconds':
        await this.wait5Seconds(page)
        return { state: await this.currentState(page) }
      case 'evaluate': {
        const result = await this.evaluateScript(page, payload)
        return { state: await this.currentState(page), result }
      }
      case 'go_back':
        await this.goBack(page)
        return { state: await this.currentState(page) }
      case 'go_forward':
        await this.goForward(page)
        return { state: await this.currentState(page) }
      case 'navigate':
        await this.navigate(page, payload)
        return { state: await this.currentState(page) }
      case 'key_combination': {
        const keys = this.readStringArray(payload, 'keys')
        await this.keyCombination(page, keys)
        return { state: await this.currentState(page) }
      }
      case 'drag_and_drop':
        await this.dragAndDrop(page, payload)
        return { state: await this.currentState(page) }
      case 'current_state':
        return { state: await this.currentState(page) }
      default:
        throw new Error(`unsupported tool: ${toolName}`)
    }
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
        return {
          id: validation.id,
          label: validation.description,
          validationType: validation.type,
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
    const session = await this.getOrCreateSession(context)
    const page = session.page
    const transitionResults: PathTransitionResult[] = []
    let lastState: CurrentState = await this.currentState(page)
    let actionCursor = 0
    const maxLoopRounds = 12
    const validationLedger = new Map<string, ValidationLedgerEntry>()
    let latestStableStateId = path.steps[0]?.fromStateId ?? null

    for (let stepIndex = 0; stepIndex < path.steps.length; stepIndex += 1) {
      const step = path.steps[stepIndex]
      const narrativeForStep = this.resolveTransitionNarrative(narrative, step)
      const validations = narrativeForStep?.validations ?? step.validations
      const validationsById = new Map(validations.map((validation) => [validation.id, validation] as const))
      const trace: PathTransitionResult['trace'] = []

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
          agentMode: context.agentModes.operatorLoop,
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
          level: decision.kind === 'fail' ? 'error' : 'info',
          message: decision.reason,
          phase: decision.kind === 'fail' ? 'failed' : 'operating',
          kind: decision.kind === 'fail' ? 'issue' : 'progress',
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
          blockedReason: decision.kind === 'fail' ? decision.reason : undefined,
          failureCode: decision.kind === 'fail' ? decision.failureCode : undefined,
          terminationReason: decision.kind === 'fail' ? decision.terminationReason : undefined,
        })

        this.applyValidationUpdates(context, step, validationsById, validationLedger, decision.validationUpdates, iteration)

        const currentValidationResults = this.buildValidationResults(context, step, validations, validationLedger, iteration)
        const currentValidationSummary = this.summarizeValidationResults(currentValidationResults)

        if (decision.kind === 'advance' || decision.kind === 'complete') {
          const allPassed = currentValidationSummary.total > 0 && currentValidationSummary.pass === currentValidationSummary.total
          trace.push({
            iteration,
            url: runtimeState.url,
            observation: JSON.stringify(runtimeState),
            action: decision.kind === 'complete' ? 'path_complete' : 'advance_transition',
            outcome: allPassed ? 'success' : 'failed',
            detail: decision.reason,
          })

          if (!allPassed) {
            transitionResults.push({
              step,
              result: 'fail',
              blockedReason: 'transition completion rejected: all validations must pass',
              failureCode: 'validation-failed',
              terminationReason: 'validation-failed',
              validationResults: currentValidationResults,
              validationSummary: currentValidationSummary,
              trace,
              evidence: {
                domSummary: `current_url=${page.url()}`,
              },
            })
            return {
              result: 'fail',
              blockedReason: 'transition completion rejected: all validations must pass',
              failureCode: 'validation-failed',
              terminationReason: 'validation-failed',
              transitionResults,
              finalStateId: latestStableStateId,
            }
          }

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
            level: 'success',
            message: `Transition completed: ${step.label}`,
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
          })

          break
        }

        if (decision.kind === 'fail') {
          transitionResults.push({
            step,
            result: 'fail',
            blockedReason: decision.reason,
            failureCode: decision.failureCode ?? 'operator-no-progress',
            terminationReason: decision.terminationReason ?? 'criteria-unmet',
            validationResults: currentValidationResults,
            validationSummary: currentValidationSummary,
            trace,
            evidence: {
              domSummary: `current_url=${page.url()}`,
            },
          })
          return {
            result: 'fail',
            blockedReason: decision.reason,
            failureCode: decision.failureCode ?? 'operator-no-progress',
            terminationReason: decision.terminationReason ?? 'criteria-unmet',
            transitionResults,
            finalStateId: latestStableStateId,
          }
        }

        const nextFunctionCalls = this.normalizeFunctionCallsFromDecision(decision)
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

        const functionResponses: LoopFunctionResponse[] = []
        let activeFunctionCall: LoopFunctionCall | null = null

        try {
          for (const functionCall of nextFunctionCalls) {
            activeFunctionCall = functionCall
            const toolName = functionCall.name.trim().toLowerCase()
            const payload = functionCall.args

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

            functionResponses.push({
              name: toolName,
              arguments: payload,
              response: {
                url: lastState.url,
                status: 'success',
                message: functionCall.description,
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
                iteration,
                actionCursor,
              }),
              action: `function_call:${toolName}`,
              functionCall: {
                name: functionCall.name,
                args: functionCall.args,
                description: functionCall.description,
              },
              outcome: 'success',
              detail: decision.reason,
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
          }

          if (this.loopAgent.appendFunctionResponses) {
            await this.loopAgent.appendFunctionResponses({
              agentMode: context.agentModes.operatorLoop,
              runId: context.runId,
              pathId: context.pathId,
              pathExecutionId: context.pathExecutionId,
              attemptId: context.attemptId,
              stepId: step.id,
              stepOrder: stepIndex + 1,
              narrativeSummary: narrativeForStep?.summary ?? step.label,
              runtimeState,
              responses: functionResponses,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'tool execution failed'
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
              agentMode: context.agentModes.operatorLoop,
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
              },
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
            level: 'error',
            message,
            phase: 'failed',
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
            },
          })

          transitionResults.push({
            step,
            result: 'fail',
            blockedReason: message,
            failureCode: 'operator-action-failed',
            terminationReason: 'operator-error',
            validationResults: currentValidationResults,
            validationSummary: currentValidationSummary,
            trace,
            evidence: {
              domSummary: `current_url=${lastState?.url ?? page.url()}`,
            },
          })
          return {
            result: 'fail',
            blockedReason: message,
            failureCode: 'operator-action-failed',
            terminationReason: 'operator-error',
            transitionResults,
            finalStateId: latestStableStateId,
          }
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
