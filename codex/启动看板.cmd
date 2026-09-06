@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Dashboard.ps1" -OpenBrowser
if errorlevel 1 pause
