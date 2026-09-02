@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js 22以降を先にインストールしてください。& pause & exit /b 1)
if not exist node_modules call npm install
if errorlevel 1 (echo 準備に失敗しました。& pause & exit /b 1)
call npm start
if errorlevel 1 pause
