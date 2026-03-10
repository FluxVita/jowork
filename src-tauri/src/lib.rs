use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder,
    WebviewWindow,
};
use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;
use tauri_plugin_store::StoreExt;

const DEFAULT_GATEWAY_URL: &str = "https://gateway.fluxvita.work/shell.html";
const HEALTH_CHECK_INTERVAL_SECS: u64 = 30;
const STORE_KEY_GATEWAY_URL: &str = "gateway_url";
const OFFLINE_PAGE: &str = "tauri://localhost/offline.html";
const LOCAL_PROXY_PORT: u16 = 19801;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub gateway_url: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gateway_url: DEFAULT_GATEWAY_URL.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub online: bool,
    pub message: String,
}

// ── 日志 ──

fn log_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{}/Library/Logs/com.fluxvita.gateway/app.log", home)
}

fn log_event(msg: &str) {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    let home = std::env::var("HOME").unwrap_or_default();
    let log_dir = format!("{}/Library/Logs/com.fluxvita.gateway", home);
    let _ = std::fs::create_dir_all(&log_dir);

    // UTC HH:MM:SS
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let s = secs % 86400;
    let ts = format!("{:02}:{:02}:{:02}(UTC)", s / 3600, (s % 3600) / 60, s % 60);

    let line = format!("[{}] {}\n", ts, msg);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = f.write_all(line.as_bytes());
    }
}

// ── 本地 HTTP 代理（将 HTTP 请求转发到 HTTPS 上游，供 WKWebView 使用）──

/// 代理目标基础 URL（如 "https://frp-rug.com:49790"）
static PROXY_TARGET: OnceLock<Arc<Mutex<String>>> = OnceLock::new();

fn get_proxy_target() -> &'static Arc<Mutex<String>> {
    PROXY_TARGET.get_or_init(|| Arc::new(Mutex::new(String::new())))
}

fn set_proxy_target(gateway_url: &str) {
    let target = base_url(gateway_url);
    *get_proxy_target().lock().unwrap() = target.clone();
    log_event(&format!("[proxy] 目标设置为: {}", target));
}

/// WKWebView 导航地址（本地代理）
fn proxy_nav_url() -> String {
    format!("http://127.0.0.1:{}/shell.html", LOCAL_PROXY_PORT)
}

/// 寻找 HTTP 头部结束位置 \r\n\r\n
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).enumerate().find(|(_, w)| *w == b"\r\n\r\n").map(|(i, _)| i + 4)
}

/// 本地 HTTP 代理主循环
async fn run_local_proxy() {
    use tokio::net::TcpListener;
    let addr = format!("127.0.0.1:{}", LOCAL_PROXY_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => { log_event(&format!("[proxy] 监听 {}", addr)); l }
        Err(e) => { log_event(&format!("[proxy] 绑定失败: {e}")); return; }
    };
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                // 关闭 Nagle 算法：终端每次按键都要立即发送，不能攒包等 40ms
                let _ = stream.set_nodelay(true);
                let target = get_proxy_target().lock().unwrap().clone();
                if !target.is_empty() {
                    tokio::spawn(proxy_handle_conn(stream, target));
                }
            }
            Err(e) => log_event(&format!("[proxy] accept 错误: {e}")),
        }
    }
}

/// 处理单个代理连接：读取 HTTP 请求 → 转发给 HTTPS 上游 → 流式返回响应
async fn proxy_handle_conn(mut client: tokio::net::TcpStream, target_base: String) {
    use futures_util::StreamExt;

    // 读取 HTTP 请求头（直到 \r\n\r\n）
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let header_end;
    loop {
        match client.read(&mut tmp).await {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        if let Some(pos) = find_header_end(&buf) {
            header_end = pos;
            break;
        }
        if buf.len() > 65536 { return; }
    }

    // 解析请求行与 headers
    let header_str = match std::str::from_utf8(&buf[..header_end]) {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut lines = header_str.split("\r\n");
    let req_line = match lines.next() { Some(l) => l, None => return };
    let mut req_parts = req_line.splitn(3, ' ');
    let method = match req_parts.next() { Some(m) => m.to_string(), None => return };
    let path   = match req_parts.next() { Some(p) => p.to_string(), None => return };

    let mut headers: Vec<(String, String)> = Vec::new();
    let mut is_ws = false;
    let mut content_length: usize = 0;
    for line in lines {
        if line.is_empty() { break; }
        if let Some(colon) = line.find(':') {
            let name  = line[..colon].trim().to_string();
            let value = line[colon + 1..].trim().to_string();
            if name.eq_ignore_ascii_case("upgrade") && value.eq_ignore_ascii_case("websocket") {
                is_ws = true;
            }
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }

    // WebSocket：建立 TLS 隧道透传
    if is_ws {
        proxy_ws_tunnel(client, headers, path, target_base).await;
        return;
    }

    // 读取请求体（POST body 等）
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let need = (content_length - body.len()).min(8192);
        let mut chunk = vec![0u8; need];
        match client.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }

    // 构建 reqwest 请求
    let url = format!("{}{}", target_base, path);
    let method_r: reqwest::Method = method.parse().unwrap_or(reqwest::Method::GET);
    let mut rb = http_client().request(method_r, &url);

    // 转发请求头（跳过逐跳头）
    const HOP_BY_HOP: &[&str] = &[
        "host", "connection", "proxy-connection",
        "transfer-encoding", "te", "trailer", "upgrade", "keep-alive",
    ];
    for (name, value) in &headers {
        if HOP_BY_HOP.iter().any(|h| name.eq_ignore_ascii_case(h)) { continue; }
        rb = rb.header(name, value);
    }
    if !body.is_empty() { rb = rb.body(body); }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Proxy error: {e}");
            let _ = client.write_all(
                format!("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}", msg.len(), msg).as_bytes()
            ).await;
            return;
        }
    };

    // 构建响应头（使用 chunked 传输，兼容 SSE 流式响应）
    let status = resp.status();
    let mut resp_head = format!(
        "HTTP/1.1 {} {}\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Unknown")
    );
    for (name, value) in resp.headers() {
        let n = name.as_str().to_lowercase();
        // 跳过逐跳头和 Content-Length（我们用 chunked）
        if matches!(n.as_str(), "connection" | "transfer-encoding" | "keep-alive" | "content-length") {
            continue;
        }
        if let Ok(v) = value.to_str() {
            resp_head.push_str(&format!("{}: {}\r\n", name, v));
        }
    }
    resp_head.push_str("Transfer-Encoding: chunked\r\n\r\n");

    if client.write_all(resp_head.as_bytes()).await.is_err() { return; }

    // 流式转发响应体（chunked 编码）
    let mut body_stream = resp.bytes_stream();
    while let Some(chunk_result) = body_stream.next().await {
        match chunk_result {
            Ok(chunk) if !chunk.is_empty() => {
                let len_line = format!("{:x}\r\n", chunk.len());
                if client.write_all(len_line.as_bytes()).await.is_err() { break; }
                if client.write_all(&chunk).await.is_err() { break; }
                if client.write_all(b"\r\n").await.is_err() { break; }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = client.write_all(b"0\r\n\r\n").await;
}

/// 解析 base URL 中的 host 和 port（如 "https://frp-rug.com:49790" → ("frp-rug.com", 49790)）
fn parse_host_port(base_url: &str) -> Option<(String, u16)> {
    let without_scheme = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host_port = without_scheme.split('/').next()?;
    if let Some(colon_pos) = host_port.rfind(':') {
        let host = host_port[..colon_pos].to_string();
        let port: u16 = host_port[colon_pos + 1..].parse().ok()?;
        Some((host, port))
    } else {
        let port: u16 = if base_url.starts_with("https") { 443 } else { 80 };
        Some((host_port.to_string(), port))
    }
}

/// WebSocket 隧道代理：通过 TLS 将 WS 连接透传到上游（接受自签名证书）
async fn proxy_ws_tunnel(
    mut client: tokio::net::TcpStream,
    headers: Vec<(String, String)>,
    path: String,
    target_base: String,
) {
    use native_tls::TlsConnector as NativeTls;
    use tokio_native_tls::TlsConnector;

    let (host, port) = match parse_host_port(&target_base) {
        Some(hp) => hp,
        None => { log_event("[ws-proxy] 无法解析上游地址"); return; }
    };

    // TCP 连接上游（关闭 Nagle，终端输入必须即时发送）
    let tcp = match tokio::net::TcpStream::connect(format!("{}:{}", host, port)).await {
        Ok(t) => { let _ = t.set_nodelay(true); t }
        Err(e) => { log_event(&format!("[ws-proxy] TCP 连接失败: {e}")); return; }
    };

    // TLS 握手（接受自签名证书）
    let native_connector = match NativeTls::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => { log_event(&format!("[ws-proxy] TLS 构建失败: {e}")); return; }
    };
    let mut upstream = match TlsConnector::from(native_connector).connect(&host, tcp).await {
        Ok(s) => s,
        Err(e) => { log_event(&format!("[ws-proxy] TLS 握手失败: {e}")); return; }
    };

    // 构造 HTTP Upgrade 请求并发给上游（修改 Host 头）
    let host_hdr = if port == 443 { host.clone() } else { format!("{}:{}", host, port) };
    let mut req = format!("GET {} HTTP/1.1\r\nHost: {}\r\n", path, host_hdr);
    for (name, value) in &headers {
        if name.eq_ignore_ascii_case("host") { continue; }
        req.push_str(&format!("{}: {}\r\n", name, value));
    }
    req.push_str("\r\n");

    if upstream.write_all(req.as_bytes()).await.is_err() { return; }

    // 读取上游 101 Switching Protocols 响应并转发给客户端
    let mut resp_buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match upstream.read(&mut byte).await {
            Ok(0) | Err(_) => return,
            Ok(_) => resp_buf.push(byte[0]),
        }
        if resp_buf.ends_with(b"\r\n\r\n") { break; }
        if resp_buf.len() > 8192 { return; }
    }
    if client.write_all(&resp_buf).await.is_err() { return; }

    // 双向透传：client ↔ upstream（WS 帧原封不动）
    let _ = tokio::io::copy_bidirectional(&mut upstream, &mut client).await;
    log_event("[ws-proxy] WS 会话结束");
}

// ── 系统代理检测（macOS）──

/// 全局共享 HTTP 客户端（直连，不走系统代理，避免 Clash 等代理干扰 gateway 访问）
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        log_event("[client] 初始化 HTTP 客户端（直连模式，绕过系统代理）");
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .danger_accept_invalid_certs(true) // SakuraFRP 自签名证书
            .no_proxy() // 不走 Clash 等系统代理，直连 gateway
            .build()
            .expect("failed to build HTTP client")
    })
}


// ── Helpers ──

/// gateway_url 可能是 https://host/shell.html，剥离文件名得到基础 URL
fn base_url(gateway_url: &str) -> String {
    let s = gateway_url.trim_end_matches('/');
    if let Some(idx) = s.rfind('/') {
        // 最后一段含 '.' 说明是文件名（如 shell.html），去掉它
        if s[idx..].contains('.') {
            return s[..idx].to_string();
        }
    }
    s.to_string()
}

/// 是否首次启动（store 里从未保存过 gateway_url）
fn is_first_launch(app: &AppHandle) -> bool {
    match app.store("settings.json") {
        Ok(store) => store.get(STORE_KEY_GATEWAY_URL).is_none(),
        Err(_) => true,
    }
}

fn load_settings(app: &AppHandle) -> AppSettings {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(e) => {
            log_event(&format!("[settings] 无法打开 store: {e}，使用默认值"));
            return AppSettings::default();
        }
    };
    let raw = store
        .get(STORE_KEY_GATEWAY_URL)
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    log_event(&format!("[settings] store 原始值: {:?}", raw));

    let url = raw.unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());

    // 迁移：统一指向 shell.html
    let url = if url.contains(".html") && !url.ends_with("shell.html") {
        let base = url.rsplitn(2, '/').nth(1).unwrap_or(&url);
        format!("{}/shell.html", base)
    } else if !url.contains(".html") {
        format!("{}/shell.html", url.trim_end_matches('/'))
    } else {
        url
    };

    log_event(&format!("[settings] 迁移后 gateway_url: {}", url));
    AppSettings { gateway_url: url }
}

async fn do_health_check(gateway_url: &str) -> HealthStatus {
    let base = base_url(gateway_url);
    let url = format!("{}/health", base);

    log_event(&format!("[health] 检测 URL: {}", url));

    let result = match http_client().get(&url).send().await {
        Ok(resp) if resp.status().is_success() => HealthStatus {
            online: true,
            message: format!("HTTP {}", resp.status()),
        },
        Ok(resp) => HealthStatus {
            online: false,
            message: format!("HTTP {}", resp.status()),
        },
        Err(e) => {
            // 输出完整错误链
            use std::error::Error;
            let mut detail = format!("{e}");
            let mut src = e.source();
            while let Some(s) = src { detail.push_str(&format!(" → {s}")); src = s.source(); }
            HealthStatus {
                online: false,
                message: format!("连接失败: {}", detail),
            }
        }
    };

    log_event(&format!("[health] 结果: online={} msg={}", result.online, result.message));
    result
}

fn navigate_to(app: &AppHandle, window_label: &str, url_str: &str) {
    log_event(&format!("[navigate] -> {}", url_str));
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(parsed) = url_str.parse::<Url>() {
            let _ = win.navigate(parsed);
        } else {
            log_event(&format!("[navigate] URL 解析失败: {}", url_str));
        }
    } else {
        log_event(&format!("[navigate] 窗口 '{}' 不存在", window_label));
    }
}

fn create_main_window(app: &AppHandle, url: Url) -> tauri::Result<WebviewWindow> {
    let app_for_nav = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .background_color(Color(20, 20, 22, 255))
        .visible(true)
        .on_navigation(move |url| {
            let url_str = url.as_str();
            // 拦截飞书 OAuth 回调：无论 redirect_uri 指向哪个 HTTPS 地址，
            // 一律转发到本地 HTTP 代理，避免 WKWebView 因自签名证书拒绝跳转
            if url_str.contains("/api/auth/oauth/callback") && url_str.contains("code=")
                && !url_str.starts_with("http://127.0.0.1") {
                let query = url.query().map(|q| format!("?{}", q)).unwrap_or_default();
                let proxy_url = format!("http://127.0.0.1:{}/api/auth/oauth/callback{}", LOCAL_PROXY_PORT, query);
                log_event(&format!("[nav-intercept] OAuth callback -> {}", proxy_url));
                let handle = app_for_nav.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    navigate_to(&handle, "main", &proxy_url);
                });
                return false; // 阻止直接导航到 HTTPS（自签名证书）
            }
            true
        });

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Transparent)
        .hidden_title(true);

    let win = builder.build()?;

    #[cfg(target_os = "windows")]
    let _ = apply_mica(&win, Some(true));

    Ok(win)
}

fn show_or_create_main_window(app: &AppHandle, _gateway_url: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    } else if let Ok(parsed) = proxy_nav_url().parse::<Url>() {
        let _ = create_main_window(app, parsed);
    }
}

fn show_settings_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("FluxVita 设置")
            .inner_size(520.0, 420.0)
            .resizable(false)
            .build();
    }
}

// ── 本地 PTY（极客模式终端，运行在用户 MacBook 本机）──

struct PtySession {
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

// SAFETY: MasterPty 内部数据只通过 &self 方法访问，不存在数据竞争
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

struct PtyManager {
    sessions: Mutex<HashMap<u64, PtySession>>,
    next_id: AtomicU64,
}

impl PtyManager {
    fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
        }
    }
}

#[tauri::command]
fn pty_create(app: AppHandle, manager: tauri::State<PtyManager>, cols: u16, rows: u16) -> Result<u64, String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
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

    // 后台线程：持续读取 PTY 输出，通过 Tauri 事件推给前端
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

    manager.sessions.lock().unwrap().insert(id, PtySession {
        writer: Mutex::new(writer),
        master,
    });

    log_event(&format!("[pty] 创建会话 {} ({}x{})", id, cols, rows));
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
    let result = session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn pty_kill(manager: tauri::State<PtyManager>, id: u64) {
    manager.sessions.lock().unwrap().remove(&id);
    log_event(&format!("[pty] 关闭会话 {}", id));
}

// ── 本地 PTY WebSocket 服务（127.0.0.1:19802）──
// geek.html 优先连此端口，零网络延迟，体验等同本地终端

const LOCAL_PTY_WS_PORT: u16 = 19802;

async fn run_local_pty_ws() {
    use tokio::net::TcpListener;
    let addr = format!("127.0.0.1:{}", LOCAL_PTY_WS_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => { log_event(&format!("[pty-ws] 监听 {}", addr)); l }
        Err(e) => { log_event(&format!("[pty-ws] 绑定失败: {}", e)); return; }
    };
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let _ = stream.set_nodelay(true);
                tokio::spawn(handle_pty_ws(stream));
            }
            Err(e) => log_event(&format!("[pty-ws] accept 错误: {}", e)),
        }
    }
}

async fn handle_pty_ws(stream: tokio::net::TcpStream) {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use tokio_tungstenite::tungstenite::Message;
    use futures_util::SinkExt;
    use std::io::{Read, Write};

    // WebSocket 握手
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { log_event(&format!("[pty-ws] WS握手失败: {}", e)); return; }
    };
    let (mut ws_tx, mut ws_rx) = futures_util::StreamExt::split(ws);

    // 创建本地 PTY
    let pair = match native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }) {
        Ok(p) => p,
        Err(e) => { log_event(&format!("[pty-ws] openpty失败: {}", e)); return; }
    };

    // 跨平台 shell 选择：Windows 用 PowerShell，Unix 用 $SHELL 或 zsh
    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC")
        .unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL")
        .unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    let home_dir = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()
    } else {
        std::env::var("HOME").ok()
    };
    if let Some(home) = home_dir { cmd.cwd(home); }

    let _child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => { log_event(&format!("[pty-ws] spawn失败: {}", e)); return; }
    };
    drop(pair.slave);

    let master = pair.master;
    let mut pty_reader = master.try_clone_reader().unwrap();
    let pty_writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(master.take_writer().unwrap()));
    let pty_master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>> = Arc::new(Mutex::new(master));

    // PTY 读取线程 → channel → WS 发送
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

    log_event("[pty-ws] 新连接");

    // 主循环：同时处理 PTY 输出（→ WS）和 WS 输入（→ PTY）
    loop {
        tokio::select! {
            // PTY 输出 → WS
            data = rx.recv() => {
                match data {
                    Some(bytes) => {
                        let text = String::from_utf8_lossy(&bytes).into_owned();
                        if ws_tx.send(Message::Text(text)).await.is_err() { break; }
                    }
                    None => break,  // PTY 进程退出
                }
            }
            // WS 输入 → PTY
            msg = futures_util::StreamExt::next(&mut ws_rx) => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.as_str();
                        // resize / init 消息（JSON）
                        if text.starts_with('{') {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
                                let cols = v["cols"].as_u64().unwrap_or(80) as u16;
                                let rows = v["rows"].as_u64().unwrap_or(24) as u16;
                                let m = pty_master.lock().unwrap();
                                let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                                continue;
                            }
                        }
                        // 普通输入字符
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

    log_event("[pty-ws] 连接关闭");
}

// ── Claude Code Local ────────────────────────────────

struct ClaudeCodeManager {
    active_child: Mutex<Option<std::process::Child>>,
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

fn find_claude_binary() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{}/.local/bin/claude", home),
        format!("{}/.npm-global/bin/claude", home),
        "/usr/local/bin/claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
    ];
    for c in &candidates {
        let p = std::path::PathBuf::from(c);
        if p.exists() {
            return Some(std::fs::canonicalize(&p).unwrap_or(p));
        }
    }
    std::process::Command::new("which")
        .arg("claude")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !s.is_empty() {
                    let p = std::path::PathBuf::from(&s);
                    return Some(std::fs::canonicalize(&p).unwrap_or(p));
                }
            }
            None
        })
}

#[tauri::command]
fn claude_code_check() -> serde_json::Value {
    match find_claude_binary() {
        Some(path) => {
            let version = std::process::Command::new(&path)
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
    app: AppHandle,
    manager: tauri::State<'_, ClaudeCodeManager>,
    prompt: String,
    cwd: Option<String>,
) -> Result<(), String> {
    use std::process::{Command, Stdio};

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

    {
        let mut guard = manager.active_child.lock().unwrap();
        *guard = Some(child);
    }

    let app_clone = app.clone();
    let has_conv = manager.has_conversation.clone();
    std::thread::spawn(move || {
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
        has_conv.store(true, Ordering::SeqCst);
        let _ = app_clone.emit("claude_code_done", serde_json::json!({}));
    });

    let app_err = app.clone();
    std::thread::spawn(move || {
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

// ── Tauri Commands ──

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    log_event("[cmd] open_settings");
    show_settings_window(&app);
}

#[tauri::command]
fn get_settings(app: AppHandle) -> AppSettings {
    load_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, url: String) -> Result<String, String> {
    log_event(&format!("[cmd] save_settings: {}", url));
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Store error: {e}"))?;
    store.set(STORE_KEY_GATEWAY_URL, serde_json::json!(url));
    store.save().map_err(|e| format!("Save error: {e}"))?;

    // 更新代理目标，并将主窗口导航到本地代理 URL
    set_proxy_target(&url);
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(parsed) = proxy_nav_url().parse::<Url>() {
            let _ = win.navigate(parsed);
        }
    }

    Ok("saved".into())
}

#[tauri::command]
async fn check_health(app: AppHandle) -> HealthStatus {
    let settings = load_settings(&app);
    do_health_check(&settings.gateway_url).await
}

/// 返回本地代理导航 URL（供 offline.html retry 跳转使用）
#[tauri::command]
fn get_proxy_url() -> String {
    proxy_nav_url()
}

/// 返回最近 80 行日志，供前端诊断展示
#[tauri::command]
fn read_log() -> String {
    match std::fs::read_to_string(log_path()) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let start = lines.len().saturating_sub(80);
            lines[start..].join("\n")
        }
        Err(e) => format!("日志文件不存在或无法读取: {e}\n路径: {}", log_path()),
    }
}

// ── App Setup ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            check_health,
            get_proxy_url,
            install_update,
            open_settings,
            read_log,
            pty_create,
            pty_write,
            pty_resize,
            pty_kill,
            claude_code_check,
            claude_code_query,
            claude_code_stop,
            claude_code_new_conversation,
        ])
        .manage(PtyManager::new())
        .manage(ClaudeCodeManager::new())
        .setup(|app| {
            let handle = app.handle().clone();

            // 启动日志
            log_event("========== FluxVita 启动 ==========");

            // ── 迁移：失效 URL → 默认 Tailscale 地址 ──
            // 1. 本地开发时保存了 localhost URL
            // 2. Cloudflare Tunnel（cfargotunnel.com）在中国大陆无法访问（DNS 只返回私有 IPv6）
            {
                let raw = handle.store("settings.json").ok()
                    .and_then(|s| s.get(STORE_KEY_GATEWAY_URL))
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or_default();
                let needs_migration = raw.contains("localhost")
                    || raw.contains("127.0.0.1")
                    || raw.contains("cfargotunnel.com")
                    || raw.contains("jovidamac-mini")
                    || raw.starts_with("http://frp-rug.com"); // 旧 HTTP → 新默认地址
                if needs_migration {
                    log_event(&format!("[migration] URL 已迁移: {} -> {}", raw, DEFAULT_GATEWAY_URL));
                    if let Ok(store) = handle.store("settings.json") {
                        store.set(STORE_KEY_GATEWAY_URL, serde_json::json!(DEFAULT_GATEWAY_URL));
                        let _ = store.save();
                    }
                }
            }

            // 首次启动：预先把默认地址写入 store，offline.html 读到后直接用
            if is_first_launch(&handle) {
                log_event("[startup] 首次启动，预设默认地址到 store");
                if let Ok(store) = handle.store("settings.json") {
                    store.set(STORE_KEY_GATEWAY_URL, serde_json::json!(DEFAULT_GATEWAY_URL));
                    let _ = store.save();
                }
            }

            let settings = load_settings(&handle);
            log_event(&format!("[startup] gateway_url={}", settings.gateway_url));

            // ── 初始化代理目标 ──
            set_proxy_target(&settings.gateway_url);

            // ── 启动本地 HTTP 代理 ──
            tauri::async_runtime::spawn(run_local_proxy());

            // ── 启动本地 PTY WebSocket 服务（极客模式本地终端）──
            tauri::async_runtime::spawn(run_local_pty_ws());

            // ── 始终先显示 offline.html（避免黑屏），由页面自行检测并跳转 ──
            log_event("[startup] 加载 offline.html，等待页面检测连接");
            let initial_url: Url = OFFLINE_PAGE.parse().unwrap();
            let win = create_main_window(&handle, initial_url)?;

            // ── 系统托盘 ──
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "设置").build(app)?;
            let health_item = MenuItemBuilder::with_id("health", "检查连接").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &settings_item, &health_item, &quit_item])
                .build()?;

            let icon = tauri::include_image!("icons/tray-icon.png");

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("FluxVita Gateway")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        let s = load_settings(app);
                        show_or_create_main_window(app, &s.gateway_url);
                    }
                    "settings" => show_settings_window(app),
                    "health" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let s = load_settings(&app);
                            let status = do_health_check(&s.gateway_url).await;
                            let _ = app.emit("health-status", &status);
                        });
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        let s = load_settings(app);
                        show_or_create_main_window(app, &s.gateway_url);
                    }
                })
                .build(app)?;

            // ── 窗口关闭 → 隐藏 ──
            let handle_close = app.handle().clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(w) = handle_close.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            });

            // ── 自动更新检查 ──
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                use tauri_plugin_updater::UpdaterExt;
                if let Ok(updater) = update_handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        let _ = update_handle.emit("update-available", serde_json::json!({
                            "version": update.version,
                            "body": update.body.unwrap_or_default()
                        }));
                    }
                }
            });

            // ── 健康检查轮询 ──
            // is_offline 初始为 true：首次检测在线后立即从 Rust 端跳转到 gateway，
            // 不再依赖 JS window.location.href（可能被 WKWebView 拦截）
            let health_handle = app.handle().clone();
            let is_offline = Arc::new(Mutex::new(true));
            tauri::async_runtime::spawn(async move {
                loop {
                    let s = load_settings(&health_handle);
                    // 更新代理目标（以防 settings 在运行时被修改）
                    set_proxy_target(&s.gateway_url);
                    let status = do_health_check(&s.gateway_url).await;
                    let _ = health_handle.emit("health-status", &status);

                    // 在块内持有锁，确保 await 前释放
                    {
                        let mut offline = is_offline.lock().unwrap();
                        if !status.online && !*offline {
                            *offline = true;
                            log_event("[poll] Gateway 下线，跳转离线页");
                            navigate_to(&health_handle, "main", OFFLINE_PAGE);
                        } else if status.online && *offline {
                            *offline = false;
                            log_event("[poll] Gateway 在线，跳转本地代理");
                            navigate_to(&health_handle, "main", &proxy_nav_url());
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS)).await;
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running FluxVita");
}
