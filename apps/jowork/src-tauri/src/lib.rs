// Jowork Desktop — Tauri 2 application
// Personal mode: launches Gateway sidecar, WebView connects to localhost

use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

/// Start the jowork-gateway sidecar and wait for "Gateway ready" signal.
fn start_gateway(app: &tauri::AppHandle) {
    let sidecar = app
        .shell()
        .sidecar("binaries/jowork-gateway")
        .expect("failed to locate jowork-gateway sidecar binary")
        .args(["--port", "18800"]);

    let (mut rx, _child) = sidecar.spawn().expect("failed to spawn jowork-gateway");

    // Watch stdout for "Gateway ready" signal
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if text.contains("Gateway ready") {
                        println!("[jowork] Gateway started: {}", text.trim());
                        break;
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[jowork-gateway] {}", text.trim());
                }
                CommandEvent::Error(err) => {
                    eprintln!("[jowork] Gateway error: {}", err);
                    break;
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[jowork] Gateway terminated: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            start_gateway(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
