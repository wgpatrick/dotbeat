import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { engine } from './audio/engine'
import './styles.css'

// Expose engine + store for the headless verification harness (scripts/verify-phase12.mjs), the
// same __store/__engine convention cli/render.mjs already relies on for BeatLab.
import { useStore } from './state/store'
import * as bridge from './daemon/bridge'
;(window as unknown as { __store: typeof useStore; __engine: typeof engine }).__store = useStore
;(window as unknown as { __store: typeof useStore; __engine: typeof engine }).__engine = engine
// The real GUI edit path (postEdit + friends) exposed for the verification harness, so a knob edit
// can be driven through the exact same code a control fires — not a raw daemon curl.
;(window as unknown as { __bridge: typeof bridge }).__bridge = bridge

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
