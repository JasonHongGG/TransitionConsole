import { useRef, type ChangeEvent } from 'react'
import type { TemporaryRunnerSettings } from '../hooks/usePlannedRunner'

interface TemporaryRunnerSettingsButtonsProps {
  getSettings: () => TemporaryRunnerSettings
  applySettings: (settings: TemporaryRunnerSettings) => void
}

type TemporaryRunnerSettingsFile = {
  type: 'temporary-runner-settings'
  version: 1
  savedAt: string
  settings: TemporaryRunnerSettings
}

const normalizeSettings = (input: unknown): TemporaryRunnerSettings | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<TemporaryRunnerSettings>
  const targetUrl = typeof candidate.targetUrl === 'string' ? candidate.targetUrl : ''
  const testingNotes = typeof candidate.testingNotes === 'string' ? candidate.testingNotes : ''
  const testAccounts = Array.isArray(candidate.testAccounts)
    ? candidate.testAccounts.map((item) => {
        const account = item as Record<string, unknown>
        return {
          role: typeof account.role === 'string' ? account.role : '',
          username: typeof account.username === 'string' ? account.username : '',
          password: typeof account.password === 'string' ? account.password : '',
          description: typeof account.description === 'string' ? account.description : '',
        }
      })
    : []

  return { targetUrl, testingNotes, testAccounts }
}

const parseSettingsFile = (input: unknown): TemporaryRunnerSettings | null => {
  if (!input || typeof input !== 'object') return null

  const record = input as Partial<TemporaryRunnerSettingsFile> & { settings?: unknown }
  if (record.type === 'temporary-runner-settings' && record.version === 1) {
    return normalizeSettings(record.settings)
  }

  return normalizeSettings(input)
}

export const TemporaryRunnerSettingsButtons = ({ getSettings, applySettings }: TemporaryRunnerSettingsButtonsProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleExport = () => {
    const payload: TemporaryRunnerSettingsFile = {
      type: 'temporary-runner-settings',
      version: 1,
      savedAt: new Date().toISOString(),
      settings: getSettings(),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'temporary-runner-settings.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const settings = parseSettingsFile(parsed)

      if (!settings) {
        window.alert('Invalid settings file format.')
        return
      }

      applySettings(settings)
    } catch {
      window.alert('Failed to import settings. Please check JSON format.')
    }
  }

  return (
    <>
    <button
        type="button"
        className="header-button"
        onClick={() => fileInputRef.current?.click()}
        title="匯入暫時設定"
        aria-label="匯入暫時設定"
    >
        設定匯入
      </button>
      <button type="button" className="header-button" onClick={handleExport} title="匯出暫時設定" aria-label="匯出暫時設定">
        設定匯出
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </>
  )
}
