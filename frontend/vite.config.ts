import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:18000',
        changeOrigin: true,
      },
      '/ws-collab': {
        target: 'ws://localhost:11234',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws-collab/, ''),
      },
    },
  },
})
