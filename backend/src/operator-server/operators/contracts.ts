import type {
  ExecutionFailureCode,
  ExecutorContext,
  OperatorTerminationReason,
  OperatorTraceItem,
  PlannedTransitionStep,
  StepEvidence,
  StepNarrativeInstruction,
  StepValidationSpec,
  StepValidationResult,
} from '../type/operatorExecutionContracts'
import type {
  LoopAppendFunctionResponsesInput,
  LoopDecision,
  LoopDecisionInput,
  LoopFunctionCall,
  LoopFunctionResponse,
  OperatorLoopAgent,
} from '../type/operatorLoopContracts'

export type {
  LoopAppendFunctionResponsesInput,
  LoopDecision,
  LoopDecisionInput,
  LoopFunctionCall,
  LoopFunctionResponse,
  OperatorLoopAgent,
}

export interface BrowserOperatorRunResult {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
  validationResults: StepValidationResult[]
  trace: OperatorTraceItem[]
  evidence?: StepEvidence
}

export interface BrowserOperator {
  run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
    validations: StepValidationSpec[],
  ): Promise<BrowserOperatorRunResult>
  cleanupPath?(runId: string, pathId: string): Promise<void>
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
