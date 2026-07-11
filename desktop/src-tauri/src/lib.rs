// dotbeat desktop shell — Tauri wrap of `ui/`, dotbeat's own frontend (Phase 12 Stream 1, D12).
//
// Phase 13 Stream D rewrite: this used to wrap BeatLab's dev server (`?daw=<port>` bridge into a
// spawned `npx vite` sidecar against a sibling beatlab checkout) — that's gone. See
// docs/phase-9-tauri-spike-plan.md's Phase 13 Stream D section for the full story of the switch.
//
// Startup sequence now:
//   1. The *frontend* is no longer something this Rust code spawns or navigates to at all. Tauri
//      itself serves it:
//        - `tauri dev`: `build.devUrl` (ui's own `vite dev`, started via `beforeDevCommand`,
//          `ui/package.json`'s own `dev` script) — Tauri auto-loads the window at that URL.
//        - `tauri build` / a packaged app: `build.frontendDist` points at `ui/dist`, a real
//          `vite build` production bundle (built by `beforeBuildCommand`) that Tauri embeds and
//          serves via its own asset protocol — no dev server, no second Node-on-PATH dependency.
//      `ui/src/daemon/bridge.ts` already defaults to `http://localhost:8420` with no `?daw=`
//      query param needed (see `daemonBase()`), and the daemon always binds the fixed
//      `DAEMON_PORT` below, so the frontend finds it with zero URL-wiring from this file.
//   2. This file's only remaining job is the **daemon** sidecar (`beat daemon`,
//      docs/research/13-tauri-shell.md finding 4):
//        - debug builds (`cargo run` / `tauri dev`): spawn plain `node cli/daemon.mjs ...` —
//          fast iteration, no rebuild-the-binary step on every code change.
//        - release builds (`cargo build --release` / `tauri build`): spawn the real compiled
//          `dotbeat-daemon` sidecar binary via `Command.sidecar()` (`bundle.externalBin`,
//          built by `desktop/sidecar/build.mjs` — see that file for why a plain `pkg
//          cli/daemon.mjs` doesn't work and what the actual two-stage build is). No Node-on-PATH
//          dependency at all in this path — verified by running with `node`/`npx` stripped from
//          PATH, see the plan doc's verification section.
//   3. A native "Open Project Folder" flow (splash-page button pre-navigation is gone now that
//      there's no splash page — reachable via the native File > Open Project Folder… menu,
//      works at any time since it's outside the webview) opens `tauri-plugin-dialog`'s folder
//      picker, then kills and respawns the daemon against the chosen folder. Since the frontend's
//      URL is now fixed (no more `?daw=<port>` to renavigate to), a folder switch instead forces
//      a webview reload (`window.eval("window.location.reload()")`) so the SPA re-fetches
//      `GET /document` fresh against the new (same-port, different-project) daemon.
//   4. The chosen folder is also granted to the `tauri-plugin-fs` scope and, via
//      `tauri-plugin-persisted-scope`, persisted to disk so it's re-granted automatically on the
//      next app launch (research 13 finding 5) — plus a small `last-project.json` in the app's
//      data dir so the *daemon* itself reopens that same folder next launch too, not just the
//      fs permission grant. (Unchanged from Phase 10 Stream A.)
//
// The daemon sidecar is killed when the app exits (see the `on_window_event` handler below).

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const DAEMON_PORT: u16 = 8420;
const DAEMON_SIDECAR_NAME: &str = "dotbeat-daemon";

struct Sidecars {
    daemon: Option<CommandChild>,
}

fn repo_root() -> PathBuf {
    if let Ok(p) = std::env::var("DOTBEAT_REPO_ROOT") {
        return PathBuf::from(p);
    }
    // Dev mode: cargo runs from desktop/src-tauri, so the dotbeat repo root is two levels up.
    // Only used by the debug (plain `node cli/daemon.mjs`) path and by initial_project_target's
    // bundled-example fallback — the release sidecar path below doesn't need this at all, since
    // Command.sidecar() resolves the bundled binary itself.
    std::env::current_dir()
        .expect("cwd")
        .join("../..")
        .canonicalize()
        .expect("repo root (set DOTBEAT_REPO_ROOT if this guess is wrong)")
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
// `write_last_project_folder`), then the bundled example as a last resort. The bundled-example
// fallback assumes a repo checkout is reachable (see repo_root()'s doc comment) — fine for this
// stream's actual target (launching on the owner's own dev machine), not yet a general
// "works from a downloaded, repo-less .app" story; see the plan doc's "still missing" section.
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

// Tries every address "localhost" resolves to (127.0.0.1 AND ::1) — a lesson carried over from
// this file's original vite-polling code (vite bound IPv6-loopback-only by default); the daemon
// itself binds IPv4, but resolving both defensively costs nothing and matches what a browser/curl
// does implicitly.
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

// Kills whatever daemon sidecar is currently tracked in state (if any). Called both on window
// close and right before spawning a replacement when the user points the app at a new project
// folder.
fn kill_sidecars(handle: &tauri::AppHandle) {
    let state = handle.state::<Mutex<Sidecars>>();
    let mut guard = state.lock().unwrap();
    if let Some(child) = guard.daemon.take() {
        let _ = child.kill();
    }
}

// Spawns the daemon (pointed at `project_target`, a `.beat` file or a project folder), waits for
// its port, then reloads the webview so the already-loaded frontend re-pulls the (possibly new)
// document. Used both for the initial app startup and for re-pointing at a folder chosen later
// via the native File menu — any daemon already tracked in state is killed first so a folder
// switch doesn't leave an orphaned process behind.
//
// debug builds spawn plain `node cli/daemon.mjs` (fast iteration); release builds spawn the
// compiled `dotbeat-daemon` sidecar binary (`Command.sidecar()`, resolved via `bundle.externalBin`
// — no Node-on-PATH dependency). See desktop/sidecar/build.mjs for how that binary gets built.
fn spawn_project(handle: &tauri::AppHandle, project_target: PathBuf, reload_after: bool) {
    log_line(&format!("project target: {}", project_target.display()));

    kill_sidecars(handle);

    let daemon_child = if cfg!(debug_assertions) {
        let repo = repo_root();
        let daemon_script = repo.join("cli/daemon.mjs");
        log_line(&format!("repo root: {}", repo.display()));
        log_line("spawning daemon via plain `node cli/daemon.mjs` (debug build)");
        let (mut rx, child) = handle
            .shell()
            .command("node")
            .args([
                daemon_script.to_string_lossy().to_string(),
                project_target.to_string_lossy().to_string(),
                "--port".into(),
                DAEMON_PORT.to_string(),
            ])
            .current_dir(repo)
            .spawn()
            .expect("failed to spawn beat daemon (debug, plain node)");
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Stdout(line) | CommandEvent::Stderr(line) = event {
                    log_line(&format!("[daemon] {}", String::from_utf8_lossy(&line)));
                }
            }
        });
        child
    } else {
        log_line("spawning daemon via the compiled sidecar binary (release build)");
        let (mut rx, child) = handle
            .shell()
            .sidecar(DAEMON_SIDECAR_NAME)
            .expect("dotbeat-daemon sidecar not found — run desktop/sidecar/build.mjs before `tauri build`")
            .args([
                project_target.to_string_lossy().to_string(),
                "--port".into(),
                DAEMON_PORT.to_string(),
            ])
            .spawn()
            .expect("failed to spawn beat daemon sidecar");
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Stdout(line) | CommandEvent::Stderr(line) = event {
                    log_line(&format!("[daemon] {}", String::from_utf8_lossy(&line)));
                }
            }
        });
        child
    };
    log_line("daemon sidecar spawned");

    {
        let state = handle.state::<Mutex<Sidecars>>();
        let mut guard = state.lock().unwrap();
        guard.daemon = Some(daemon_child);
    }

    // Wait for the daemon's port, then (if this is a folder switch, not the initial boot) reload
    // the webview so the already-loaded frontend re-pulls GET /document against the new daemon.
    let handle2 = handle.clone();
    std::thread::spawn(move || {
        log_line("poll thread started");
        let daemon_ok = wait_for_port(DAEMON_PORT, Duration::from_secs(15));
        log_line(&format!("daemon up: {daemon_ok}"));
        if !daemon_ok {
            log_line("FATAL: daemon sidecar never came up in time");
            return;
        }
        if reload_after {
            if let Some(window) = handle2.get_webview_window("main") {
                log_line("reloading webview to pick up the new project");
                let _ = window.eval("window.location.reload()");
            }
        }
    });
}

// Grants the chosen folder to the fs scope (persisted to disk across restarts by
// tauri-plugin-persisted-scope, research 13 finding 5), remembers it as the project to reopen
// next launch, and actually restarts the daemon against it. This is the real "Open Folder"
// flow — the native File menu funnels into this.
fn reopen_project_folder(app: &tauri::AppHandle, folder: PathBuf) {
    log_line(&format!("folder chosen: {}", folder.display()));

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
    spawn_project(app, folder, true);
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
        .manage(Mutex::new(Sidecars { daemon: None }))
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

            // Native File menu — the only way to reopen a different project folder (there's no
            // splash page anymore now that the frontend is ui/, loaded directly at startup).
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
            spawn_project(&handle, target, false);

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
