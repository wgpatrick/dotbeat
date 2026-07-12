// Bridge to the Tauri desktop shell's project/folder commands (Phase 20 Stream W).
//
// Folder/project switching is Tauri-owned by design (Phases 10/13): the `beat daemon` this UI talks
// to owns exactly ONE .beat file and cannot re-point itself — switching projects means the desktop
// shell kills the daemon and respawns it against the chosen folder, then reloads the webview
// (desktop/src-tauri/src/lib.rs: `reopen_project_folder` / `spawn_project`). The shell already
// exposes the native folder picker as an invokable command, `pick_project_folder`, and the app is
// built with `withGlobalTauri: true`, so the web layer can reach it via `window.__TAURI__`.
//
// When the UI runs in a plain browser (e.g. the `ui/verify*.mjs` headless-Chromium harness, or
// `vite dev`) there is no Tauri runtime, so `isTauri()` is false and these are inert. That is the
// honest boundary: the button is real and works in the packaged desktop app, but cannot be exercised
// by the browser-only verify harness — see docs/phase-20-track-project-management.md.

interface TauriGlobal {
  core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

function tauri(): TauriGlobal | undefined {
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
}

/** True only inside the Tauri desktop shell (where the folder picker / daemon re-point exist). */
export function isTauri(): boolean {
  return !!tauri()?.core?.invoke
}

/** Open the native folder picker and re-point the daemon at the chosen project folder. Resolves to
 * the chosen path (or null if the user cancelled). Reuses the shell's existing `pick_project_folder`
 * command — no new Rust. No-ops (returns null) outside Tauri. */
export async function openProjectFolder(): Promise<string | null> {
  const invoke = tauri()?.core?.invoke
  if (!invoke) return null
  const chosen = (await invoke('pick_project_folder')) as string | null
  return chosen ?? null
}
