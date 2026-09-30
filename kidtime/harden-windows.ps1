<#
    הקשחת KidTime: מונע מילד/ה למחוק או לשנות את התוכנה ואת הגיבוי.

    ב-Windows אין "סיסמה על תיקייה" — ההגנה היחידה היא הרשאות NTFS, והן
    קשורות לחשבון המשתמש. לכן שני תנאים הכרחיים:
      1. חשבון הילדים הוא "משתמש רגיל" (Standard) ולא מנהל.
      2. הסקריפט הזה רץ פעם אחת כמנהל.

    הרצה:  לחיצה ימנית על "הקשחה.bat" ← הפעל כמנהל
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$AppDir,
    [string]$DataDir = (Join-Path $env:ProgramData "KidTime")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

# מזהי קבוצות קבועים (SID) ולא שמות: ב-Windows בעברית הקבוצות נקראות
# "מנהלים" ו"משתמשים", ו-icacls לא ימצא את השמות האנגליים.
$ADMINS = "*S-1-5-32-544"
$SYSTEM = "*S-1-5-18"
$USERS  = "*S-1-5-32-545"

if (-not $AppDir) { $AppDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path } }

function Show-Dialog([string]$Text, [string]$Title = "KidTime", [string]$Icon = "Information") {
    $rtl = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor `
           [System.Windows.Forms.MessageBoxOptions]::RightAlign
    [System.Windows.Forms.MessageBox]::Show(
        $Text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK,
        ([System.Windows.Forms.MessageBoxIcon]$Icon),
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $rtl) | Out-Null
}

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

function Invoke-Icacls([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & icacls.exe @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Host "  ! icacls: $output" -ForegroundColor Yellow }
    } finally { $ErrorActionPreference = $previous }
}

Write-Host ""
Write-Host "==== KidTime hardening ====" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Admin)) {
    if (Invoke-Elevated) { exit 0 }
    [System.Windows.Forms.MessageBox]::Show(
        "צריך הרשאות מנהל. לחיצה ימנית על 'הקשחה.bat' ← 'הפעל כמנהל'.",
        "KidTime") | Out-Null
    throw "Administrator rights required."
}

Write-Host "App folder : $AppDir"
Write-Host "Data folder: $DataDir"
Write-Host ""

# --- תיקיית התוכנה: קריאה והרצה בלבד למשתמשים רגילים --------------------
Write-Host "Locking the program folder (read + execute only for standard users)..."
Invoke-Icacls @($AppDir, "/inheritance:r", "/grant:r",
                "${ADMINS}:(OI)(CI)F", "${SYSTEM}:(OI)(CI)F", "${USERS}:(OI)(CI)RX", "/T", "/C", "/Q")

# --- תיקיית הגיבוי: כתיבה כן, מחיקה לא ----------------------------------
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
Write-Host "Protecting the backup folder (write allowed, delete denied)..."
Invoke-Icacls @($DataDir, "/inheritance:r", "/grant:r",
                "${ADMINS}:(OI)(CI)F", "${SYSTEM}:(OI)(CI)F", "${USERS}:(OI)(CI)M", "/C", "/Q")
# DE = מחיקת התיקייה, DC = מחיקת קבצים שבתוכה. בלי אלה אפשר לעדכן את
# הגיבוי אבל אי אפשר להיפטר ממנו.
Invoke-Icacls @($DataDir, "/deny", "${USERS}:(DE,DC)", "/C", "/Q")

# שאריות אפשריות מכתיבה אטומית שנחסמה
Get-ChildItem -Path $DataDir -Filter ".state-*.json" -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Done." -ForegroundColor Green
Write-Host ""

# --- מי מנהל במחשב הזה --------------------------------------------------
$admins = @()
try {
    $admins = Get-LocalGroupMember -SID S-1-5-32-544 -ErrorAction Stop |
              ForEach-Object { $_.Name }
} catch { }
if ($admins.Count) {
    Write-Host "Accounts with administrator rights:" -ForegroundColor Yellow
    $admins | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""
}

$list = if ($admins.Count) { ($admins -join "`n   • ") } else { "(לא ניתן לקרוא את הרשימה)" }
Show-Dialog (
    "ההקשחה הושלמה.`n`n" +
    "• תיקיית התוכנה: משתמש רגיל יכול להריץ, לא למחוק ולא לשנות.`n" +
    "• תיקיית הגיבוי: אפשר לעדכן, אי אפשר למחוק.`n`n" +
    "חשוב מאוד: כל זה תקף רק אם חשבון הילדים הוא 'משתמש רגיל'.`n" +
    "חשבונות עם הרשאות מנהל במחשב הזה:`n   • " + $list + "`n`n" +
    "אם חשבון של ילד/ה מופיע ברשימה — צריך להוריד אותו ל'משתמש רגיל'," +
    " אחרת ההקשחה לא שווה כלום.") "KidTime — הקשחה הושלמה"
