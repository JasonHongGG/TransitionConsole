import type {
  ExecutionFailureCode,
  ExecutorContext,
  StepNarrativeInstruction,
  OperatorTraceItem,
  OperatorTerminationReason,
  PlannedTransitionStep,
  StepAssertionSpec,
  StepExecutionResult,
  StepValidationResult,
} from '../types'

export interface StepNarrator {
  generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction>
}

export interface LoopDecisionInput {
  context: {
    runId: string
    pathId: string
    stepId: string
    targetUrl: string
    specRaw: string | null
    userTestingInfo?: ExecutorContext['userTestingInfo']
    diagrams: ExecutorContext['systemDiagrams']
  }
  step: {
    edgeId: string
    from: {
      stateId: string
      diagramId: string
    }
    to: {
      stateId: string
      diagramId: string
    }
    summary?: string
    semanticGoal?: string
  }
  iteration: number
  currentUrl: string
  stateSummary: string
  screenshotBase64: string
  actionCursor: number
  narrative: StepNarrativeInstruction
  assertions: StepAssertionSpec[]
}

export interface LoopFunctionCall {
  name: string
  args: Record<string, unknown>
  description?: string
}

export interface LoopDecision {
  kind: 'complete' | 'act' | 'fail'
  reason: string
  functionCalls?: LoopFunctionCall[]
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
}

export interface LoopFunctionResponse {
  name: string
  arguments: Record<string, unknown>
  response: {
    url?: string
    status: 'success' | 'failed'
    message?: string
  }
  screenshotBase64?: string
}

export interface OperatorLoopAgent {
  decide(input: LoopDecisionInput): Promise<LoopDecision>
  appendFunctionResponses?(runId: string, pathId: string, responses: LoopFunctionResponse[]): Promise<void>
  cleanupRun?(runId: string): Promise<void>
}

export interface BrowserOperatorRunResult {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: StepExecutionResult['failureCode']
  terminationReason?: StepExecutionResult['terminationReason']
  validationResults: StepValidationResult[]
  trace: OperatorTraceItem[]
  evidence: StepExecutionResult['evidence']
}

export interface BrowserOperator {
  run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
    assertions: StepAssertionSpec[],
  ): Promise<BrowserOperatorRunResult>
  cleanupRun?(runId: string): Promise<void>
}

export type NetworkRecord = { method: string; url: string; status: number | null }

export interface OverlayElement {
  id: string
  hidden: boolean
  style: Record<string, string>
}

export interface DocumentLike {
  getElementById: (id: string) => OverlayElement | null
  createElement: (tagName: string) => OverlayElement
  body: {
    appendChild: (node: OverlayElement) => void
  }
}

export interface BrowserPage {
  goto: (url: string, options?: { waitUntil?: 'domcontentloaded' | 'load'; timeout?: number }) => Promise<unknown>
  goBack: () => Promise<unknown>
  goForward: () => Promise<unknown>
  evaluate: <Arg>(
    pageFunction: (arg: Arg) => unknown,
    arg: Arg,
  ) => Promise<unknown>
  waitForTimeout: (ms: number) => Promise<void>
  screenshot: (options: { path?: string; fullPage?: boolean; type?: 'png' | 'jpeg' }) => Promise<unknown>
  url: () => string
  title: () => Promise<string>
  mouse: {
    click: (x: number, y: number) => Promise<void>
    move: (x: number, y: number) => Promise<void>
    wheel: (deltaX: number, deltaY: number) => Promise<void>
    down: () => Promise<void>
    up: () => Promise<void>
  }
  locator: (selector: string) => {
    first: () => {
      click: (options?: { timeout?: number }) => Promise<void>
      fill: (value: string, options?: { timeout?: number }) => Promise<void>
      isVisible: (options?: { timeout?: number }) => Promise<boolean>
      count: () => Promise<number>
      textContent: () => Promise<string | null>
    }
    count: () => Promise<number>
  }
  getByRole: (role: string, options: { name?: string | RegExp }) => {
    first: () => {
      click: (options?: { timeout?: number }) => Promise<void>
    }
  }
  keyboard: {
    down: (key: string) => Promise<void>
    up: (key: string) => Promise<void>
    press: (key: string) => Promise<void>
    type: (text: string) => Promise<void>
  }
}

export interface BrowserSession {
  browser: {
    close: () => Promise<void>
  }
  context: {
    close: () => Promise<void>
    newPage: () => Promise<BrowserPage>
    on: (event: string, handler: (...args: unknown[]) => void) => void
  }
  page: BrowserPage
  network: NetworkRecord[]
}

export interface OperatorObservation {
  url: string
  title: string
  domSummary: string
  networkSummary: string
}
