// dotbeat desktop splash: shown while the Rust setup() hook spins up the daemon + beatlab vite
// sidecars (see src-tauri/src/lib.rs). Once both are up, the Rust side navigates this whole
// window away to the real beatlab GUI (?daw=<port> bridge), so most of this page's lifetime is
// just the loading splash.
//
// The "Open Project Folder" button here only exists for that brief splash window (before the
// first navigation) — picking a folder actually kills and respawns both sidecars against it and
// re-navigates (see `pick_project_folder`/`reopen_project_folder` in src-tauri/src/lib.rs, Phase
// 10 Stream A). Once the window has navigated to beatlab's own page, this button is gone with
// it; the native File > Open Project Folder… menu item (also wired in lib.rs) is the only way to
// switch projects after that point, since it lives outside the webview.

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const statusEl = document.getElementById('status')
const chosenEl = document.getElementById('chosen')

listen('dotbeat://ready', (event) => {
  statusEl.textContent = `ready — navigating to ${event.payload}`
})

listen('dotbeat://reopening', (event) => {
  chosenEl.textContent = `reopening: ${event.payload}`
})

document.getElementById('open-folder').addEventListener('click', async () => {
  const folder = await invoke('pick_project_folder')
  chosenEl.textContent = folder ? `chosen: ${folder}` : '(cancelled)'
})
