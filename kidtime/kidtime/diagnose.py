"""בדיקת סביבה: האם Tk שבמחשב הזה מסדר עברית מימין לשמאל.

ל-Tk אין תמיכה מובנית ב-bidi בכל הגרסאות. במקום לנחש לפי מספר גרסה,
שואלים את Tk עצמו: מציירים מילה עברית ובודקים איזו אות יצאה בקצה השמאלי.
"""
from __future__ import annotations

import sys

PROBE_WORD = "אבגד"     # ארבע אותיות, בלי רווחים ובלי ניקוד


def tk_reorders_hebrew() -> bool | None:
    """``True`` אם Tk כאן מסדר עברית בעצמו, ``False`` אם לא, ``None`` אם אי אפשר לבדוק.

    עוטף את ``theme.detect_direction`` כדי שתהיה בדיקה אחת בלבד במערכת —
    זו שהממשק באמת פועל לפיה.
    """
    try:
        import tkinter as tk

        from . import theme
    except ImportError:
        return None
    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        theme.family(root)
        theme._probed = False          # בדיקה טרייה, לא תשובה שמורה
        return not theme.detect_direction(root)
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
        print("עברית:     ✓ Tk מסדר בעצמו — נשלחים סימני כיווניות (RLE/PDF)")
    else:
        print("עברית:     ✓ Tk לא מסדר — הטקסט נשלח אליו מסודר ויזואלית")

    if ordered is not None:
        try:
            from . import theme

            sample = "נותרו 12:34 מתוך 20:00"
            print(f"דוגמה:     {sample}")
            print(f"           → {theme.rtl(sample)!r}")
        except Exception:
            pass

    print(f"נתונים:    {config.home_dir()}")
    return 0
