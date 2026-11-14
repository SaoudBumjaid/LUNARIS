@echo off
chcp 65001 >nul
title LUNARIS - rebuild and check the real datasets
cd /d "%~dp0pipeline"
where python >nul 2>nul
if errorlevel 1 (
  echo [LUNARIS] Python is not installed. Install Python 3.10+ from https://python.org and tick "Add to PATH".
  start https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist .venv ( python -m venv .venv )
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 ( echo pip install failed & pause & exit /b 1 )
echo.
echo [LUNARIS] 1/4 Checking Sun/Earth directions against JPL Horizons...
python validate_ephemeris.py
echo [LUNARIS] 2/4 Checking sunlight against Barker et al. 2021...
python validate_illumination.py
echo [LUNARIS] 3/4 Building the six south-pole regions (about 1-2 minutes)...
python build_open.py
if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
echo [LUNARIS] Building the South Pole map and the DSN coverage table...
python build_extras.py
if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
echo.
echo [LUNARIS] Done. Reload the web app.
pause
