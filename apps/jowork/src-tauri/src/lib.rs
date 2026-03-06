use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::Manager;

static SIDECAR_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

const GATEWAY_PORT: u16 = 18800;

/// 云端 SaaS 默认地址（Mac mini :20800 via Cloudflare Tunnel → jowork.work）
const DEFAULT_GATEWAY_URL: &str = "https://jowork.work";

// ── 配置持久化 ──────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct AppConfig {
  mode: String, // "saas" | "self_hosted"
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
  app.path().app_data_dir().ok().map(|d| d.join("config.json"))
}

fn read_mode(app: &tauri::AppHandle) -> String {
  config_path(app)
    .and_then(|p| fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
    .map(|c| c.mode)
    .filter(|m| m == "self_hosted")
    .unwrap_or_else(|| "saas".to_string())
}

fn write_mode(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
  let path = config_path(app).ok_or("Cannot determine app data dir")?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let content =
    serde_json::to_string(&AppConfig { mode: mode.to_string() }).map_err(|e| e.to_string())?;
  fs::write(&path, content).map_err(|e| e.to_string())
}

// ── Sidecar（仅 self_hosted 模式使用）──────────────────

fn sidecar_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
  let mut out = Vec::new();

  // 1. 优先：与主二进制同目录（Contents/MacOS/）
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      out.push(exe_dir.join("jowork-gateway"));
    }
  }

  // 2. Resource 目录（Contents/Resources/）
  if let Ok(resource_dir) = app.path().resource_dir() {
    out.push(resource_dir.join("sidecar").join("jowork-gateway"));
    out.push(resource_dir.join("jowork-gateway"));
  }

  // 3. 开发时相对路径 fallback
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

/// 等待本地 gateway 健康检查通过（最多 10 秒）
fn wait_for_gateway() {
  let url = format!("http://127.0.0.1:{}/health", GATEWAY_PORT);
  for _ in 0..20 {
    if let Ok(resp) = ureq::get(&url).call() {
      if resp.status() == 200 {
        return;
      }
    }
    thread::sleep(Duration::from_millis(500));
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

// ── 导航辅助 ─────────────────────────────────────────

fn navigate(app: &tauri::AppHandle, url: &str) {
  if let Some(window) = app.get_webview_window("main") {
    let js = format!("location.href = '{}'", url);
    let _ = window.eval(&js);
  }
}

// ── Tauri 命令（供前端调用）─────────────────────────

/// 获取当前模式："saas" | "self_hosted"
#[tauri::command]
fn get_app_mode(app: tauri::AppHandle) -> String {
  read_mode(&app)
}

/// 设置模式，重启后生效
#[tauri::command]
fn set_app_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
  if mode != "saas" && mode != "self_hosted" {
    return Err(format!("Invalid mode: {}", mode));
  }
  write_mode(&app, &mode)
}

/// 返回编译时内置的 SaaS 默认地址
#[tauri::command]
fn get_default_gateway_url() -> &'static str {
  DEFAULT_GATEWAY_URL
}

// ── App 入口 ─────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      let handle = app.handle().clone();
      thread::spawn(move || {
        let mode = read_mode(&handle);

        if mode == "self_hosted" {
          // Self-hosted：拉起本地 sidecar，等就绪后交给 setup.html 做路由
          launch_sidecar(&handle);
          wait_for_gateway();
          navigate(
            &handle,
            &format!("http://127.0.0.1:{}/setup.html", GATEWAY_PORT),
          );
        } else {
          // SaaS：让 loading.html 短暂显示后直接导航到云端服务器
          thread::sleep(Duration::from_millis(400));
          navigate(&handle, DEFAULT_GATEWAY_URL);
        }
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_app_mode,
      set_app_mode,
      get_default_gateway_url
    ])
    .on_window_event(|_window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        stop_sidecar();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running jowork tauri app");
}
