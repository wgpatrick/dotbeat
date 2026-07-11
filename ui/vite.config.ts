import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A plain Vite dev setup for now — the Tauri shell wiring is a later stream (research 15 §Recommendation).
export default defineConfig({
  plugins: [react()],
  server: { port: 5300, strictPort: false },
})
