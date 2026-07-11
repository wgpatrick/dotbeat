// dotbeat desktop shell (D1) — Tauri wrap of the beatlab GUI.
//
// Startup sequence (see docs/phase-9-tauri-spike-plan.md for the full writeup):
//   1. Spawn `node cli/daemon.mjs <project.beat | project-folder> --port <DAEMON_PORT>` — the
//      daemon-as-sidecar (docs/research/13-tauri-shell.md finding 4). For tonight's scaffold
//      this runs the plain Node CLI as a child process rather than a compiled per-target-triple
//      `externalBin` binary — see the plan doc's "what's still missing" section for that gap.
//   2. Spawn beatlab's own `vite` dev server against a real beatlab checkout (the same
//      spawnBeatlabDevServer invocation `cli/render.mjs`/`cli/daemon.mjs` already use).
//   3. Poll both sidecars' ports until they accept TCP connections, then navigate the main
//      window at `http://localhost:<vite>/musiclearning/?daw=<daemon>` — the same `?daw=<port>`
//      bridge the existing browser-based daemon workflow already uses
//      (`src/state/dawBridge.ts` in beatlab).
//   4. A native "Open Project Folder" flow — reachable both from the splash page's button
//      (`pick_project_folder`, only visible before the first navigation) and from the native
//      File > Open Project Folder… menu item (works at any time, since it's outside the
//      webview) — opens `tauri-plugin-dialog`'s folder picker, then actually **kills and
//      respawns both sidecars against the chosen folder and re-navigates the window** (Phase 10
//      Stream A; this used to just report the folder back without doing anything, see
//      docs/phase-9-tauri-spike-plan.md's "what's still missing" section for the prior state).
//   5. The chosen folder is also granted to the `tauri-plugin-fs` scope and, via
//      `tauri-plugin-persisted-scope`, persisted to disk so it's re-granted automatically on the
//      next app launch (research 13 finding 5) — plus a small `last-project.json` in the app's
//      data dir so the *daemon* itself reopens that same folder next launch too, not just the
//      fs permission grant.
//
// Both child processes are killed when the app exits (see the `on_window_event` handler below).

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const DAEMON_PORT: u16 = 8420;
const VITE_PORT: u16 = 5173;

struct Sidecars {
    daemon: Option<CommandChild>,
    vite: Option<CommandChild>,
}

fn repo_root() -> PathBuf {
    if let Ok(p) = std::env::var("DOTBEAT_REPO_ROOT") {
        return PathBuf::from(p);
    }
    // Dev mode: cargo runs from desktop/src-tauri, so the dotbeat repo root is two levels up.
    std::env::current_dir()
        .expect("cwd")
        .join("../..")
        .canonicalize()
        .expect("repo root (set DOTBEAT_REPO_ROOT if this guess is wrong)")
}

fn beatlab_dir() -> PathBuf {
    if let Ok(p) = std::env::var("DOTBEAT_BEATLAB_DIR") {
        return PathBuf::from(p);
    }
    // Convention fallback: a sibling checkout next to the dotbeat repo. Overridable via env var
    // (the desktop/package.json `dev` script sets this explicitly — see its comment).
    repo_root().join("../beatlab")
}

// Where we remember the last folder opened via the picker, so it can be reopened automatically
// next launch (separate from, but complementary to, the tauri-plugin-fs *permission* scope
// persisted by tauri-plugin-persisted-scope — that plugin persists what the app is *allowed* to
// touch; this remembers what project it should actually open).
fn last_project_state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("last-project.json"))
}

fn read_last_project_folder(app: &tauri::AppHandle) -> Option<PathBuf> {
    let path = last_project_state_path(app)?;
    let text = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let folder = value.get("folder")?.as_str()?;
    let pb = PathBuf::from(folder);
    if pb.exists() {
        Some(pb)
    } else {
        log_line(&format!(
            "last project folder {} (from {}) no longer exists, ignoring",
            pb.display(),
            path.display()
        ));
        None
    }
}

fn write_last_project_folder(app: &tauri::AppHandle, folder: &Path) {
    let Some(path) = last_project_state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let value = serde_json::json!({ "folder": folder.to_string_lossy() });
    if let Err(err) = std::fs::write(&path, value.to_string()) {
        log_line(&format!("WARN: failed to write {}: {err}", path.display()));
    }
}

// The project target (a `.beat` file or a folder — `resolveProjectFile` on the daemon side
// accepts either) to open at app startup: an explicit env var wins (dev-mode override), then
// whatever folder was last opened via the picker (persists across restarts, see
// `write_last_project_folder`), then the bundled example as a last resort.
fn initial_project_target(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("DOTBEAT_PROJECT_FILE") {
        return PathBuf::from(p);
    }
    if let Some(folder) = read_last_project_folder(app) {
        log_line(&format!(
            "reopening last project folder from previous session: {}",
            folder.display()
        ));
        return folder;
    }
    repo_root().join("examples/real-groove.beat")
}

fn log_line(line: &str) {
    println!("[dotbeat] {line}");
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

// Tries every address "localhost" resolves to (127.0.0.1 AND ::1) — vite's default dev server
// binds IPv6 loopback only when no --host is given, which an IPv4-only check would miss forever.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    use std::net::ToSocketAddrs;
    let start = std::time::Instant::now();
    let mut attempts = 0u32;
    while start.elapsed() < timeout {
        attempts += 1;
        if let Ok(addrs) = ("localhost", port).to_socket_addrs() {
            for addr in addrs {
                if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
                    log_line(&format!("port {port} up after {attempts} attempt(s) (via {addr})"));
                    return true;
                }
            }
        }
        if attempts <= 3 || attempts % 10 == 0 {
            log_line(&format!("port {port} not up yet (attempt {attempts})"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    log_line(&format!("port {port} never came up after {attempts} attempt(s)"));
    false
}

// Kills whatever sidecars are currently tracked in state (if any). Called both on window close
// and right before spawning replacements when the user points the app at a new project folder.
fn kill_sidecars(handle: &tauri::AppHandle) {
    let state = handle.state::<Mutex<Sidecars>>();
    let mut guard = state.lock().unwrap();
    if let Some(child) = guard.daemon.take() {
        let _ = child.kill();
    }
    if let Some(child) = guard.vite.take() {
        let _ = child.kill();
    }
}

// Spawns the daemon (pointed at `project_target`, a `.beat` file or a project folder) and the
// beatlab vite dev server, waits for both ports, then navigates the main window to the
// daemon-bridged URL. Used both for the initial app startup and for re-pointing at a folder
// chosen later via `pick_project_folder` / the native File menu — any sidecars already tracked
// in state are killed first so a folder switch doesn't leave orphaned processes behind.
fn spawn_project(handle: &tauri::AppHandle, project_target: PathBuf) {
    let repo = repo_root();
    let beatlab = beatlab_dir();
    log_line(&format!("repo root: {}", repo.display()));
    log_line(&format!("beatlab dir: {}", beatlab.display()));
    log_line(&format!("project target: {}", project_target.display()));

    if !beatlab.join("package.json").exists() {
        log_line(&format!(
            "FATAL: no beatlab checkout at {} — set DOTBEAT_BEATLAB_DIR",
            beatlab.display()
        ));
        return;
    }

    kill_sidecars(handle);

    // 1. daemon sidecar: `node cli/daemon.mjs <project.beat | project-folder> --port 8420`
    let daemon_script = repo.join("cli/daemon.mjs");
    let (mut daemon_rx, daemon_child) = handle
        .shell()
        .command("node")
        .args([
            daemon_script.to_string_lossy().to_string(),
            project_target.to_string_lossy().to_string(),
            "--port".into(),
            DAEMON_PORT.to_string(),
        ])
        .current_dir(repo.clone())
        .spawn()
        .expect("failed to spawn beat daemon sidecar");
    log_line("daemon sidecar spawned");

    // 2. beatlab vite dev server sidecar. Restarted too (not just the daemon) so a folder switch
    // always leaves both sidecars in a known-fresh state — vite itself doesn't care which
    // project is open, but respawning it is cheap and avoids ever reasoning about a stale vite
    // process left over from a previous folder.
    //
    // Invoked as `node <beatlab>/node_modules/vite/bin/vite.js` rather than `npx vite` (which is
    // what cli/devserver.mjs uses) deliberately: npx execs through an intermediate `sh -c`
    // wrapper process (confirmed by inspecting the process tree during this stream's manual
    // verification — see docs/phase-9-tauri-spike-plan.md's Phase 10 Stream A section), so
    // `CommandChild::kill()` here — which, unlike Node's `child_process`, has no `detached` +
    // negative-PID group-kill equivalent exposed by tauri-plugin-shell — only reaches the `npx`
    // wrapper and leaves the actual vite dev server running and still bound to the port. On a
    // folder switch that meant the *new* vite instance found its port taken and silently moved
    // to the next one, while the window still navigated to the old, now-wrong, hardcoded port.
    // Calling vite's own entry script directly makes the spawned child the actual vite process,
    // so a single `kill()` reliably takes it down before the replacement binds the same port.
    let vite_bin = beatlab.join("node_modules/vite/bin/vite.js");
    if !vite_bin.exists() {
        log_line(&format!(
            "FATAL: no vite binary at {} — run `npm install` in the beatlab checkout",
            vite_bin.display()
        ));
        return;
    }
    let (mut vite_rx, vite_child) = handle
        .shell()
        .command("node")
        .args([
            vite_bin.to_string_lossy().to_string(),
            "--port".into(),
            VITE_PORT.to_string(),
        ])
        .current_dir(beatlab.clone())
        .spawn()
        .expect("failed to spawn beatlab vite dev server");
    log_line("vite sidecar spawned");

    {
        let state = handle.state::<Mutex<Sidecars>>();
        let mut guard = state.lock().unwrap();
        guard.daemon = Some(daemon_child);
        guard.vite = Some(vite_child);
    }

    // Drain child stdout/stderr on background tasks so the pipes never back up, and log it
    // plainly (this is what a developer watches during `tauri dev`).
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = daemon_rx.recv().await {
            if let CommandEvent::Stdout(line) | CommandEvent::Stderr(line) = event {
                log_line(&format!("[daemon] {}", String::from_utf8_lossy(&line)));
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = vite_rx.recv().await {
            if let CommandEvent::Stdout(line) | CommandEvent::Stderr(line) = event {
                log_line(&format!("[vite] {}", String::from_utf8_lossy(&line)));
            }
        }
    });

    // 3. Wait for both to come up, then (re-)navigate the window at the daemon-bridged URL —
    // this is what actually makes a folder switch visible: the window reloads against the new
    // daemon/vite pair instead of just reporting the picked path back to the page.
    let handle2 = handle.clone();
    std::thread::spawn(move || {
        log_line("poll thread started");
        let daemon_ok = wait_for_port(DAEMON_PORT, Duration::from_secs(15));
        let vite_ok = wait_for_port(VITE_PORT, Duration::from_secs(30));
        log_line(&format!("daemon up: {daemon_ok}, vite up: {vite_ok}"));
        if !daemon_ok || !vite_ok {
            log_line("FATAL: sidecar(s) never came up in time");
            return;
        }
        let url = format!("http://localhost:{VITE_PORT}/musiclearning/?daw={DAEMON_PORT}");
        log_line(&format!("navigating main window to {url}"));
        if let Some(window) = handle2.get_webview_window("main") {
            let _ = window.navigate(url.parse().expect("valid url"));
            let _ = handle2.emit("dotbeat://ready", url);
        }
    });
}

// Grants the chosen folder to the fs scope (persisted to disk across restarts by
// tauri-plugin-persisted-scope, research 13 finding 5), remembers it as the project to reopen
// next launch, and actually restarts the sidecars against it. This is the real "Open Folder"
// flow — `pick_project_folder` and the native File menu both funnel into this.
fn reopen_project_folder(app: &tauri::AppHandle, folder: PathBuf) {
    log_line(&format!("folder chosen: {}", folder.display()));
    let _ = app.emit("dotbeat://reopening", folder.to_string_lossy().to_string());

    if let Some(fs_scope) = app.try_fs_scope() {
        match fs_scope.allow_directory(&folder, true) {
            Ok(()) => log_line(&format!(
                "fs scope now allows {} (persisted-scope will save this to disk)",
                folder.display()
            )),
            Err(err) => log_line(&format!(
                "WARN: failed to allow fs scope for {}: {err}",
                folder.display()
            )),
        }
    } else {
        log_line("WARN: fs plugin scope unavailable, skipping persisted-scope grant");
    }

    write_last_project_folder(app, &folder);
    spawn_project(app, folder);
}

#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    if let Some(f) = &folder {
        reopen_project_folder(&app, PathBuf::from(f.to_string()));
    }
    folder.map(|f| f.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // fs must be registered before persisted-scope (which wraps its `Scope`) — see
        // tauri-plugin-persisted-scope's own setup warning if the order is wrong.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .manage(Mutex::new(Sidecars { daemon: None, vite: None }))
        .invoke_handler(tauri::generate_handler![pick_project_folder])
        .setup(|app| {
            let handle = app.handle().clone();

            // Prove the persisted-scope restoration actually happened (it runs during plugin
            // registration, i.e. before this closure) rather than just trusting the plugin: log
            // whatever paths are already allowed at this point. On a fresh install this is
            // empty; after picking a folder once and restarting, it should list that folder.
            if let Some(fs_scope) = handle.try_fs_scope() {
                let allowed: Vec<String> = fs_scope
                    .allowed_patterns()
                    .into_iter()
                    .map(|p| p.to_string())
                    .collect();
                log_line(&format!("fs scope on startup (restored by persisted-scope): {allowed:?}"));
            }

            // Native File menu — the only way to reopen a different project folder once the
            // window has already navigated away from the splash page (its button is gone at
            // that point, since it's replaced by beatlab's own page).
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
                let open_folder = MenuItemBuilder::with_id("open_folder", "Open Project Folder…")
                    .accelerator("CmdOrCtrl+O")
                    .build(app)?;
                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&open_folder)
                    .separator()
                    .item(&PredefinedMenuItem::close_window(app, None)?)
                    .item(&PredefinedMenuItem::quit(app, None)?)
                    .build()?;
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let menu = MenuBuilder::new(app).items(&[&file_menu, &edit_menu]).build()?;
                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    if event.id() == "open_folder" {
                        let handle = app_handle.clone();
                        std::thread::spawn(move || {
                            use tauri_plugin_dialog::DialogExt;
                            log_line("menu: Open Project Folder… selected");
                            match handle.dialog().file().blocking_pick_folder() {
                                Some(f) => reopen_project_folder(&handle, PathBuf::from(f.to_string())),
                                None => log_line("menu: Open Project Folder… cancelled"),
                            }
                        });
                    }
                });
            }

            let target = initial_project_target(&handle);
            spawn_project(&handle, target);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_sidecars(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
