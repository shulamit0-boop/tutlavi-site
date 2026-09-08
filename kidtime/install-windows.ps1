<#
    התקנת KidTime על Windows.

    הודעות המסך כאן באנגלית בכוונה: קונסולת Windows לא מציגה עברית באופן אמין
    (קידוד + גופן), ולכן כל מה שמיועד למשתמשת מוצג בחלוניות דיאלוג של Windows.

    הדרך הפשוטה: לחיצה כפולה על "התקנה.bat".
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonExe,                # נתיב ידני ל-python.exe, אם הזיהוי האוטומטי נכשל
    [string]$TaskName = "KidTime",
    [int]$WatchdogMinutes = 5          # כל כמה דקות לוודא שהמערכת רצה
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$launcher = Join-Path $here "KidTime.pyw"

# ------------------------------------------------------------------ עזרים
function Say([string]$Text, [string]$Color = "Gray") { Write-Host $Text -ForegroundColor $Color }

function Show-Dialog([string]$Text, [string]$Title = "KidTime", [string]$Icon = "Information") {
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    [System.Windows.Forms.MessageBox]::Show(
        $Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        ([System.Windows.Forms.MessageBoxIcon]$Icon),
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl) | Out-Null
}

function Confirm-Dialog([string]$Text, [string]$Title = "KidTime") {
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl)
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
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
            Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
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

# ------------------------------------------------------------------- התחלה
Say ""
Say "==== KidTime setup ====" Cyan
Say ""

if (-not (Test-Path $launcher)) {
    Show-Dialog "לא נמצא הקובץ KidTime.pyw בתיקייה:`n$here`n`nצריך להריץ את ההתקנה מתוך תיקיית kidtime." "KidTime" "Error"
    throw "KidTime.pyw not found in $here"
}

Say "Folder: $here"
Say "Looking for a working Python (3.10+ with tkinter)..."

$python = $null
if ($PythonExe) {
    if (Test-PythonCandidate $PythonExe) { $python = $PythonExe }
    else { Say "  rejected (given): $PythonExe" Yellow }
}
if (-not $python) {
    foreach ($candidate in Get-PythonCandidates) {
        if (Test-PythonCandidate $candidate) { $python = $candidate; break }
        Say "  rejected: $candidate" DarkGray
    }
}

if (-not $python) {
    Say "No usable Python found." Red
    $wants = Confirm-Dialog (
        "לא נמצאה במחשב התקנה מתאימה של Python.`n`n" +
        "(נמצאו גרסאות מקוצצות שמגיעות עם תוכנות אחרות — הן לא מתאימות.)`n`n" +
        "צריך Python 3.10 ומעלה. בהתקנה חשוב לסמן:`n" +
        "  • Add Python to PATH`n" +
        "  • tcl/tk and IDLE`n`n" +
        "לפתוח עכשיו את דף ההורדה?") "KidTime — חסר Python"
    if ($wants) { Start-Process "https://www.python.org/downloads/" }
    Show-Dialog "אחרי התקנת Python — ללחוץ שוב על 'התקנה.bat'." "KidTime"
    throw "No usable Python found."
}

Say "Python: $python" Green

$pythonw = Join-Path (Split-Path -Parent $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { $pythonw = $python }

# --------------------------------------------------------- בדיקה שהמערכת עולה
Push-Location $here
try {
    $check = Invoke-Native $python @("-m", "kidtime", "--status")
} finally {
    Pop-Location
}
if ($check.Code -ne 0) {
    Say $check.Output Red
    Show-Dialog "המערכת לא הצליחה לעלות. הפירוט מופיע בחלון השחור.`n`nאפשר להעתיק אותו ולשלוח לי." "KidTime" "Error"
    throw "Self-test failed."
}
Say "Self-test passed." Green

# -------------------------------------------------------- רישום משימה מתוזמנת
$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$launcher`"" -WorkingDirectory $here

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
    -Description "KidTime - screen time limiter for kids" -Force | Out-Null

Say "Scheduled task '$TaskName' registered." Green

Start-ScheduledTask -TaskName $TaskName
Say "Started." Green
Say ""
Say "Data folder: $env:LOCALAPPDATA\KidTime"
Say ""

Show-Dialog (
    "ההתקנה הסתיימה. עוד רגע ייפתח מסך על כל המסך —`n" +
    "שם קובעים קוד הורים ומוסיפים את שמות הילדים.`n`n" +
    "שני דברים שכדאי לדעת:`n`n" +
    "1. חשבון ה-Windows של הילדים צריך להיות 'משתמש רגיל' ולא מנהל,`n" +
    "    אחרת אפשר לשנות את השעון או לבטל את המשימה המתוזמנת.`n`n" +
    "2. אם שוכחים את קוד ההורים — פותחים שורת פקודה כמנהל`n" +
    "    בתיקייה הזו ומריצים:  python -m kidtime --reset-pin 1234`n`n" +
    "להסרה: לחיצה כפולה על 'הסרה.bat'.") "KidTime — ההתקנה הושלמה"
