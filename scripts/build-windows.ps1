# FluxVita Windows 客户端打包脚本
# 用法：双击 build-windows.bat 启动，或直接在 PowerShell 中运行
# 依赖：自动检测并安装 Node.js / Rust / MSVC Build Tools / NSIS / WebView2

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptDir

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   FluxVita Windows 客户端打包工具         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Set-Location $projectRoot

# ── 工具函数 ─────────────────────────────────────────────

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                "$env:USERPROFILE\.cargo\bin"
}

function Test-Command($cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Step($msg) {
    Write-Host ""
    Write-Host "▶ $msg" -ForegroundColor Cyan
}

function OK($msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}

function Warn($msg) {
    Write-Host "  ! $msg" -ForegroundColor Yellow
}

function Fail($msg) {
    Write-Host ""
    Write-Host "  ✗ 错误: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "按 Enter 键退出"
    exit 1
}

# ── 1. 检查 winget ────────────────────────────────────────

Step "检查包管理器"
if (-not (Test-Command "winget")) {
    Fail "未找到 winget，请先安装 Windows App Installer（Windows 11 自带，Windows 10 可在应用商店搜索安装）"
}
OK "winget 可用"

# ── 2. 检查 / 安装 Node.js ────────────────────────────────

Step "检查 Node.js"
Refresh-Path
if (Test-Command "node") {
    $nodeVer = node --version 2>$null
    OK "Node.js $nodeVer 已安装"
} else {
    Warn "Node.js 未安装，正在通过 winget 安装 LTS 版本..."
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Test-Command "node")) {
        Fail "Node.js 安装失败，请手动安装后重试：https://nodejs.org"
    }
    OK "Node.js 安装完成：$(node --version)"
}

# ── 3. 检查 / 安装 Rust ───────────────────────────────────

Step "检查 Rust"
Refresh-Path
if (Test-Command "rustc") {
    $rustVer = rustc --version 2>$null
    OK "Rust $rustVer 已安装"
} else {
    Warn "Rust 未安装，正在下载并安装..."
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe -UseBasicParsing
    & $rustupExe -y --default-toolchain stable --profile minimal 2>&1
    Remove-Item $rustupExe -Force -ErrorAction SilentlyContinue
    Refresh-Path
    if (-not (Test-Command "rustc")) {
        Fail "Rust 安装失败，请手动安装后重试：https://rustup.rs"
    }
    OK "Rust 安装完成：$(rustc --version)"
}

# ── 4. 检查 / 安装 MSVC C++ Build Tools ──────────────────
# Rust 在 Windows 上需要 MSVC 工具链编译

Step "检查 MSVC C++ 工具链"
$vcToolsInstalled = $false
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsInfo = & $vswhere -latest -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 -property installationPath 2>$null
    if ($vsInfo) { $vcToolsInstalled = $true }
}

if ($vcToolsInstalled) {
    OK "MSVC C++ 工具链已安装"
} else {
    Warn "MSVC C++ 工具链未安装，正在安装（约 3-5GB，需要几分钟）..."
    winget install Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
        --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    OK "MSVC C++ 工具链安装完成"
}

# ── 5. 检查 / 安装 NSIS（打包 Windows 安装程序需要）────────

Step "检查 NSIS"
$nsisPath = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
if (Test-Path $nsisPath) {
    OK "NSIS 已安装"
} else {
    Warn "NSIS 未安装，正在安装..."
    winget install NSIS.NSIS --silent --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path $nsisPath)) {
        Fail "NSIS 安装失败，请手动下载：https://nsis.sourceforge.io"
    }
    OK "NSIS 安装完成"
}

# ── 6. 检查 WebView2（Windows 11 自带，Win10 需要）──────────

Step "检查 WebView2"
$wv2Key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if (Test-Path $wv2Key) {
    OK "WebView2 Runtime 已安装"
} else {
    Warn "WebView2 未安装，正在安装..."
    $wv2Url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    $wv2Exe = "$env:TEMP\MicrosoftEdgeWebview2Setup.exe"
    Invoke-WebRequest -Uri $wv2Url -OutFile $wv2Exe -UseBasicParsing
    & $wv2Exe /silent /install
    Remove-Item $wv2Exe -Force -ErrorAction SilentlyContinue
    OK "WebView2 安装完成"
}

# ── 7. 安装 Node 依赖 ─────────────────────────────────────

Step "安装 Node 依赖（npm ci）"
npm ci
if ($LASTEXITCODE -ne 0) { Fail "npm ci 失败" }
OK "依赖安装完成"

# ── 8. 编译打包 ───────────────────────────────────────────

Step "开始编译打包（首次编译需要下载 Rust 依赖，约 5-10 分钟）"
Write-Host "  请耐心等待..." -ForegroundColor DarkGray
Write-Host ""

npm run tauri:build

if ($LASTEXITCODE -ne 0) { Fail "tauri:build 失败，请检查上方错误信息" }

# ── 9. 完成 ──────────────────────────────────────────────

$outputDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║           打包完成！                      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

if (Test-Path $outputDir) {
    $exeFiles = Get-ChildItem "$outputDir\*.exe" -ErrorAction SilentlyContinue
    foreach ($f in $exeFiles) {
        $size = [math]::Round($f.Length / 1MB, 1)
        Write-Host "  📦 $($f.Name)  ($size MB)" -ForegroundColor White
        Write-Host "     $($f.FullName)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  正在打开输出目录..." -ForegroundColor Yellow
    Start-Process explorer.exe $outputDir
} else {
    Write-Host "  输出目录未找到，请检查 src-tauri\target\release\bundle\nsis\" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "按 Enter 键退出"
