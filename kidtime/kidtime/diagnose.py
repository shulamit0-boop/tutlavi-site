"""בדיקת סביבה: האם Tk שבמחשב הזה מסדר עברית מימין לשמאל.

ל-Tk אין תמיכה מובנית ב-bidi בכל הגרסאות. במקום לנחש לפי מספר גרסה,
שואלים את Tk עצמו: מציירים מילה עברית ובודקים איזו אות יצאה בקצה השמאלי.
"""
from __future__ import annotations

import sys

PROBE_WORD = "אבגד"     # ארבע אותיות, בלי רווחים ובלי ניקוד


def tk_reorders_hebrew() -> bool | None:
    """``True`` אם Tk מסדר עברית נכון, ``False`` אם לא, ``None`` אם אי אפשר לבדוק."""
    try:
        import tkinter as tk
    except ImportError:
        return None
    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        canvas = tk.Canvas(root, width=300, height=80)
        canvas.pack()
        root.update()
        item = canvas.create_text(10, 40, text=PROBE_WORD, anchor="w")
        root.update()
        box = canvas.bbox(item)
        if not box:
            return None
        x0, y0, x1, y1 = box
        middle = (y0 + y1) // 2
        leftmost = canvas.index(item, f"@{x0 + 3},{middle}")
        rightmost = canvas.index(item, f"@{x1 - 3},{middle}")
        # בעברית מסודרת, האות האחרונה לוגית יושבת בקצה השמאלי
        return leftmost > rightmost
    except Exception:
        return None
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def report() -> int:
    """מדפיס את מה שצריך כדי לאבחן בעיות תצוגה. מחזיר קוד יציאה."""
    from . import __version__, config

    print(f"KidTime {__version__}")
    print(f"Python:    {sys.version.split()[0]}  ({sys.executable})")
    print(f"מערכת:     {sys.platform}")

    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        print(f"Tk:        {tk.TkVersion}  (Tcl {root.tk.call('info', 'patchlevel')})")
        root.destroy()
    except Exception as exc:
        print(f"Tk:        לא זמין — {exc}")
        return 1

    ordered = tk_reorders_hebrew()
    if ordered is None:
        print("עברית:     לא הצלחתי לבדוק")
    elif ordered:
        print("עברית:     ✓ מסודרת נכון (מימין לשמאל)")
    else:
        print("עברית:     ✗ מוצגת הפוכה — Tk לא מסדר טקסט דו-כיווני")

    print(f"נתונים:    {config.home_dir()}")
    return 0
