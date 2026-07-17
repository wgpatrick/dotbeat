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
// Offline renderer (renderer slice 2, cli/render.mjs --offline): compute-bound rendering through
// the same engine class, exposed for the headless harness alongside __engine.
import { renderOfflineWav, offlineRefusalReason } from './audio/offline'
;(window as unknown as { __renderOffline: typeof renderOfflineWav; __offlineRefusalReason: typeof offlineRefusalReason }).__renderOffline = renderOfflineWav
;(window as unknown as { __renderOffline: typeof renderOfflineWav; __offlineRefusalReason: typeof offlineRefusalReason }).__offlineRefusalReason = offlineRefusalReason

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
