@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-studio.ps1"
exit /b %errorlevel%
