import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When running inside Docker, proxy targets are injected via environment variables.
// Falls back to localhost ports for local (non-Docker) development.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:18000'
const collabTarget = process.env.VITE_COLLAB_TARGET || 'ws://localhost:11234'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // bind to all interfaces so the container is reachable
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws-collab': {
        target: collabTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws-collab/, ''),
      },
    },
  },
})
