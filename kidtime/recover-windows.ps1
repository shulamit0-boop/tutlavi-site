<#
    שחזור חירום — "חלון המתכנת".

    מסיר את KidTime לחלוטין גם כשהתוכנה עצמה תקועה, שבורה או לא עולה:
    אינו מריץ שום קוד Python, ולא תלוי בקוד ההורים. הרשאות מנהל הן המפתח
    הראשי — זו נקודת המילוט המתוכננת של המערכת.

    הרצה:  לחיצה ימנית על "שחזור.bat" ← הפעל כמנהל
    להסרה מלאה כולל הנתונים:  .\recover-windows.ps1 -RemoveData
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$TaskName = "KidTime",
    [string]$AppDir,
    [string]$DataDir = (Join-Path $env:ProgramData "KidTime"),
    [switch]$RemoveData
)

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
if (-not $AppDir) { $AppDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path } }

function Invoke-Elevated {
    # מריץ את הסקריפט מחדש עם הרשאות מנהל (בקשת UAC).
    # בתוך פונקציה $MyInvocation מתייחס לפונקציה עצמה, ולכן משתמשים
    # ב-$PSCommandPath שהוא הנתיב של הסקריפט.
    $self = $PSCommandPath
    if (-not $self) { return $false }
    try {
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$self`"") | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ""
Write-Host "==== KidTime emergency recovery ====" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Admin)) {
    if (Invoke-Elevated) { exit 0 }
    [System.Windows.Forms.MessageBox]::Show(
        "צריך הרשאות מנהל. לחיצה ימנית על 'שחזור.bat' ← 'הפעל כמנהל'.",
        "KidTime") | Out-Null
    throw "Administrator rights required."
}

# 1. המשימה המתוזמנת — כדי שהתוכנה לא תחזור
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[1/4] scheduled task removed" -ForegroundColor Green
} else {
    Write-Host "[1/4] no scheduled task found"
}

# 2. התהליכים עצמם, בכל החשבונות
$killed = 0
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*KidTime.pyw*" -or $_.CommandLine -like "*kidtime*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
    }
Write-Host "[2/4] processes stopped: $killed" -ForegroundColor Green

# 3. שורת המשימות — הפעלה מחדש של Explorer מחזירה אותה בוודאות,
#    בלי להסתמך על קוד של התוכנה שאולי שבור
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Write-Host "[3/4] taskbar restored" -ForegroundColor Green

# 4. הרשאות — החזרה לירושה רגילה, אחרת אי אפשר למחוק את התיקיות
foreach ($dir in @($AppDir, $DataDir)) {
    if (Test-Path $dir) {
        & icacls.exe $dir /reset /T /C /Q    | Out-Null
        & icacls.exe $dir /inheritance:e /C /Q | Out-Null
    }
}
Write-Host "[4/4] permissions reset" -ForegroundColor Green

if ($RemoveData -and (Test-Path $DataDir)) {
    Remove-Item -Path $DataDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "      data folder deleted: $DataDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "KidTime is no longer running and will not come back." -ForegroundColor Green
Write-Host "Program folder can now be deleted normally: $AppDir"
if (-not $RemoveData) {
    Write-Host "Per-user data remains in %LOCALAPPDATA%\KidTime (each account)."
    Write-Host "Shared backup remains in $DataDir  (-RemoveData deletes it)."
}
Write-Host ""
