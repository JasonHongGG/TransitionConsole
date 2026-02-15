import type {
  ExecutorContext,
  OperatorTraceItem,
  PlannedTransitionStep,
  StepAssertionSpec,
  StepExecutionResult,
  StepInstruction,
  StepValidationResult,
} from '../../types'
import type { BrowserOperator, BrowserPage, BrowserSession } from '../contracts'

type ToolPayload = Record<string, unknown>

type CurrentState = {
  screenshot: Buffer
  url: string
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

export class PlaywrightBrowserOperator implements BrowserOperator {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly highlightMouseEnabled = process.env.PLANNED_RUNNER_HIGHLIGHT_MOUSE === 'true'
  private playwrightModulePromise: Promise<{ chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> } }> | null = null

  private async getPlaywrightModule(): Promise<{ chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> } }> {
    if (!this.playwrightModulePromise) {
      const importFn = new Function('m', 'return import(m)') as (moduleName: string) => Promise<unknown>
      this.playwrightModulePromise = importFn('playwright') as Promise<{
        chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> }
      }>
    }
    return this.playwrightModulePromise
  }

  private sessionKey(runId: string, pathId: string): string {
    return `${runId}:${pathId}`
  }

  private async getOrCreateSession(context: ExecutorContext): Promise<BrowserSession> {
    const key = this.sessionKey(context.runId, context.pathId)
    const existing = this.sessions.get(key)
    if (existing) return existing

    const playwright = await this.getPlaywrightModule()
    const browser = (await playwright.chromium.launch()) as BrowserSession['browser'] & {
      newContext: (options?: Record<string, unknown>) => Promise<BrowserSession['context']>
    }

    const contextInstance = await browser.newContext()
    const page = await contextInstance.newPage()

    const session: BrowserSession = {
      browser,
      context: contextInstance,
      page: page as BrowserPage,
      network: [],
    }
    this.sessions.set(key, session)
    return session
  }

  private parseToolPayload(action: StepInstruction['actions'][number]): ToolPayload {
    if (!action.value) return {}
    try {
      const parsed = JSON.parse(action.value) as unknown
      if (parsed && typeof parsed === 'object') return parsed as ToolPayload
      throw new Error('action value must be a JSON object')
    } catch (error) {
      throw new Error(`invalid action.value JSON for ${action.action}: ${error instanceof Error ? error.message : 'parse failed'}`)
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

  private normalizeToolName(action: StepInstruction['actions'][number], payload: ToolPayload): string {
    const explicitTool = payload.tool
    if (typeof explicitTool === 'string' && explicitTool.trim().length > 0) return explicitTool.trim().toLowerCase()

    const byAction: Record<string, string> = {
      goto: 'navigate',
      click: 'click_at',
      type: 'type_text_at',
      press: 'key_combination',
      wait: 'wait_5_seconds',
      scroll: 'scroll_document',
      select: 'click_at',
    }

    return byAction[action.action] ?? 'custom'
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
        let div = document.getElementById(elementId) as HTMLDivElement | null
        if (!div) {
          div = document.createElement('div')
          div.id = elementId
          div.style.pointerEvents = 'none'
          div.style.border = '4px solid red'
          div.style.borderRadius = '50%'
          div.style.width = '20px'
          div.style.height = '20px'
          div.style.position = 'fixed'
          div.style.zIndex = '9999'
          document.body.appendChild(div)
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

  private async evaluateScript(page: BrowserPage, payload: ToolPayload): Promise<void> {
    const script = this.readString(payload, 'script')
    const modeRaw = payload.mode
    const mode = typeof modeRaw === 'string' ? modeRaw.toLowerCase() : 'expression'

    if (mode === 'function') {
      const executable = new Function(`return (${script});`)() as (arg: unknown) => unknown
      if (typeof executable !== 'function') {
        throw new Error('evaluate tool requires script to resolve to a function when mode=function')
      }

      const evaluateFn = page.evaluate as unknown as (pageFunction: (arg: unknown) => unknown, arg: unknown) => Promise<unknown>
      await evaluateFn(executable, payload.arg)
      return
    }

    const evaluateExpression = page.evaluate as unknown as (expression: string) => Promise<unknown>
    await evaluateExpression(script)
  }

  private async currentState(page: BrowserPage): Promise<CurrentState> {
    const screenshotBytes = (await page.screenshot({ type: 'png', fullPage: false })) as Buffer
    return {
      screenshot: screenshotBytes,
      url: page.url(),
    }
  }

  private async executeTool(page: BrowserPage, toolName: string, payload: ToolPayload): Promise<CurrentState> {
    switch (toolName) {
      case 'open_web_browser':
        return this.currentState(page)
      case 'click_at':
        await this.clickAt(page, payload)
        return this.currentState(page)
      case 'hover_at':
        await this.hoverAt(page, payload)
        return this.currentState(page)
      case 'type_text_at':
        await this.typeTextAt(page, payload)
        return this.currentState(page)
      case 'scroll_document':
        await this.scrollDocument(page, payload)
        return this.currentState(page)
      case 'scroll_at':
        await this.scrollAt(page, payload)
        return this.currentState(page)
      case 'wait_5_seconds':
        await this.wait5Seconds(page)
        return this.currentState(page)
      case 'evaluate':
        await this.evaluateScript(page, payload)
        return this.currentState(page)
      case 'go_back':
        await this.goBack(page)
        return this.currentState(page)
      case 'go_forward':
        await this.goForward(page)
        return this.currentState(page)
      case 'navigate':
        await this.navigate(page, payload)
        return this.currentState(page)
      case 'key_combination': {
        const keys = this.readStringArray(payload, 'keys')
        await this.keyCombination(page, keys)
        return this.currentState(page)
      }
      case 'drag_and_drop':
        await this.dragAndDrop(page, payload)
        return this.currentState(page)
      case 'current_state':
        return this.currentState(page)
      default:
        throw new Error(`unsupported tool: ${toolName}`)
    }
  }

  private async evaluateAssertion(assertion: StepAssertionSpec, page: BrowserPage): Promise<StepValidationResult> {
    try {
      const currentUrl = page.url()

      if (assertion.type === 'url-equals') {
        const pass = currentUrl === (assertion.expected ?? '')
        return {
          id: assertion.id,
          label: assertion.description,
          assertionType: assertion.type,
          status: pass ? 'pass' : 'fail',
          reason: pass ? 'URL equals expected' : 'URL mismatch',
          expected: assertion.expected,
          actual: currentUrl,
        }
      }

      if (assertion.type === 'url-includes') {
        const expected = assertion.expected ?? ''
        const pass = currentUrl.includes(expected)
        return {
          id: assertion.id,
          label: assertion.description,
          assertionType: assertion.type,
          status: pass ? 'pass' : 'fail',
          reason: pass ? 'URL includes expected text' : 'URL missing expected text',
          expected,
          actual: currentUrl,
        }
      }

      if ((assertion.type === 'element-visible' || assertion.type === 'element-not-visible') && assertion.selector) {
        const visible = await page.locator(assertion.selector).first().isVisible({ timeout: assertion.timeoutMs ?? 5000 }).catch(() => false)
        const pass = assertion.type === 'element-visible' ? visible : !visible
        return {
          id: assertion.id,
          label: assertion.description,
          assertionType: assertion.type,
          status: pass ? 'pass' : 'fail',
          reason: pass ? 'Element visibility matched expected state' : 'Element visibility did not match expected state',
          expected: assertion.selector,
          actual: visible ? 'visible' : 'not-visible',
        }
      }

      if (assertion.type === 'text-visible' || assertion.type === 'text-not-visible') {
        const text = assertion.expected || assertion.description
        const count = await page.locator(`text=${text}`).count()
        const visible = count > 0
        const pass = assertion.type === 'text-visible' ? visible : !visible
        return {
          id: assertion.id,
          label: assertion.description,
          assertionType: assertion.type,
          status: pass ? 'pass' : 'fail',
          reason: pass ? 'Text visibility matched expected state' : 'Text visibility did not match expected state',
          expected: text,
          actual: visible ? 'visible' : 'not-visible',
        }
      }

      return {
        id: assertion.id,
        label: assertion.description,
        assertionType: assertion.type,
        status: 'pass',
        reason: 'Assertion type not implemented in tool operator; treated as pass',
      }
    } catch (error) {
      return {
        id: assertion.id,
        label: assertion.description,
        assertionType: assertion.type,
        status: 'fail',
        reason: error instanceof Error ? error.message : 'assertion evaluation failed',
      }
    }
  }

  async run(
    _step: PlannedTransitionStep,
    context: ExecutorContext,
    instruction: StepInstruction,
    assertions: StepAssertionSpec[],
  ): Promise<{
    result: 'pass' | 'fail'
    blockedReason?: string
    failureCode?: StepExecutionResult['failureCode']
    validationResults: StepValidationResult[]
    trace: OperatorTraceItem[]
    evidence: StepExecutionResult['evidence']
  }> {
    const session = await this.getOrCreateSession(context)
    const page = session.page
    const trace: OperatorTraceItem[] = []

    let lastState: CurrentState | null = await this.currentState(page)

    for (let index = 0; index < instruction.actions.length; index += 1) {
      const action = instruction.actions[index]
      const payload = this.parseToolPayload(action)
      const toolName = this.normalizeToolName(action, payload)

      try {
        lastState = await this.executeTool(page, toolName, payload)
        trace.push({
          iteration: index + 1,
          observation: `url=${lastState.url}`,
          action: `${toolName}:${action.description}`,
          outcome: 'success',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tool execution failed'
        trace.push({
          iteration: index + 1,
          observation: `url=${lastState?.url ?? page.url()}`,
          action: `${toolName}:${action.description}`,
          outcome: 'failed',
          detail: message,
        })

        return {
          result: 'fail',
          blockedReason: message,
          failureCode: 'operator-action-failed',
          validationResults: [],
          trace,
          evidence: {
            domSummary: `current_url=${lastState?.url ?? page.url()}`,
          },
        }
      }
    }

    const validationResults: StepValidationResult[] = []
    for (const assertion of assertions) {
      validationResults.push(await this.evaluateAssertion(assertion, page))
    }

    const hasFailedAssertion = validationResults.some((item) => item.status === 'fail')

    return {
      result: hasFailedAssertion ? 'fail' : 'pass',
      blockedReason: hasFailedAssertion ? 'Assertions failed after tool execution' : undefined,
      failureCode: hasFailedAssertion ? 'assertion-failed' : undefined,
      validationResults,
      trace,
      evidence: {
        domSummary: `current_url=${lastState?.url ?? page.url()}`,
      },
    }
  }

  async cleanupRun(runId: string): Promise<void> {
    const entries = Array.from(this.sessions.entries()).filter(([key]) => key.startsWith(`${runId}:`))
    await Promise.all(
      entries.map(async ([key, session]) => {
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
      }),
    )
  }
}
