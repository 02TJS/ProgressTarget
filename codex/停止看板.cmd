@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Stop-Dashboard.ps1"
if errorlevel 1 pause
