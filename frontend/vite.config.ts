import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend talks to the backend via VITE_API_BASE (default http://localhost:8000);
// the browser runs on the host, so localhost:8000 works for both local and compose runs.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
})
