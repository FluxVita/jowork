@echo off
chcp 65001 >nul
echo.
echo 正在启动 FluxVita Windows 打包工具...
echo.

:: 以管理员权限运行（安装依赖需要）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要管理员权限，正在提升权限...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: 运行 PowerShell 脚本
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0build-windows.ps1"
