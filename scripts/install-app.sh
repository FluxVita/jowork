#!/bin/bash
# 安装 Jowork.app 到 /Applications
# 用法：bash scripts/install-app.sh

set -e

APP_SRC="$(cd "$(dirname "$0")/.." && pwd)/apps/jowork/src-tauri/target/release/bundle/macos/Jowork.app"
APP_DST="/Applications/Jowork.app"

if [ ! -d "$APP_SRC" ]; then
  echo "未找到构建产物，请先运行 pnpm --filter @jowork/app tauri:build"
  exit 1
fi

# 杀掉正在运行的 Jowork
if pgrep -x "jowork-app" > /dev/null 2>&1; then
  echo "关闭正在运行的 Jowork..."
  pkill -x "jowork-app" 2>/dev/null || true
  sleep 1
fi
# 也杀掉可能残留的 gateway sidecar
pkill -f "jowork-gateway" 2>/dev/null || true

echo "安装 Jowork.app -> /Applications/"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"

# 清图标缓存
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -kill -r -domain local -domain system -domain user 2>/dev/null || true
killall Dock 2>/dev/null || true

echo "安装完成，已清图标缓存"
open "$APP_DST"
