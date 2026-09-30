"""נתיבים, ברירות מחדל וחישוב "יום" עבור KidTime."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

APP_NAME = "KidTime"
IS_WINDOWS = sys.platform.startswith("win")

# כתובת לפניות — מוצגת בקטן בפאנל, במסך הנעילה ובמדריך
AUTHOR_EMAIL = "shulamit0@gmail.com"
CREDIT = f"לתקלות והערות: {AUTHOR_EMAIL}"

# ברירות המחדל של המערכת. נשמרות ב-state.json בהתקנה הראשונה
# וניתנות לשינוי מפאנל ההורים.
DEFAULT_CONFIG = {
    "daily_minutes": 20,          # מכסה יומית לכל ילד/ה (אפשר לדרוס פר ילד/ה)
    "day_reset_hour": 4,          # השעה שבה מתחיל "יום" חדש (04:00, לא חצות)
    "idle_pause_seconds": 120,    # אחרי כמה שניות בלי נגיעה במקלדת/עכבר עוצרים את השעון
    "media_keeps_clock": True,    # וידאו, שמע או מסך מלא נחשבים שימוש גם בלי נגיעה
    "enforcement": "lock_screen",  # "lock_screen" או "workstation_lock"
    "hide_taskbar": True,         # להסתיר את שורת המשימות של Windows בזמן נעילה
    "block_hotkeys": True,        # לחסום Win / Alt+Tab / Alt+F4 בזמן נעילה
    "grace_seconds": 60,          # חלון בטיחות אחרי הדלקת המחשב, לפני שהנעילה מתחילה
    "setup_grace_minutes": 15,    # כמה זמן המחשב נשאר פתוח מיד אחרי ההגדרה הראשונה
    "warn_seconds": [300, 60, 10],  # התראות לפני סוף הזמן
    "max_request_minutes": 60,    # תקרה לבקשת זמן של ילד/ה
    "request_cooldown_minutes": 10,  # זמן מינימלי בין שתי בקשות של אותו ילד/ה
    "panel_idle_seconds": 180,    # סגירה אוטומטית של פאנל ההורים ללא שימוש
    "pin_max_failures": 5,        # כמה טעויות PIN לפני השהיה
    "pin_lock_minutes": 5,        # לכמה זמן נועלים את פאנל ההורים אחרי טעויות
    "keep_history_days": 90,      # כמה ימי היסטוריית שימוש לשמור

    # --- אישור בקשות במייל (כבוי עד שמגדירים תיבה ייעודית) ---
    "mail_enabled": False,        # שליחת בקשות למייל ההורה וקריאת התשובות
    "mail_to": "",                # כתובת ההורה שאליה נשלחות הבקשות
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_user": "",              # תיבת הדואר הייעודית של KidTime
    "smtp_password": "",          # סיסמת אפליקציה, לא סיסמת החשבון
    "imap_host": "imap.gmail.com",
    "imap_port": 993,
    "mail_poll_seconds": 25,      # כל כמה זמן בודקים אם הגיעה תשובה
    "mail_token_hours": 12,       # תוקף קישור האישור שנשלח במייל
}

# צבעים לאריחי הילדים — נבחרים במחזוריות בעת הוספה
CHILD_COLORS = ["#7b61ff", "#00c2cb", "#ff7a59", "#ffc43d",
                "#41d18b", "#ff5d9e", "#4d8dff"]


def _local_appdata() -> str | None:
    """התיקייה LocalAppData כפי ש-Windows יודע אותה — לא ממשתני הסביבה.

    משתני סביבה של המשתמש ניתנים לשינוי בלי הרשאות מנהל (``setx``). אם
    הנתיב היה נלקח מהם, ילד/ה היו יכולים להפנות את המערכת לתיקייה ריקה
    ולקבל מחשב "לא מוגדר" — בלי קוד הורים ועם אשף הגדרה פתוח.
    """
    try:
        import ctypes
        from ctypes import wintypes

        class _GUID(ctypes.Structure):
            _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                        ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

        # FOLDERID_LocalAppData {F1B32785-6FBA-4FCF-9D55-7B8E7F157091}
        folder = _GUID(0xF1B32785, 0x6FBA, 0x4FCF,
                       (ctypes.c_ubyte * 8)(0x9D, 0x55, 0x7B, 0x8E, 0x7F, 0x15, 0x70, 0x91))
        found = ctypes.c_wchar_p()
        shell32 = ctypes.WinDLL("shell32")
        ole32 = ctypes.WinDLL("ole32")
        if shell32.SHGetKnownFolderPath(ctypes.byref(folder), 0, None,
                                        ctypes.byref(found)) != 0:
            return None
        try:
            return found.value
        finally:
            ole32.CoTaskMemFree(found)
    except Exception:
        return None


def home_dir() -> Path:
    """התיקייה שבה נשמרים המצב והלוג."""
    if IS_WINDOWS:
        base = (_local_appdata() or os.environ.get("LOCALAPPDATA")
                or os.path.expanduser("~"))
        path = Path(base) / APP_NAME
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
        path = Path(base) / "kidtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def shared_dir() -> Path | None:
    """תיקייה משותפת לכל המשתמשים — שם יושב הגיבוי המוגן.

    ב-Windows זו ``C:\\ProgramData\\KidTime``. ``harden-windows.ps1`` נותן לה
    הרשאות שבהן לילד/ה יש קריאה בלבד, ולכן גיבוי ששוכן שם שורד גם מחיקה של
    כל תיקיית הנתונים האישית.
    """
    if IS_WINDOWS:
        base = os.environ.get("PROGRAMDATA")
        return Path(base) / APP_NAME if base else None
    return home_dir() / "backup"


def backup_path() -> Path | None:
    """הנתיב לגיבוי, או ``None`` אם אין מקום מתאים."""
    folder = shared_dir()
    return folder / "state.backup.json" if folder else None


def marker_path() -> Path:
    """קובץ ריק שמעיד שהמערכת כבר הוגדרה על המחשב הזה.

    מחיקת ``state.json`` לבדה משאירה אותו, ולכן היא לא מצליחה להחזיר את
    המערכת למצב "מחשב חדש" — שבו היא לא נועלת כלום.
    """
    return home_dir() / "installed"


def state_path() -> Path:
    return home_dir() / "state.json"


def log_path() -> Path:
    return home_dir() / "kidtime.log"


def day_key(now: datetime | None = None, reset_hour: int = 4) -> str:
    """מפתח היום. לפני ``reset_hour`` בבוקר עדיין נחשב היום הקודם."""
    now = now or datetime.now()
    if now.hour < reset_hour:
        now = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d")


def fmt_clock(seconds: float) -> str:
    """שניות → ``M:SS`` (או ``H:MM:SS`` מעל שעה)."""
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
