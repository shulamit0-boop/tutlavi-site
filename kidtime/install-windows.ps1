<#
    התקנת KidTime על Windows.

    יוצר משימה מתוזמנת בשם "KidTime" שמריצה את המערכת בכל כניסה למשתמש,
    ומוודאת כל כמה דקות שהיא עדיין רצה (אם מישהו סגר אותה — היא חוזרת).

    הדרך הפשוטה: לחיצה כפולה על "התקנה.bat".
    ידנית:  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonW,                  # נתיב ידני ל-pythonw.exe, אם הזיהוי האוטומטי נכשל
    [string]$TaskName = "KidTime",
    [int]$WatchdogMinutes = 5          # כל כמה דקות לוודא שהמערכת רצה
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$launcher = Join-Path $here "KidTime.pyw"

Write-Host ""
Write-Host "==== התקנת KidTime — מגביל זמן מסך לילדים ====" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $launcher)) {
    throw "לא נמצא הקובץ KidTime.pyw בתיקייה $here — צריך להריץ את הסקריפט מתוך תיקיית kidtime."
}

# ---------------------------------------------------------------- איתור Python
function Find-PythonW {
    $found = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
    if ($found) { return $found }

    $py = (Get-Command py.exe -ErrorAction SilentlyContinue).Source
    if ($py) {
        $guess = & $py -c "import os,sys;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2>$null
        if ($guess -and (Test-Path $guess)) { return $guess }
    }

    $roots = @(
        "$env:LOCALAPPDATA\Programs\Python",
        "$env:ProgramFiles\Python*",
        "${env:ProgramFiles(x86)}\Python*",
        "C:\Python*"
    )
    foreach ($root in $roots) {
        $hit = Get-ChildItem -Path $root -Filter pythonw.exe -Recurse -ErrorAction SilentlyContinue |
               Sort-Object FullName -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if (-not $PythonW) { $PythonW = Find-PythonW }
if (-not $PythonW -or -not (Test-Path $PythonW)) {
    Write-Host "לא נמצאה התקנת Python במחשב." -ForegroundColor Red
    Write-Host ""
    Write-Host "מה לעשות:"
    Write-Host "  1. להוריד Python מ- https://www.python.org/downloads/"
    Write-Host "  2. בהתקנה לסמן 'Add Python to PATH' ולהשאיר מסומן 'tcl/tk and IDLE'"
    Write-Host "  3. להריץ את ההתקנה הזו שוב"
    throw "Python לא נמצא."
}

$python = Join-Path (Split-Path -Parent $PythonW) "python.exe"
if (-not (Test-Path $python)) { $python = $PythonW }

Write-Host "Python:  $PythonW"
Write-Host "תיקייה:  $here"
Write-Host ""

# ------------------------------------------------------------- בדיקות מקדימות
& $python -c "import tkinter" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "הרכיב tkinter חסר בהתקנת Python." -ForegroundColor Red
    Write-Host "יש להריץ שוב את מתקין Python, לבחור Modify, ולסמן 'tcl/tk and IDLE'."
    throw "tkinter חסר."
}

Push-Location $here
try {
    & $python -m kidtime --status | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "המערכת לא עלתה כמו שצריך (python -m kidtime --status נכשל)." }
} finally {
    Pop-Location
}
Write-Host "בדיקה עברה — המערכת רצה על המחשב הזה." -ForegroundColor Green

# -------------------------------------------------------- רישום משימה מתוזמנת
$action = New-ScheduledTaskAction -Execute $PythonW -Argument "`"$launcher`"" -WorkingDirectory $here

$triggers = @()
try {
    $triggers += New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
} catch {
    $triggers += New-ScheduledTaskTrigger -AtLogOn
}
$triggers += New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Description "מגביל זמן מסך לילדים (KidTime)" -Force | Out-Null

Write-Host "המשימה '$TaskName' נרשמה — המערכת תעלה בכל כניסה למחשב." -ForegroundColor Green

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "המערכת הופעלה." -ForegroundColor Green
Write-Host "עוד רגע ייפתח מסך על כל המסך — שם קובעים קוד הורים ומוסיפים את שמות הילדים."
Write-Host ""
Write-Host "הנתונים נשמרים ב: $env:LOCALAPPDATA\KidTime"
Write-Host ""
Write-Host "--- שני דברים שכדאי לדעת ---" -ForegroundColor Yellow
Write-Host "1. חשבון ה-Windows של הילדים צריך להיות 'משתמש רגיל' (Standard) ולא מנהל,"
Write-Host "   אחרת אפשר לשנות את השעון או לבטל את המשימה המתוזמנת."
Write-Host "2. אם שוכחים את קוד ההורים — פותחים שורת פקודה כמנהל בתיקייה הזו ומריצים:"
Write-Host "      python -m kidtime --reset-pin 1234"
Write-Host ""
Write-Host "להסרה: לחיצה כפולה על 'הסרה.bat'"
Write-Host ""
