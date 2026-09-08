<#
    התקנת KidTime על Windows.

    יוצר משימה מתוזמנת בשם "KidTime" שמריצה את המערכת בכל כניסה למשתמש,
    ומוודאת כל 5 דקות שהיא עדיין רצה (אם מישהו סגר אותה — היא חוזרת).

    הרצה:  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonW,                  # נתיב ידני ל-pythonw.exe, אם הזיהוי האוטומטי נכשל
    [string]$TaskName = "KidTime",
    [int]$WatchdogMinutes = 5          # כל כמה דקות לוודא שהמערכת רצה
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$launcher = Join-Path $here "KidTime.pyw"

if (-not (Test-Path $launcher)) {
    throw "לא נמצא $launcher — צריך להריץ את הסקריפט מתוך תיקיית kidtime."
}

function Find-PythonW {
    $candidate = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Source }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $found = & $py.Source -c "import os,sys;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"
        if ($found -and (Test-Path $found)) { return $found }
    }
    return $null
}

if (-not $PythonW) { $PythonW = Find-PythonW }
if (-not $PythonW -or -not (Test-Path $PythonW)) {
    throw "לא נמצא pythonw.exe. מתקינים Python מ-python.org (עם 'Add to PATH'), או מריצים עם ‎-PythonW ‎'C:\...\pythonw.exe'."
}

Write-Host "Python: $PythonW"
Write-Host "תיקייה: $here"

# בדיקה שהמערכת בכלל עולה בסביבה הזו
& $PythonW.Replace("pythonw.exe", "python.exe") -c "import tkinter" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "נראה ש-tkinter חסר בהתקנת Python. יש להתקין מחדש עם הרכיב 'tcl/tk and IDLE'."
}

$action = New-ScheduledTaskAction -Execute $PythonW -Argument "`"$launcher`"" -WorkingDirectory $here
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Description "מגביל זמן מסך לילדים (KidTime)" -Force | Out-Null

Write-Host "המשימה '$TaskName' נרשמה." -ForegroundColor Green
Start-ScheduledTask -TaskName $TaskName
Write-Host "המערכת הופעלה. בהפעלה הראשונה ייפתח אשף שקובע את קוד ההורים." -ForegroundColor Green
Write-Host ""
Write-Host "מומלץ: חשבון Windows של הילדים צריך להיות 'משתמש רגיל' (Standard) ולא מנהל —"
Write-Host "כך אי אפשר לשנות את שעון המערכת או לבטל את המשימה המתוזמנת."
