import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createLogger } from '../../../common/logger'

type DecisionScreenshotInput = {
  runId: string
  pathId: string
  stepOrder: number
  narrativeSummary: string
  iteration: number
  screenshotBase64: string
}

type FunctionResponsesScreenshotInput = {
  runId: string
  pathId: string
  stepOrder: number
  narrativeSummary: string
  iteration: number
  responses: Array<{
    name: string
    screenshotBase64?: string
  }>
}

const log = createLogger('operator-runtime-screenshot')

const pad4 = (value: number): string => value.toString().padStart(4, '0')
const DEFAULT_STEP_SUMMARY_MAX_LEN = 90

const timestampForDir = (date: Date): string => {
  const year = date.getFullYear().toString()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hour = date.getHours().toString().padStart(2, '0')
  const minute = date.getMinutes().toString().padStart(2, '0')
  const second = date.getSeconds().toString().padStart(2, '0')
  return `${year}${month}${day}_${hour}${minute}${second}`
}

const sanitizeSegment = (value: string, fallback: string, maxLen = 80): string => {
  const cleaned = value
    .normalize('NFKC')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()

  if (!cleaned) return fallback
  return cleaned.slice(0, maxLen)
}

const formatPathFolder = (pathId: string): string => {
  const match = pathId.match(/(\d+)$/)
  if (match) {
    return `path_${Number(match[1])}`
  }

  return sanitizeSegment(pathId, 'path', 40)
}

export class RuntimeScreenshotLogger {
  private readonly runtimeRoot: string
  private readonly stepSummaryMaxLen: number
  private readonly runRootByRunId = new Map<string, string>()
  private readonly stepDirByKey = new Map<string, string>()

  constructor(runtimeRoot = path.resolve(process.cwd(), process.env.OPERATOR_RUNTIME_SCREENSHOT_LOG_ROOT ?? 'logs/runtime')) {
    this.runtimeRoot = runtimeRoot
    this.stepSummaryMaxLen = Number(process.env.OPERATOR_RUNTIME_SCREENSHOT_STEP_SUMMARY_MAX_LEN ?? DEFAULT_STEP_SUMMARY_MAX_LEN)
  }

  private stepKey(runId: string, pathId: string, stepOrder: number): string {
    return `${runId}:${pathId}:${stepOrder}`
  }

  private ensureRunRoot(runId: string): string {
    const existing = this.runRootByRunId.get(runId)
    if (existing) return existing

    const runRoot = path.join(this.runtimeRoot, `${timestampForDir(new Date())}_${sanitizeSegment(runId, 'run')}`)
    this.runRootByRunId.set(runId, runRoot)
    return runRoot
  }

  private async ensureStepDir(runId: string, pathId: string, stepOrder: number, narrativeSummary: string): Promise<string> {
    const key = this.stepKey(runId, pathId, stepOrder)
    const existing = this.stepDirByKey.get(key)
    if (existing) return existing

    const runRoot = this.ensureRunRoot(runId)
    const pathFolder = formatPathFolder(pathId)
    const stepFolder = `${stepOrder}_${sanitizeSegment(narrativeSummary, 'step', this.stepSummaryMaxLen)}`
    const stepDir = path.join(runRoot, pathFolder, stepFolder)

    await fs.mkdir(stepDir, { recursive: true })
    this.stepDirByKey.set(key, stepDir)
    return stepDir
  }

  async saveDecisionInput(input: DecisionScreenshotInput): Promise<string | null> {
    try {
      const stepDir = await this.ensureStepDir(input.runId, input.pathId, input.stepOrder, input.narrativeSummary)
      const fileName = `iter_${pad4(input.iteration)}_action_0000_decision_input.png`
      const filePath = path.join(stepDir, fileName)
      await fs.writeFile(filePath, Buffer.from(input.screenshotBase64, 'base64'))
      return filePath
    } catch (error) {
      log.log('save decision screenshot failed', {
        runId: input.runId,
        pathId: input.pathId,
        stepOrder: input.stepOrder,
        iteration: input.iteration,
        error: error instanceof Error ? error.message : 'unknown error',
      })
      return null
    }
  }

  async saveFunctionResponses(input: FunctionResponsesScreenshotInput): Promise<void> {
    const stepDir = await this.ensureStepDir(input.runId, input.pathId, input.stepOrder, input.narrativeSummary)

    await Promise.all(
      input.responses.map(async (item, index) => {
        if (!item.screenshotBase64) return

        const actionIndex = index + 1
        const toolName = sanitizeSegment(item.name.toLowerCase(), 'tool', 32)
        const fileName = `iter_${pad4(input.iteration)}_action_${pad4(actionIndex)}_tool_${toolName}.png`
        const filePath = path.join(stepDir, fileName)

        try {
          await fs.writeFile(filePath, Buffer.from(item.screenshotBase64, 'base64'))
        } catch (error) {
          log.log('save tool screenshot failed', {
            runId: input.runId,
            pathId: input.pathId,
            stepOrder: input.stepOrder,
            iteration: input.iteration,
            actionIndex,
            toolName: item.name,
            error: error instanceof Error ? error.message : 'unknown error',
          })
        }
      }),
    )
  }

  cleanupRun(runId: string): void {
    this.runRootByRunId.delete(runId)

    const keys = Array.from(this.stepDirByKey.keys()).filter((key) => key.startsWith(`${runId}:`))
    keys.forEach((key) => this.stepDirByKey.delete(key))
  }
}
