import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_AGENT_API_BASE || 'http://localhost:7070'

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
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
  }
})
