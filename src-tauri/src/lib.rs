use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static SIDECAR_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn sidecar_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
  let mut files = vec![
    format!("jowork-gateway-{}", std::env::consts::ARCH.to_string() + "-" + std::env::consts::OS),
    "jowork-gateway".to_string(),
  ];
  // tauri build 通常会按 rust target triple 命名 externalBin 文件
  if let Ok(target) = std::env::var("TARGET") {
    files.insert(0, format!("jowork-gateway-{target}"));
  }

  let mut out = Vec::new();
  if let Ok(resource_dir) = app.path().resource_dir() {
    for f in &files {
      out.push(resource_dir.join("sidecar").join(f));
      out.push(resource_dir.join(f));
    }
  }
  out.push(PathBuf::from("apps/jowork/src-tauri/sidecar/jowork-gateway"));
  out
}

fn launch_sidecar(app: &tauri::AppHandle) {
  let already_started = SIDECAR_CHILD
    .get_or_init(|| Mutex::new(None))
    .lock()
    .ok()
    .and_then(|g| g.as_ref().map(|_| true))
    .unwrap_or(false);
  if already_started {
    return;
  }

  for candidate in sidecar_candidates(app) {
    if !candidate.exists() {
      continue;
    }
    if let Ok(child) = Command::new(&candidate).spawn() {
      if let Ok(mut guard) = SIDECAR_CHILD.get_or_init(|| Mutex::new(None)).lock() {
        *guard = Some(child);
      }
      return;
    }
  }
}

fn stop_sidecar() {
  if let Ok(mut guard) = SIDECAR_CHILD.get_or_init(|| Mutex::new(None)).lock() {
    if let Some(child) = guard.as_mut() {
      let _ = child.kill();
    }
    *guard = None;
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      launch_sidecar(app.handle());
      Ok(())
    })
    .on_window_event(|_window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        stop_sidecar();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running jowork tauri app");
}
