use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
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
  mode: String, // "saas" | "self_hosted" | "local"
  #[serde(default, skip_serializing_if = "Option::is_none")]
  api_key: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  api_provider: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
  app.path().app_data_dir().ok().map(|d| d.join("config.json"))
}

fn read_mode(app: &tauri::AppHandle) -> String {
  config_path(app)
    .and_then(|p| fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
    .map(|c| c.mode)
    .filter(|m| m == "self_hosted" || m == "local")
    .unwrap_or_else(|| "saas".to_string())
}

fn read_config(app: &tauri::AppHandle) -> AppConfig {
  config_path(app)
    .and_then(|p| fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
    .unwrap_or(AppConfig { mode: "saas".to_string(), api_key: None, api_provider: None })
}

fn write_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
  let path = config_path(app).ok_or("Cannot determine app data dir")?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let content = serde_json::to_string(config).map_err(|e| e.to_string())?;
  fs::write(&path, content).map_err(|e| e.to_string())
}

fn write_mode(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
  let mut config = read_config(app);
  config.mode = mode.to_string();
  write_config(app, &config)
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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
  if mode != "saas" && mode != "self_hosted" && mode != "local" {
    return Err(format!("Invalid mode: {}", mode));
  }
  write_mode(&app, &mode)
}

#[tauri::command]
fn set_local_api_key(app: tauri::AppHandle, api_key: String, api_provider: Option<String>) -> Result<(), String> {
  let mut config = read_config(&app);
  config.api_key = Some(api_key);
  config.api_provider = api_provider;
  write_config(&app, &config)
}

#[tauri::command]
fn get_local_api_key(app: tauri::AppHandle) -> serde_json::Value {
  let config = read_config(&app);
  serde_json::json!({
    "api_key": config.api_key.unwrap_or_default(),
    "api_provider": config.api_provider.unwrap_or_else(|| "openrouter".to_string()),
  })
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

// ── Edge Agent (Edge Sidecar) ────────────────────────

struct EdgeAgentManager {
  active_child: Arc<Mutex<Option<Child>>>,
}

impl EdgeAgentManager {
  fn new() -> Self {
    Self { active_child: Arc::new(Mutex::new(None)) }
  }
}

/// 查找 edge-sidecar.js 的路径
fn find_edge_sidecar(app: &tauri::AppHandle) -> Option<PathBuf> {
  // 1. Tauri resource dir (打包后)
  if let Ok(resource_dir) = app.path().resource_dir() {
    let p = resource_dir.join("edge-sidecar.js");
    if p.exists() { return Some(p); }
  }
  // 2. 开发时: data/ 目录
  let dev = PathBuf::from("data/edge-sidecar.js");
  if dev.exists() { return Some(dev); }
  // 3. 从 exe 旁边找
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      let p = dir.join("edge-sidecar.js");
      if p.exists() { return Some(p); }
    }
  }
  None
}

/// 查找 node binary
fn find_node_binary() -> Option<PathBuf> {
  let home = std::env::var("HOME").unwrap_or_default();
  // 1. 系统级安装
  for p in &["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
    let path = PathBuf::from(p);
    if path.exists() { return Some(path); }
  }
  // 2. NVM：动态扫描版本目录，选最新版本
  let nvm_dir = PathBuf::from(format!("{}/.nvm/versions/node", home));
  if nvm_dir.is_dir() {
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
      let mut versions: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path().join("bin/node"))
        .filter(|p| p.exists())
        .collect();
      versions.sort_by(|a, b| b.cmp(a)); // 最新版本优先（v22 > v20）
      if let Some(p) = versions.into_iter().next() { return Some(p); }
    }
  }
  // 3. fallback: which node
  Command::new("which").arg("node").output().ok().and_then(|o| {
    if o.status.success() {
      let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
      if !s.is_empty() { return Some(PathBuf::from(s)); }
    }
    None
  })
}

#[tauri::command]
fn edge_agent_check(app: tauri::AppHandle) -> serde_json::Value {
  let sidecar = find_edge_sidecar(&app);
  let node = find_node_binary();
  serde_json::json!({
    "available": sidecar.is_some() && node.is_some(),
    "sidecar_path": sidecar.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
    "node_path": node.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
  })
}

#[tauri::command]
fn edge_agent_chat(
  app: tauri::AppHandle,
  manager: tauri::State<'_, EdgeAgentManager>,
  config: serde_json::Value,
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

  let sidecar_path = find_edge_sidecar(&app).ok_or("Edge sidecar not found")?;
  let node_bin = find_node_binary().ok_or("Node.js not found")?;

  let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

  let mut child = Command::new(&node_bin)
    .arg(&sidecar_path)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn edge sidecar: {}", e))?;

  // Write config to stdin
  if let Some(mut stdin) = child.stdin.take() {
    use std::io::Write;
    stdin.write_all(config_json.as_bytes()).map_err(|e| format!("Failed to write config: {}", e))?;
    stdin.write_all(b"\n").map_err(|e| format!("Failed to write newline: {}", e))?;
    stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
    drop(stdin);
  }

  let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
  let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

  {
    let mut guard = manager.active_child.lock().unwrap();
    *guard = Some(child);
  }

  // stdout → emit edge_event (JSON lines)
  let app_clone = app.clone();
  let manager_clone = manager.active_child.clone();
  thread::spawn(move || {
    let reader = std::io::BufReader::new(stdout);
    for line in reader.lines() {
      match line {
        Ok(l) if !l.is_empty() => {
          match serde_json::from_str::<serde_json::Value>(&l) {
            Ok(json) => { let _ = app_clone.emit("edge_event", &json); }
            Err(e) => { eprintln!("[edge-sidecar] JSON parse error: {} | line: {}", e, &l[..l.len().min(200)]); }
          }
        }
        Err(_) => break,
        _ => {}
      }
    }
    // 检查进程退出码，非零则 emit edge_error
    let exit_code = manager_clone.lock().ok()
      .and_then(|mut g| g.as_mut().and_then(|c| c.try_wait().ok().flatten()))
      .map(|s| s.code().unwrap_or(-1))
      .unwrap_or(0);
    if exit_code != 0 {
      let _ = app_clone.emit("edge_error", serde_json::json!({ "message": format!("Sidecar exited with code {}", exit_code) }));
    }
    let _ = app_clone.emit("edge_done", serde_json::json!({}));
  });

  // stderr → log (不 emit 到前端，避免干扰)
  thread::spawn(move || {
    let reader = std::io::BufReader::new(stderr);
    for line in reader.lines() {
      if let Ok(l) = line {
        if !l.is_empty() {
          eprintln!("[edge-sidecar] {}", l);
        }
      }
    }
  });

  Ok(())
}

#[tauri::command]
fn edge_agent_stop(manager: tauri::State<'_, EdgeAgentManager>) -> Result<(), String> {
  let mut guard = manager.active_child.lock().unwrap();
  if let Some(child) = guard.as_mut() {
    let _ = child.kill();
    let _ = child.wait();
  }
  *guard = None;
  Ok(())
}

// ── 本地 Session 迁移（local→server 升级路径）─────────

#[tauri::command]
fn get_local_sessions() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "Cannot find HOME dir".to_string())?;
    let sessions_dir = home.join(".jowork").join("sessions");

    if !sessions_dir.exists() {
        return Ok(serde_json::json!({ "sessions": [] }));
    }

    let mut sessions = Vec::new();

    let entries = fs::read_dir(&sessions_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() { continue; }

        let meta_path = path.join("meta.json");
        let messages_path = path.join("messages.json");

        if !meta_path.exists() { continue; }

        let meta_str = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        let meta: serde_json::Value = serde_json::from_str(&meta_str).unwrap_or_default();

        let messages: serde_json::Value = if messages_path.exists() {
            let msg_str = fs::read_to_string(&messages_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&msg_str).unwrap_or(serde_json::json!([]))
        } else {
            serde_json::json!([])
        };

        let session_id = meta.get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if session_id.is_empty() { continue; }

        sessions.push(serde_json::json!({
            "session_id": session_id,
            "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or("Local session"),
            "created_at": meta.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
            "messages": messages,
        }));
    }

    Ok(serde_json::json!({ "sessions": sessions }))
}

// ── 本地 PTY（极客模式终端）──────────────────────────

struct PtySession {
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    #[allow(dead_code)]
    master: Box<dyn portable_pty::MasterPty + Send>,
}

struct PtyManager {
    sessions: Mutex<HashMap<u64, PtySession>>,
    next_id: AtomicU64,
}

impl PtyManager {
    fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1) }
    }
}

#[tauri::command]
fn pty_create(app: AppHandle, manager: tauri::State<PtyManager>, cols: u16, rows: u16) -> Result<u64, String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "jowork");
    #[cfg(target_os = "windows")]
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) { cmd.cwd(home); }
    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") { cmd.cwd(home); }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let id = manager.next_id.fetch_add(1, Ordering::SeqCst);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(&format!("pty_output_{}", id), data);
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(&format!("pty_exit_{}", id), ());
    });

    manager.sessions.lock().unwrap().insert(id, PtySession { writer: Mutex::new(writer), master });
    Ok(id)
}

#[tauri::command]
fn pty_write(manager: tauri::State<PtyManager>, id: u64, data: String) -> Result<(), String> {
    use std::io::Write;
    let sessions = manager.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("PTY session not found")?;
    let result = session.writer.lock().unwrap().write_all(data.as_bytes()).map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn pty_resize(manager: tauri::State<PtyManager>, id: u64, cols: u16, rows: u16) -> Result<(), String> {
    use portable_pty::PtySize;
    let sessions = manager.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("PTY session not found")?;
    session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(manager: tauri::State<PtyManager>, id: u64) {
    manager.sessions.lock().unwrap().remove(&id);
}

// ── 本地 PTY WebSocket 服务（127.0.0.1:18802）──
// geek.html 优先连此端口，零网络延迟，体验等同本地终端

const LOCAL_PTY_WS_PORT: u16 = 18802;

async fn run_local_pty_ws() {
    use tokio::net::TcpListener;
    let addr = format!("127.0.0.1:{}", LOCAL_PTY_WS_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => { eprintln!("[pty-ws] 监听 {}", addr); l }
        Err(e) => { eprintln!("[pty-ws] 绑定失败: {}", e); return; }
    };
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let _ = stream.set_nodelay(true);
                tokio::spawn(handle_pty_ws(stream));
            }
            Err(e) => eprintln!("[pty-ws] accept 错误: {}", e),
        }
    }
}

async fn handle_pty_ws(stream: tokio::net::TcpStream) {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use tokio_tungstenite::tungstenite::Message;
    use futures_util::SinkExt;
    use std::io::{Read, Write};

    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { eprintln!("[pty-ws] WS握手失败: {}", e); return; }
    };
    let (mut ws_tx, mut ws_rx) = futures_util::StreamExt::split(ws);

    let pair = match native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }) {
        Ok(p) => p,
        Err(e) => { eprintln!("[pty-ws] openpty失败: {}", e); return; }
    };

    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "jowork");
    let home_dir = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()
    } else {
        std::env::var("HOME").ok()
    };
    if let Some(home) = home_dir { cmd.cwd(home); }

    let _child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => { eprintln!("[pty-ws] spawn失败: {}", e); return; }
    };
    drop(pair.slave);

    let master = pair.master;
    let mut pty_reader = master.try_clone_reader().unwrap();
    let pty_writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(master.take_writer().unwrap()));
    let pty_master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>> = Arc::new(Mutex::new(master));

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match pty_reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() { break; }
                }
            }
        }
    });

    eprintln!("[pty-ws] 新连接");

    loop {
        tokio::select! {
            data = rx.recv() => {
                match data {
                    Some(bytes) => {
                        let text = String::from_utf8_lossy(&bytes).into_owned();
                        if ws_tx.send(Message::Text(text)).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            msg = futures_util::StreamExt::next(&mut ws_rx) => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.as_str();
                        if text.starts_with('{') {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
                                let cols = v["cols"].as_u64().unwrap_or(80) as u16;
                                let rows = v["rows"].as_u64().unwrap_or(24) as u16;
                                let m = pty_master.lock().unwrap();
                                let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                                continue;
                            }
                        }
                        let mut w = pty_writer.lock().unwrap();
                        let _ = w.write_all(text.as_bytes());
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let mut w = pty_writer.lock().unwrap();
                        let _ = w.write_all(&data);
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    eprintln!("[pty-ws] 连接关闭");
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
    .manage(EdgeAgentManager::new())
    .manage(PtyManager::new())
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

      // ── 启动本地 PTY WebSocket 服务（极客模式终端）──
      tauri::async_runtime::spawn(run_local_pty_ws());

      // ── 自托管模式：预启动 sidecar（非阻塞） ──
      if is_self_hosted {
        launch_sidecar(&app.handle());
      }
      // 导航逻辑由 loading.html 通过 Tauri invoke 完成，不再阻塞

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_app_mode,
      set_app_mode,
      set_local_api_key,
      get_local_api_key,
      get_default_gateway_url,
      is_vibrancy_active,
      show_context_menu,
      reveal_in_finder,
      claude_code_check,
      claude_code_query,
      claude_code_stop,
      claude_code_new_conversation,
      edge_agent_check,
      edge_agent_chat,
      edge_agent_stop,
      get_local_sessions,
      pty_create,
      pty_write,
      pty_resize,
      pty_kill,
    ])
    .on_window_event(|_window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        stop_sidecar();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running jowork tauri app");
}
