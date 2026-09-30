@echo off
title KidTime hardening
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0harden-windows.ps1"
echo.
pause
