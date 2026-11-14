@echo off
title LUNARIS (localhost:5173)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve_lunaris.ps1"
pause
