@echo off
chcp 65001 >nul
title LUNARIS
cd /d "%~dp0web"
rem Node may be installed but not yet on PATH in this window: add the usual install folders.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [LUNARIS] Node.js was not found on this PC.
  echo Downloading the .msi file is not enough: open it from your Downloads folder and click Next ... Install.
  echo Then run START_LUNARIS again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [LUNARIS] Using Node.js %%v
if not exist node_modules (
  echo [LUNARIS] Installing web dependencies ^(first run only, 1-2 minutes^)...
  call npm install
  if errorlevel 1 ( echo npm install failed - send a photo of this window & pause & exit /b 1 )
)
echo [LUNARIS] Starting at http://localhost:5173  ^(close this window to stop^)
start "" cmd /c "timeout /t 6 >nul & start http://localhost:5173"
call npm run dev
pause
