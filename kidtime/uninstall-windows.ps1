<#
    הסרת KidTime: מבטל את המשימה המתוזמנת, סוגר את המערכת ומחזיר את שורת המשימות.
    הרצה:  powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param([string]$TaskName = "KidTime")

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "המשימה '$TaskName' הוסרה." -ForegroundColor Green
} else {
    Write-Host "לא נמצאה משימה בשם '$TaskName'."
}

Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like "*KidTime.pyw*" -or $_.CommandLine -like "*-m kidtime*" } |
    ForEach-Object {
        Write-Host "סוגר תהליך $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($python) {
    Push-Location $here
    & $python -m kidtime --restore-taskbar
    Pop-Location
}

Write-Host "נתוני הזמנים נשארו ב-$env:LOCALAPPDATA\KidTime — אפשר למחוק ידנית." -ForegroundColor Yellow
