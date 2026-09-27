<#
    הסרת KidTime: דורש קוד הורים, מבטל את המשימה המתוזמנת, סוגר את המערכת,
    מחזיר את שורת המשימות ומוחק את קבצי התוכנה.

    נפתח מ"הגדרות ← אפליקציות ← KidTime ← הסרה", או בלחיצה כפולה על
    "הסרה.bat" בתיקיית ההתקנה.

    הקובץ נשמר כ-UTF-8 עם BOM — אחרת PowerShell 5.1 קורא את העברית כג'יבריש.
#>
#Requires -Version 5.1
[CmdletBinding()]
param([string]$TaskName = "KidTime")

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

$dest = Join-Path $env:LOCALAPPDATA "Programs\KidTime"
$data = Join-Path $env:LOCALAPPDATA "KidTime"

function Show-Dialog([string]$Text, [string]$Icon = "Information") {
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    [System.Windows.Forms.MessageBox]::Show(
        $Text, "KidTime", [System.Windows.Forms.MessageBoxButtons]::OK,
        ([System.Windows.Forms.MessageBoxIcon]$Icon),
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl) | Out-Null
}

function Confirm-Dialog([string]$Text) {
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $Text, "KidTime", [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2, $rtl)
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

Write-Host ""
Write-Host "==== KidTime uninstall ====" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------- איתור Python
$pythonw = $null
$saved = Join-Path $dest "python-path.txt"
if (Test-Path $saved) {
    $pythonw = (Get-Content $saved -Encoding UTF8 | Select-Object -First 1).Trim()
    if (-not (Test-Path $pythonw)) { $pythonw = $null }
}
if (-not $pythonw) {
    $candidate = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
    if ($candidate -and $candidate -notlike "*\WindowsApps\*") { $pythonw = $candidate }
}
$code = if (Test-Path (Join-Path $dest "kidtime")) { $dest } else { $PSScriptRoot }

# ----------------------------------------------------------- קוד הורים קודם
# בלי זה ילד/ה יכולים פשוט ללחוץ "הסרה" ברשימת האפליקציות.
if ($pythonw -and (Test-Path (Join-Path $code "kidtime"))) {
    $gate = Start-Process -FilePath $pythonw -ArgumentList @("-m", "kidtime", "--confirm-uninstall") `
        -WorkingDirectory $code -Wait -PassThru
    if ($gate.ExitCode -ne 0) {
        Write-Host "Cancelled (parent code not confirmed)." -ForegroundColor Yellow
        Show-Dialog "ההסרה בוטלה. שום דבר לא השתנה."
        exit 1
    }
} else {
    Write-Host "Python not found - skipping the parent-code check." -ForegroundColor Yellow
}

# --------------------------------------------------------------- ההסרה עצמה
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task '$TaskName' removed." -ForegroundColor Green
}

Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*KidTime.pyw*" -or $_.CommandLine -like "*-m kidtime*" } |
    Where-Object { $_.CommandLine -notlike "*--confirm-uninstall*" } |
    ForEach-Object {
        Write-Host "Stopping process $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# החזרת שורת המשימות, למקרה שהמערכת נסגרה בזמן שהיא הייתה מוסתרת
if ($pythonw) {
    Start-Process -FilePath $pythonw -ArgumentList @("-m", "kidtime", "--restore-taskbar") `
        -WorkingDirectory $code -Wait -ErrorAction SilentlyContinue
}

Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KidTime" `
    -Recurse -Force -ErrorAction SilentlyContinue

$wipe = Confirm-Dialog (
    "המערכת הוסרה.`n`n" +
    "למחוק גם את ההגדרות ואת היסטוריית הזמנים?`n`n" +
    "כן = מחיקה מלאה.`n" +
    "לא = הנתונים נשמרים, ואם תתקינו שוב הכל יחזור כמו שהיה.")
if ($wipe -and (Test-Path $data)) {
    Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    Write-Host "Data folder removed." -ForegroundColor Green
}

# קבצי התוכנה נמחקים אחרי שהסקריפט הזה נסגר — אי אפשר למחוק תיקייה
# שהסקריפט עצמו רץ מתוכה.
if (Test-Path $dest) {
    Set-Location $env:TEMP
    Start-Process -FilePath "cmd.exe" -WindowStyle Hidden `
        -ArgumentList "/c timeout /t 3 /nobreak >nul & rmdir /s /q `"$dest`""
}

Write-Host "Done." -ForegroundColor Green
Show-Dialog "KidTime הוסרה מהמחשב. תודה שהשתמשתם!`n`nלשאלות: shulamit0@gmail.com"
