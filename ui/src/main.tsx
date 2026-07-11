import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { engine } from './audio/engine'
import './styles.css'

// Expose engine + store for the headless verification harness (scripts/verify-phase12.mjs), the
// same __store/__engine convention cli/render.mjs already relies on for BeatLab.
import { useStore } from './state/store'
;(window as unknown as { __store: typeof useStore; __engine: typeof engine }).__store = useStore
;(window as unknown as { __store: typeof useStore; __engine: typeof engine }).__engine = engine

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
