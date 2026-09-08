"""נתיבים, ברירות מחדל וחישוב "יום" עבור KidTime."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

APP_NAME = "KidTime"
IS_WINDOWS = sys.platform.startswith("win")

# ברירות המחדל של המערכת. נשמרות ב-state.json בהתקנה הראשונה
# וניתנות לשינוי מפאנל ההורים.
DEFAULT_CONFIG = {
    "daily_minutes": 20,          # מכסה יומית לכל ילד/ה (אפשר לדרוס פר ילד/ה)
    "day_reset_hour": 4,          # השעה שבה מתחיל "יום" חדש (04:00, לא חצות)
    "idle_pause_seconds": 120,    # אחרי כמה שניות בלי נגיעה במקלדת/עכבר עוצרים את השעון
    "enforcement": "lock_screen",  # "lock_screen" או "workstation_lock"
    "hide_taskbar": True,         # להסתיר את שורת המשימות של Windows בזמן נעילה
    "block_hotkeys": True,        # לחסום Win / Alt+Tab / Alt+F4 בזמן נעילה
    "warn_seconds": [300, 60, 10],  # התראות לפני סוף הזמן
    "max_request_minutes": 60,    # תקרה לבקשת זמן של ילד/ה
    "pin_max_failures": 5,        # כמה טעויות PIN לפני השהיה
    "pin_lock_minutes": 5,        # לכמה זמן נועלים את פאנל ההורים אחרי טעויות
    "keep_history_days": 90,      # כמה ימי היסטוריית שימוש לשמור
}

# צבעים לאריחי הילדים — נבחרים במחזוריות בעת הוספה
CHILD_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6"]


def home_dir() -> Path:
    """התיקייה שבה נשמרים המצב והלוג.

    ``KIDTIME_HOME`` נלקח בחשבון רק כאשר ``KIDTIME_DEV=1`` — אחרת ילד/ה
    היו יכולים להגדיר משתנה סביבה ולקבל מכסה נקייה.
    """
    override = os.environ.get("KIDTIME_HOME")
    if override and os.environ.get("KIDTIME_DEV") == "1":
        path = Path(override)
    elif IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        path = Path(base) / APP_NAME
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
        path = Path(base) / "kidtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


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
