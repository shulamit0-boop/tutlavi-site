<#
    הסרת KidTime: מבטל את המשימה המתוזמנת, סוגר את המערכת ומחזיר את שורת המשימות.

    הדרך הפשוטה: לחיצה כפולה על "הסרה.bat".
    ידנית:  powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param([string]$TaskName = "KidTime")

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

Write-Host ""
Write-Host "==== הסרת KidTime ====" -ForegroundColor Cyan
Write-Host ""

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "המשימה המתוזמנת '$TaskName' הוסרה." -ForegroundColor Green
} else {
    Write-Host "לא נמצאה משימה מתוזמנת בשם '$TaskName'."
}

Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*KidTime.pyw*" -or $_.CommandLine -like "*-m kidtime*" } |
    ForEach-Object {
        Write-Host "סוגר תהליך $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# החזרת שורת המשימות, למקרה שהמערכת נסגרה בזמן שהיא הייתה מוסתרת
$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($python) {
    Push-Location $here
    try { & $python -m kidtime --restore-taskbar } catch {} finally { Pop-Location }
}

Write-Host ""
Write-Host "המערכת הוסרה. נתוני הזמנים נשארו ב-$env:LOCALAPPDATA\KidTime — אפשר למחוק ידנית." -ForegroundColor Yellow
Write-Host ""
