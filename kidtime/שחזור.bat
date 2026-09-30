@echo off
title KidTime recovery
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0recover-windows.ps1"
echo.
pause
