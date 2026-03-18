import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const resolvePort = (value: string | undefined, basePort: number, offset: number): number => {
  return parseInteger(value, basePort) + offset
}

const toLocalBaseUrl = (port: number): string => `http://localhost:${port}`

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
  const env = loadEnv(mode, process.cwd(), '')
  const portOffset = parseInteger(env.PORT_OFFSET ?? process.env.PORT_OFFSET, 0)
  const mainServerPort = resolvePort(env.VITE_MAIN_SERVER_PORT ?? process.env.VITE_MAIN_SERVER_PORT, 7070, portOffset)
  const apiBase = toLocalBaseUrl(mainServerPort)
  const port = resolvePort(env.VITE_PORT ?? process.env.VITE_PORT, 5173, portOffset)

  return {
    root: frontendRoot,
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
    ],
    server: {
      port,
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
    define: {
      __MAIN_SERVER_PORT__: JSON.stringify(mainServerPort),
    },
  }
})
