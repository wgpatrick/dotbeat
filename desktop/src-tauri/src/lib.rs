// dotbeat desktop shell (D1) — Tauri wrap of the beatlab GUI.
//
// Startup sequence (see docs/phase-9-tauri-spike-plan.md for the full writeup):
//   1. Spawn `node cli/daemon.mjs <project.beat> --port <DAEMON_PORT>` — the daemon-as-sidecar
//      (docs/research/13-tauri-shell.md finding 4). For tonight's scaffold this runs the plain
//      Node CLI as a child process rather than a compiled per-target-triple `externalBin`
//      binary — see the plan doc's "what's still missing" section for that gap.
//   2. Spawn beatlab's own `vite` dev server against a real beatlab checkout (the same
//      spawnBeatlabDevServer invocation `cli/render.mjs`/`cli/daemon.mjs` already use).
//   3. Poll the vite dev server's port until it accepts TCP connections, then navigate the
//      main window at `http://localhost:<vite>/musiclearning/?daw=<daemon>` — the same
//      `?daw=<port>` bridge the existing browser-based daemon workflow already uses
//      (`src/state/dawBridge.ts` in beatlab).
//   4. A native "Open Project Folder" dialog (tauri-plugin-dialog) is exposed as a command;
//      for tonight it reports the chosen folder back to the page (re-pointing the daemon at a
//      newly chosen folder without an app restart is follow-up work, see the plan doc).
//
// Both child processes are killed when the app exits (see the `on_window_event` handler below).

use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
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

fn project_file() -> PathBuf {
    if let Ok(p) = std::env::var("DOTBEAT_PROJECT_FILE") {
        return PathBuf::from(p);
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

#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    folder.map(|f| f.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Sidecars { daemon: None, vite: None }))
        .invoke_handler(tauri::generate_handler![pick_project_folder])
        .setup(|app| {
            let handle = app.handle().clone();
            let repo = repo_root();
            let beatlab = beatlab_dir();
            let project = project_file();
            log_line(&format!("repo root: {}", repo.display()));
            log_line(&format!("beatlab dir: {}", beatlab.display()));
            log_line(&format!("project file: {}", project.display()));

            if !beatlab.join("package.json").exists() {
                log_line(&format!(
                    "FATAL: no beatlab checkout at {} — set DOTBEAT_BEATLAB_DIR",
                    beatlab.display()
                ));
                return Ok(());
            }

            // 1. daemon sidecar: `node cli/daemon.mjs <project.beat> --port 8420`
            let daemon_script = repo.join("cli/daemon.mjs");
            let (mut daemon_rx, daemon_child) = handle
                .shell()
                .command("node")
                .args([
                    daemon_script.to_string_lossy().to_string(),
                    project.to_string_lossy().to_string(),
                    "--port".into(),
                    DAEMON_PORT.to_string(),
                ])
                .current_dir(repo.clone())
                .spawn()
                .expect("failed to spawn beat daemon sidecar");
            log_line("daemon sidecar spawned");

            // 2. beatlab vite dev server sidecar (same invocation as cli/devserver.mjs).
            let (mut vite_rx, vite_child) = handle
                .shell()
                .command("npx")
                .args(["vite", "--port", &VITE_PORT.to_string()])
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

            // Drain child stdout/stderr on background tasks so the pipes never back up, and log
            // it plainly (this is what a developer watches during `tauri dev`).
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

            // 3. Wait for both to come up, then navigate the window at the daemon-bridged URL.
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

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<Mutex<Sidecars>>();
                let mut guard = state.lock().unwrap();
                if let Some(child) = guard.daemon.take() {
                    let _ = child.kill();
                }
                if let Some(child) = guard.vite.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
