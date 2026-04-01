import type {
  ExecutionFailureCode,
  ExecutorContext,
  OperatorTerminationReason,
  PlannedTransitionPath,
  PathTransitionResult,
  StepNarrativeInstruction,
} from '../type/operatorExecutionContracts'
import type {
  LoopCoordinateSpace,
  LoopAppendFunctionResponsesInput,
  LoopDecision,
  LoopDecisionInput,
  LoopElementState,
  LoopExploratoryIntent,
  LoopExploratoryIntentKind,
  LoopFunctionCall,
  LoopFunctionResponse,
  LoopPageState,
  LoopViewportState,
  OperatorLoopAgent,
} from '../type/operatorLoopContracts'

export type {
  LoopCoordinateSpace,
  LoopAppendFunctionResponsesInput,
  LoopDecision,
  LoopDecisionInput,
  LoopElementState,
  LoopExploratoryIntent,
  LoopExploratoryIntentKind,
  LoopFunctionCall,
  LoopFunctionResponse,
  LoopPageState,
  LoopViewportState,
  OperatorLoopAgent,
}

export interface BrowserOperatorRunResult {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
  transitionResults: PathTransitionResult[]
  finalStateId: string | null
}

export interface BrowserOperator {
  runPath(
    path: PlannedTransitionPath,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
  ): Promise<BrowserOperatorRunResult>
  requestStop?(runId: string, pathExecutionId?: string): Promise<void>
  interruptRun?(runId: string, reason: 'reset'): Promise<void>
  cleanupPath?(runId: string, pathExecutionId: string): Promise<void>
  cleanupRun?(runId: string): Promise<void>
  resetReplayCursor?(): Promise<void>
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
  evaluate: <Arg, Result = unknown>(
    pageFunction: (arg: Arg) => Result,
    arg: Arg,
  ) => Promise<Result>
  waitForTimeout: (ms: number) => Promise<void>
  screenshot: (options: { path?: string; fullPage?: boolean; type?: 'png' | 'jpeg' }) => Promise<unknown>
  url: () => string
  title: () => Promise<string>
  mouse: {
    click: (x: number, y: number) => Promise<void>
    move: (x: number, y: number, options?: { steps?: number }) => Promise<void>
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
    addInitScript: (script: string) => Promise<void>
    on: (event: string, handler: (...args: unknown[]) => void) => void
  }
  page: BrowserPage
  network: NetworkRecord[]
}
