// dotbeat desktop splash: shown while the Rust setup() hook spins up the daemon + beatlab vite
// sidecars (see src-tauri/src/lib.rs). Once both are up, the Rust side navigates this whole
// window away to the real beatlab GUI (?daw=<port> bridge), so most of this page's lifetime is
// just the loading splash. The "Open Project Folder" button demonstrates the native dialog
// plugin end to end; re-pointing a running daemon at a newly chosen folder is follow-up work
// (see docs/phase-9-tauri-spike-plan.md).

const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const statusEl = document.getElementById('status')
const chosenEl = document.getElementById('chosen')

listen('dotbeat://ready', (event) => {
  statusEl.textContent = `ready — navigating to ${event.payload}`
})

document.getElementById('open-folder').addEventListener('click', async () => {
  const folder = await invoke('pick_project_folder')
  chosenEl.textContent = folder ? `chosen: ${folder}` : '(cancelled)'
})
