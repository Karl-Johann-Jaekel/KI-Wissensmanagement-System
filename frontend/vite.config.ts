/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend talks to the backend via VITE_API_BASE (default http://localhost:8000);
// the browser runs on the host, so localhost:8000 works for both local and compose runs.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Die Graph-Engine (react-force-graph + d3) und der Markdown-Renderer
        // machen den Großteil des Bündels aus, werden aber nur auf je einer
        // Seite gebraucht. Als eigene Chunks lädt sie, wer sie braucht — und
        // sie bleiben über Deploys hinweg im Browser-Cache, weil sie sich
        // seltener ändern als der Anwendungscode.
        manualChunks: {
          graph: ['react-force-graph-2d'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
