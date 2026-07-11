// WKWebView Web Audio spike (dotbeat D1 de-risk, docs/research/13-tauri-shell.md).
//
// The whole point of this command: the webview can't be "listened to" by an agent, so the page
// writes verifiable evidence of success/failure to a plain log file on disk. This command is a
// custom app command (not a plugin command), so it isn't subject to the capabilities/ACL system
// that scopes plugin-invoked filesystem access — it just appends a line wherever it's told to.
use std::fs::OpenOptions;
use std::io::Write;

#[tauri::command]
fn log_spike_result(path: &str, line: &str) -> Result<(), String> {
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open failed: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![log_spike_result])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
