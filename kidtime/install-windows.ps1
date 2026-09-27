<#
    התקנת KidTime על Windows.

    הדרך הפשוטה: לחיצה כפולה על "התקנה" בתיקייה שחולצה מקובץ ה-ZIP.

    מה הסקריפט עושה:
      1. מאתר Python מתאים (3.10 ומעלה, עם tkinter). אם אין — מציע להתקין
         אותו אוטומטית דרך winget, ואם גם זה לא אפשרי — פותח את דף ההורדה.
      2. מעתיק את התוכנה לתיקייה קבועה (LocalAppData\Programs\KidTime), כך
         שאפשר למחוק אחר כך את קובץ ה-ZIP ואת התיקייה שחולצה.
      3. רושם משימה מתוזמנת שמפעילה את המערכת בכל כניסה ל-Windows,
         ובודקת כל דקה שהיא עדיין רצה.
      4. מוסיף את KidTime לרשימת האפליקציות של Windows, להסרה מסודרת.

    הודעות הקונסולה באנגלית בכוונה: קונסולת Windows לא מציגה עברית באופן
    אמין, ולכן כל מה שמיועד להורה מוצג בחלוניות דיאלוג.

    הקובץ נשמר כ-UTF-8 עם BOM — אחרת PowerShell 5.1 קורא את העברית כג'יבריש.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonExe,                # נתיב ידני ל-python.exe, אם הזיהוי האוטומטי נכשל
    [string]$TaskName = "KidTime",
    [int]$WatchdogMinutes = 1,         # כל כמה דקות לוודא שהמערכת רצה
    [switch]$SelfTest                  # בדיקת פיתוח: תיקייה ומשימה זמניות, בלי חלונות
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$source = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$dest = Join-Path $env:LOCALAPPDATA "Programs\KidTime"
$appKey = "KidTime"
if ($SelfTest) {
    # לא נוגעים בהתקנה האמיתית: תיקייה, משימה ורישום נפרדים, ובלי לעצור את המערכת הרצה
    $dest = Join-Path $env:TEMP "KidTime-selftest"
    $TaskName = "KidTime-selftest"
    $appKey = "KidTime-selftest"
}
$contact = "shulamit0@gmail.com"
$credit = "לתקלות, שאלות והערות: $contact"

# ------------------------------------------------------------------ עזרים
function Say([string]$Text, [string]$Color = "Gray") { Write-Host $Text -ForegroundColor $Color }

function Show-Dialog([string]$Text, [string]$Title = "KidTime", [string]$Icon = "Information") {
    if ($SelfTest) { Write-Host "[dialog] $Icon"; return }
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    [System.Windows.Forms.MessageBox]::Show(
        $Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        ([System.Windows.Forms.MessageBoxIcon]$Icon),
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl) | Out-Null
}

function Confirm-Dialog([string]$Text, [string]$Title = "KidTime") {
    if ($SelfTest) { Write-Host "[confirm] -> no"; return $false }
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl)
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

function Fail([string]$Text, [string]$Reason) {
    Show-Dialog ($Text + "`n`n" + $credit) "KidTime" "Error"
    throw $Reason
}

# הרצת תוכנית חיצונית בלי ש-stderr יהפוך לשגיאה קטלנית ב-PowerShell 5.1
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Exe @Arguments 2>&1
        return [pscustomobject]@{
            Code   = $LASTEXITCODE
            Output = ($output | Out-String).Trim()
        }
    } catch {
        return [pscustomobject]@{ Code = -1; Output = $_.Exception.Message }
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ------------------------------------------------------------- איתור Python
# לא מספיק למצוא pythonw.exe כלשהו: תוכנות רבות (FormatFactory, GIMP, Anki...)
# מביאות איתן Python מקוצץ בלי tkinter. כל מועמד נבדק בהרצה בפועל.
function Test-PythonCandidate([string]$Exe) {
    if (-not $Exe -or -not (Test-Path $Exe)) { return $false }
    if ($Exe -like "*\WindowsApps\*") { return $false }   # קיצור הדרך של חנות Microsoft
    $probe = Invoke-Native $Exe @("-c", "import sys,tkinter;print(sys.version_info[0],sys.version_info[1])")
    if ($probe.Code -ne 0) { return $false }
    $parts = ($probe.Output -split '\s+')
    if ($parts.Count -lt 2) { return $false }
    try { $major = [int]$parts[0]; $minor = [int]$parts[1] } catch { return $false }
    return ($major -gt 3) -or ($major -eq 3 -and $minor -ge 10)
}

function Get-PythonCandidates {
    $found = New-Object System.Collections.Generic.List[string]

    # 1. משגר Python הרשמי — הדרך האמינה ביותר
    $py = (Get-Command py.exe -ErrorAction SilentlyContinue).Source
    if ($py) {
        $probe = Invoke-Native $py @("-3", "-c", "import sys;print(sys.executable)")
        if ($probe.Code -eq 0 -and $probe.Output) { $found.Add($probe.Output.Trim()) }
    }

    # 2. הרישום — התקנות רשמיות של Python
    foreach ($root in @("HKCU:\SOFTWARE\Python\PythonCore",
                        "HKLM:\SOFTWARE\Python\PythonCore",
                        "HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore")) {
        try {
            Get-ChildItem $root -ErrorAction SilentlyContinue |
                Sort-Object PSChildName -Descending |
                ForEach-Object {
                    $install = (Get-ItemProperty "$($_.PSPath)\InstallPath" -ErrorAction SilentlyContinue).'(default)'
                    if ($install) { $found.Add((Join-Path $install "python.exe")) }
                }
        } catch {}
    }

    # 3. מיקומי התקנה מקובלים
    foreach ($pattern in @("$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
                           "$env:ProgramFiles\Python3*\python.exe",
                           "${env:ProgramFiles(x86)}\Python3*\python.exe",
                           "C:\Python3*\python.exe")) {
        Get-ChildItem $pattern -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            ForEach-Object { $found.Add($_.FullName) }
    }

    # 4. מה שנמצא ב-PATH — אחרון, כי שם יושבים ה-Python המקוצצים של תוכנות אחרות
    Get-Command python.exe -All -ErrorAction SilentlyContinue |
        ForEach-Object { $found.Add($_.Source) }

    return $found | Select-Object -Unique
}

function Find-Python {
    if ($PythonExe) {
        if (Test-PythonCandidate $PythonExe) { return $PythonExe }
        Say "  rejected (given): $PythonExe" Yellow
    }
    foreach ($candidate in Get-PythonCandidates) {
        if (Test-PythonCandidate $candidate) { return $candidate }
        Say "  rejected: $candidate" DarkGray
    }
    return $null
}

# התקנה אוטומטית של Python דרך winget — מנהל החבילות הרשמי של Windows.
# ההתקנה למשתמש הנוכחי בלבד, בלי הרשאות מנהל, וכוללת את tkinter.
function Install-Python {
    $winget = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
    if (-not $winget) { return $false }
    Say ""
    Say "Installing Python 3.13 with winget (a few minutes)..." Cyan
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $winget install --exact --id Python.Python.3.13 --scope user --silent `
            --accept-package-agreements --accept-source-agreements
        $code = $LASTEXITCODE
    } catch {
        $code = -1
    } finally {
        $ErrorActionPreference = $previous
    }
    Say "winget finished with code $code"
    return $true
}

# ------------------------------------------------------------------- התחלה
Say ""
Say "==== KidTime setup ====" Cyan
Say ""

$required = @("KidTime.pyw", "kidtime\__main__.py", "kidtime\app.py", "uninstall-windows.ps1")
foreach ($file in $required) {
    if (-not (Test-Path (Join-Path $source $file))) {
        Fail ("חסר הקובץ $file בתיקיית ההתקנה.`n`n" +
              "צריך לחלץ את כל קובץ ה-ZIP (לחיצה ימנית ← חילוץ הכל)`n" +
              "ורק אז ללחוץ על 'התקנה'.") "Missing $file"
    }
}

Say "Source: $source"
Say "Looking for a working Python (3.10+ with tkinter)..."

$python = Find-Python
if (-not $python) {
    Say "No usable Python found." Yellow
    $auto = Confirm-Dialog (
        "המערכת צריכה את Python כדי לעבוד, והוא עדיין לא מותקן במחשב.`n`n" +
        "להתקין אותו עכשיו אוטומטית?`n" +
        "(חינמי ורשמי, צריך חיבור לאינטרנט, לוקח כמה דקות)") "KidTime — התקנת Python"
    if ($auto -and (Install-Python)) {
        $python = Find-Python
    }
}
if (-not $python) {
    $wants = Confirm-Dialog (
        "לא הצלחנו להתקין את Python אוטומטית.`n`n" +
        "אפשר להתקין ידנית מהאתר הרשמי. בהתקנה חשוב לסמן:`n" +
        "  • Add python.exe to PATH`n`n" +
        "לפתוח עכשיו את דף ההורדה?") "KidTime — חסר Python"
    if ($wants) { Start-Process "https://www.python.org/downloads/windows/" }
    Show-Dialog "אחרי התקנת Python — ללחוץ שוב על 'התקנה'." "KidTime"
    throw "No usable Python found."
}

Say "Python: $python" Green
$pythonw = Join-Path (Split-Path -Parent $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { $pythonw = $python }

# ------------------------------------------------ עצירת גרסה קודמת (שדרוג)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Say "Stopping the previous version..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
if (-not $SelfTest) {
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*KidTime.pyw*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# ------------------------------------------------------ העתקה לתיקייה קבועה
Say "Installing to: $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$package = Join-Path $dest "kidtime"
if (Test-Path $package) { Remove-Item -Recurse -Force $package }   # בלי קבצים ישנים שנשארו
Copy-Item -Recurse -Force (Join-Path $source "kidtime") $dest
foreach ($file in @("KidTime.pyw", "uninstall-windows.ps1", "README.md")) {
    $path = Join-Path $source $file
    if (Test-Path $path) { Copy-Item -Force $path $dest }
}
Get-ChildItem $source -Filter "*.bat" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*התקנה*" } |
    ForEach-Object { Copy-Item -Force $_.FullName $dest }
Get-ChildItem -Recurse -Path $dest -Include "__pycache__" -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
# קבצים מקובץ ZIP שהורד מסומנים "מהאינטרנט" — מורידים את הסימון מהעותק שלנו
Get-ChildItem -Recurse -File $dest | Unblock-File -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $dest "python-path.txt") -Value $pythonw -Encoding UTF8

$launcher = Join-Path $dest "KidTime.pyw"

# --------------------------------------------------------- בדיקה שהמערכת עולה
Push-Location $dest
try {
    $check = Invoke-Native $python @("-m", "kidtime", "--status")
} finally {
    Pop-Location
}
if ($check.Code -ne 0) {
    Say $check.Output Red
    Fail "המערכת לא הצליחה לעלות. הפירוט מופיע בחלון השחור — אפשר לצלם אותו ולשלוח." "Self-test failed."
}
Say "Self-test passed." Green

# -------------------------------------------------------- רישום משימה מתוזמנת
$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$launcher`"" -WorkingDirectory $dest

$triggers = @()
try {
    $triggers += New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
} catch {
    $triggers += New-ScheduledTaskTrigger -AtLogOn
}
# כל דקה: אם המערכת נסגרה (למשל ממנהל המשימות) — היא עולה שוב.
# כשהיא כבר רצה, MultipleInstances=IgnoreNew פשוט מדלג.
$triggers += New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Description "KidTime - screen time limiter for kids" -Force | Out-Null
Say "Scheduled task '$TaskName' registered." Green

# ------------------------------------------ רישום ברשימת האפליקציות של Windows
$version = "1.0"
$init = Get-Content (Join-Path $dest "kidtime\__init__.py") -Raw -Encoding UTF8
if ($init -match '__version__\s*=\s*"([^"]+)"') { $version = $Matches[1] }
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey"
New-Item -Path $uninstallKey -Force | Out-Null
$uninstallCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall-windows.ps1`""
$entries = @{
    DisplayName     = "KidTime — זמן מסך לילדים"
    DisplayVersion  = $version
    Publisher       = "KidTime"
    HelpLink        = "mailto:$contact"
    URLInfoAbout    = "mailto:$contact"
    InstallLocation = $dest
    UninstallString = $uninstallCmd
}
foreach ($name in $entries.Keys) {
    Set-ItemProperty -Path $uninstallKey -Name $name -Value $entries[$name]
}
Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -Type DWord
Say "Added to Windows 'Installed apps'." Green

if ($SelfTest) {
    Say "SELFTEST OK" Green
    return
}
Start-ScheduledTask -TaskName $TaskName
Say "Started." Green
Say ""

Show-Dialog (
    "ההתקנה הסתיימה!`n`n" +
    "עוד רגע ייפתח חלון ההגדרה: קוד הורים, שמות הילדים,`n" +
    "ומייל לקבלת בקשות זמן.`n`n" +
    "את התיקייה שחולצה ואת קובץ ה-ZIP אפשר עכשיו למחוק.`n`n" +
    "להסרה: הגדרות ← אפליקציות ← KidTime (דורש קוד הורים).`n`n" +
    $credit) "KidTime — ההתקנה הושלמה"
