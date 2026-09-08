<#
    הסרת KidTime: מבטל את המשימה המתוזמנת, סוגר את המערכת ומחזיר את שורת המשימות.
    הדרך הפשוטה: לחיצה כפולה על "הסרה.bat".
#>
#Requires -Version 5.1
[CmdletBinding()]
param([string]$TaskName = "KidTime")

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

Write-Host ""
Write-Host "==== KidTime uninstall ====" -ForegroundColor Cyan
Write-Host ""

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task '$TaskName' removed." -ForegroundColor Green
} else {
    Write-Host "No scheduled task named '$TaskName'."
}

Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*KidTime.pyw*" -or $_.CommandLine -like "*-m kidtime*" } |
    ForEach-Object {
        Write-Host "Stopping process $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# החזרת שורת המשימות, למקרה שהמערכת נסגרה בזמן שהיא הייתה מוסתרת
$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($python) {
    Push-Location $here
    try { & $python -m kidtime --restore-taskbar 2>&1 | Out-Null } catch {} finally { Pop-Location }
}

Write-Host "Done." -ForegroundColor Green

$rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
       [System.Windows.Forms.MessageBoxOptions]::RightAlign
[System.Windows.Forms.MessageBox]::Show(
    "המערכת הוסרה.`n`nנתוני הזמנים נשארו ב:`n$env:LOCALAPPDATA\KidTime`nאפשר למחוק את התיקייה ידנית.",
    "KidTime", [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl) | Out-Null
