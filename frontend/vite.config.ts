import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端 dev server 透過 proxy 連到 Go 後端（:8090）的 WebSocket 與 REST API，
// 正式版由後端直接 serve 打包後的 dist/，因此同源、無需 proxy。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/ws': { target: 'ws://localhost:8090', ws: true },
      '/api': { target: 'http://localhost:8090', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
})
