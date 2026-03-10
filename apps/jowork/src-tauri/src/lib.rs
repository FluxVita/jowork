use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::window::Color;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

static SIDECAR_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

const GATEWAY_PORT: u16 = 18800;
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
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      out.push(exe_dir.join("jowork-gateway"));
    }
  }
  if let Ok(resource_dir) = app.path().resource_dir() {
    out.push(resource_dir.join("sidecar").join("jowork-gateway"));
    out.push(resource_dir.join("jowork-gateway"));
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

// ── macOS 菜单栏 ──────────────────────────────────────

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
  // ① Jowork 应用菜单
  let about    = MenuItemBuilder::with_id("app_about", "关于 Jowork").build(app)?;
  let sep      = PredefinedMenuItem::separator(app)?;
  let quit     = PredefinedMenuItem::quit(app, Some("退出 Jowork"))?;
  let app_menu = SubmenuBuilder::new(app, "Jowork")
    .item(&about).item(&sep).item(&quit).build()?;

  // ② 文件
  let close    = PredefinedMenuItem::close_window(app, Some("关闭窗口"))?;
  let file_menu = SubmenuBuilder::new(app, "文件").item(&close).build()?;

  // ③ 编辑（全部使用系统 PredefinedMenuItem，快捷键自动注册）
  let edit_menu = SubmenuBuilder::new(app, "编辑")
    .item(&PredefinedMenuItem::undo(app, Some("撤销"))?)
    .item(&PredefinedMenuItem::redo(app, Some("重做"))?)
    .separator()
    .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
    .item(&PredefinedMenuItem::copy(app, Some("复制"))?)
    .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
    .separator()
    .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
    .build()?;

  // ④ 视图
  let sidebar  = MenuItemBuilder::with_id("view_sidebar", "切换侧边栏")
    .accelerator("CmdOrCtrl+\\").build(app)?;
  let fullscr  = PredefinedMenuItem::fullscreen(app, Some("全屏"))?;
  let view_menu = SubmenuBuilder::new(app, "视图")
    .item(&sidebar).separator().item(&fullscr).build()?;

  // ⑤ 窗口
  let minimize   = PredefinedMenuItem::minimize(app, Some("最小化"))?;
  let zoom       = PredefinedMenuItem::maximize(app, Some("缩放"))?;
  let win_menu = SubmenuBuilder::new(app, "窗口")
    .item(&minimize).item(&zoom).build()?;

  MenuBuilder::new(app)
    .item(&app_menu)
    .item(&file_menu)
    .item(&edit_menu)
    .item(&view_menu)
    .item(&win_menu)
    .build()
}

// ── 右键菜单 ─────────────────────────────────────────

struct ContextState(Mutex<Option<serde_json::Value>>);

#[tauri::command]
fn show_context_menu(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  context_type: String,
  data: Option<serde_json::Value>,
  state: tauri::State<'_, ContextState>,
) -> Result<(), String> {
  *state.0.lock().unwrap() = data;

  let menu = (|| -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    Ok(match context_type.as_str() {
      "file_item" => {
        let open      = MenuItemBuilder::with_id("file_open", "打开").build(&app)?;
        let reveal    = MenuItemBuilder::with_id("reveal_finder", "在 Finder 中显示").build(&app)?;
        let sep       = PredefinedMenuItem::separator(&app)?;
        let copy_path = MenuItemBuilder::with_id("copy_path", "复制路径").build(&app)?;
        MenuBuilder::new(&app).item(&open).item(&sep).item(&reveal).item(&copy_path).build()?
      }
      "file_dir" => {
        let reveal    = MenuItemBuilder::with_id("reveal_finder", "在 Finder 中显示").build(&app)?;
        let copy_path = MenuItemBuilder::with_id("copy_path", "复制路径").build(&app)?;
        MenuBuilder::new(&app).item(&reveal).item(&copy_path).build()?
      }
      "message" => {
        let copy_msg = MenuItemBuilder::with_id("copy_msg", "复制消息").build(&app)?;
        MenuBuilder::new(&app).item(&copy_msg).build()?
      }
      "editable" => {
        let cut        = PredefinedMenuItem::cut(&app, Some("剪切"))?;
        let copy       = PredefinedMenuItem::copy(&app, Some("复制"))?;
        let paste      = PredefinedMenuItem::paste(&app, Some("粘贴"))?;
        let sep        = PredefinedMenuItem::separator(&app)?;
        let select_all = PredefinedMenuItem::select_all(&app, Some("全选"))?;
        MenuBuilder::new(&app).item(&cut).item(&copy).item(&paste).item(&sep).item(&select_all).build()?
      }
      "selection" => {
        let copy_sel = MenuItemBuilder::with_id("copy_sel", "复制").build(&app)?;
        MenuBuilder::new(&app).item(&copy_sel).build()?
      }
      _ => return Err(tauri::Error::FailedToReceiveMessage),
    })
  })();

  match menu {
    Ok(m) => window.popup_menu(&m).map_err(|e| e.to_string()),
    Err(_) => Ok(()),
  }
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
  Command::new("open").arg("-R").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ── 导航辅助 ─────────────────────────────────────────

fn navigate(app: &tauri::AppHandle, url: &str) {
  if let Some(window) = app.get_webview_window("main") {
    let js = format!("location.href = '{}'", url);
    let _ = window.eval(&js);
  }
}

// ── Tauri 命令 ─────────────────────────────────────────

#[tauri::command]
fn get_app_mode(app: tauri::AppHandle) -> String {
  read_mode(&app)
}

#[tauri::command]
fn set_app_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
  if mode != "saas" && mode != "self_hosted" {
    return Err(format!("Invalid mode: {}", mode));
  }
  write_mode(&app, &mode)
}

#[tauri::command]
fn get_default_gateway_url() -> &'static str {
  DEFAULT_GATEWAY_URL
}

/// 告知前端是否启用了 NSVisualEffectView（决定侧边栏是否透明）
#[tauri::command]
fn is_vibrancy_active(app: tauri::AppHandle) -> bool {
  #[cfg(target_os = "macos")]
  { read_mode(&app) == "self_hosted" }
  #[cfg(not(target_os = "macos"))]
  { false }
}

// ── Claude Code Local ────────────────────────────────

struct ClaudeCodeManager {
  active_child: Mutex<Option<Child>>,
  has_conversation: Arc<AtomicBool>,
}

impl ClaudeCodeManager {
  fn new() -> Self {
    Self {
      active_child: Mutex::new(None),
      has_conversation: Arc::new(AtomicBool::new(false)),
    }
  }
}

/// 查找 claude CLI 的真实路径
fn find_claude_binary() -> Option<PathBuf> {
  // 优先检查常见安装路径
  let home = std::env::var("HOME").unwrap_or_default();
  let candidates = [
    format!("{}/.local/bin/claude", home),
    format!("{}/.npm-global/bin/claude", home),
    "/usr/local/bin/claude".to_string(),
    "/opt/homebrew/bin/claude".to_string(),
  ];
  for c in &candidates {
    let p = PathBuf::from(c);
    if p.exists() {
      // 解析 symlink 到真实路径
      return Some(fs::canonicalize(&p).unwrap_or(p));
    }
  }
  // fallback: which claude
  Command::new("which")
    .arg("claude")
    .output()
    .ok()
    .and_then(|o| {
      if o.status.success() {
        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !s.is_empty() {
          let p = PathBuf::from(&s);
          return Some(fs::canonicalize(&p).unwrap_or(p));
        }
      }
      None
    })
}

#[tauri::command]
fn claude_code_check() -> serde_json::Value {
  match find_claude_binary() {
    Some(path) => {
      let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
      serde_json::json!({
        "installed": true,
        "version": version,
        "path": path.to_string_lossy()
      })
    }
    None => serde_json::json!({
      "installed": false,
      "version": "",
      "path": ""
    }),
  }
}

#[tauri::command]
fn claude_code_query(
  app: tauri::AppHandle,
  manager: tauri::State<'_, ClaudeCodeManager>,
  prompt: String,
  cwd: Option<String>,
) -> Result<(), String> {
  // Kill previous process if any
  {
    let mut guard = manager.active_child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
      let _ = child.kill();
      let _ = child.wait();
    }
    *guard = None;
  }

  let claude_bin = find_claude_binary().ok_or("Claude CLI not found")?;

  let mut args = vec![
    "-p".to_string(),
    "--output-format".to_string(),
    "stream-json".to_string(),
    "--verbose".to_string(),
  ];

  if manager.has_conversation.load(Ordering::SeqCst) {
    args.push("--continue".to_string());
  }

  args.push(prompt);

  let working_dir = cwd.unwrap_or_else(|| {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
  });

  let mut child = Command::new(&claude_bin)
    .args(&args)
    .current_dir(&working_dir)
    .env_remove("CLAUDECODE")
    .env_remove("CLAUDE_CODE_ENTRYPOINT")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn claude: {}", e))?;

  let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
  let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

  // Store child for kill support
  {
    let mut guard = manager.active_child.lock().unwrap();
    *guard = Some(child);
  }

  // Background thread: read stdout line by line → emit events
  let app_clone = app.clone();
  let has_conv = manager.has_conversation.clone();
  thread::spawn(move || {
    let reader = std::io::BufReader::new(stdout);
    for line in reader.lines() {
      match line {
        Ok(l) if !l.is_empty() => {
          if let Ok(json) = serde_json::from_str::<serde_json::Value>(&l) {
            let _ = app_clone.emit("claude_code_event", &json);
          }
        }
        Err(_) => break,
        _ => {}
      }
    }
    // Process ended — mark conversation as active for --continue
    has_conv.store(true, Ordering::SeqCst);
    let _ = app_clone.emit("claude_code_done", serde_json::json!({}));
  });

  // Background thread: read stderr → emit errors
  let app_err = app.clone();
  thread::spawn(move || {
    let reader = std::io::BufReader::new(stderr);
    let mut err_text = String::new();
    for line in reader.lines() {
      if let Ok(l) = line {
        if !l.is_empty() {
          err_text.push_str(&l);
          err_text.push('\n');
        }
      }
    }
    if !err_text.is_empty() {
      let _ = app_err.emit("claude_code_error", serde_json::json!({ "error": err_text.trim() }));
    }
  });

  Ok(())
}

#[tauri::command]
fn claude_code_stop(manager: tauri::State<'_, ClaudeCodeManager>) -> Result<(), String> {
  let mut guard = manager.active_child.lock().unwrap();
  if let Some(child) = guard.as_mut() {
    let _ = child.kill();
    let _ = child.wait();
  }
  *guard = None;
  Ok(())
}

#[tauri::command]
fn claude_code_new_conversation(manager: tauri::State<'_, ClaudeCodeManager>) {
  manager.has_conversation.store(false, Ordering::SeqCst);
}

// ── App 入口 ─────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .manage(ContextState(Mutex::new(None)))
    .manage(ClaudeCodeManager::new())
    // ── 菜单事件：分发右键菜单 action + 应用菜单快捷键 ──
    .on_menu_event(|app, event| {
      let id = event.id().0.as_str();

      // 应用菜单栏事件
      match id {
        "view_sidebar" => {
          if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("menu-action", "toggle_sidebar");
          }
        }
        "app_about" => {
          // 简单弹出关于信息（后续可改为自定义 About 窗口）
          if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("menu-action", "show_about");
          }
        }
        // 右键菜单事件
        _ => {
          let data = app.state::<ContextState>().0.lock().unwrap().clone();
          if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("context-menu-action", serde_json::json!({
              "action": id,
              "data": data,
            }));
          }
        }
      }
    })
    .setup(|app| {
      // ── 创建主窗口（根据模式决定是否启用透明 + vibrancy）──
      let mode = read_mode(app.handle());
      let is_self_hosted = mode == "self_hosted";

      let mut builder = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::App("loading.html".into()),
      )
      .title("")           // 隐藏 macOS 原生标题文字，避免深色模式下黑色文字叠在侧边栏
      .inner_size(1360.0, 860.0)
      .min_inner_size(860.0, 560.0)
      .transparent(is_self_hosted);

      // SaaS 模式：窗口不透明，设置深色背景防止导航时白闪
      if !is_self_hosted {
        builder = builder.background_color(Color(14, 14, 18, 255));
      }

      #[cfg(target_os = "macos")]
      {
        builder = builder.title_bar_style(TitleBarStyle::Overlay);
      }

      let window = builder.build()?;

      // ── NSVisualEffectView（仅 self-hosted，加载瞬时无透明 flash）──
      #[cfg(target_os = "macos")]
      if is_self_hosted {
        let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
      }

      // ── 设置 macOS 菜单栏 ──
      if let Ok(menu) = build_app_menu(app.handle()) {
        let _ = app.set_menu(menu);
      }

      // ── 导航逻辑（独立线程，不阻塞 setup）──
      let handle = app.handle().clone();
      thread::spawn(move || {
        if is_self_hosted {
          launch_sidecar(&handle);
          wait_for_gateway();
          navigate(&handle, &format!("http://127.0.0.1:{}/setup.html", GATEWAY_PORT));
        } else {
          thread::sleep(Duration::from_millis(400));
          navigate(&handle, DEFAULT_GATEWAY_URL);
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_app_mode,
      set_app_mode,
      get_default_gateway_url,
      is_vibrancy_active,
      show_context_menu,
      reveal_in_finder,
      claude_code_check,
      claude_code_query,
      claude_code_stop,
      claude_code_new_conversation,
    ])
    .on_window_event(|_window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        stop_sidecar();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running jowork tauri app");
}
