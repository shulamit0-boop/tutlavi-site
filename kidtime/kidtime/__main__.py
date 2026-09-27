"""נקודת הכניסה: ``python -m kidtime``."""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import sys

from . import __version__, config, winsys


def _setup_logging(verbose: bool) -> None:
    handler = logging.handlers.RotatingFileHandler(
        config.log_path(), maxBytes=512_000, backupCount=2, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    root.addHandler(handler)
    if verbose:
        root.addHandler(logging.StreamHandler(sys.stderr))


def _print_status() -> int:
    from .store import Store

    store = Store()
    print(f"KidTime {__version__} · {store.path}")
    print(f"יום נוכחי: {store.today()}")
    disabled = store.disabled_until_dt()
    print(f"השבתה זמנית: {disabled.strftime('%Y-%m-%d %H:%M') if disabled else 'אין'}")
    for kid in store.children:
        print(f"  {kid['name']}: נותרו {config.fmt_clock(store.remaining_seconds(kid['id']))} "
              f"מתוך {config.fmt_clock(store.quota_seconds(kid['id']))}")
    pending = store.pending_requests()
    print(f"בקשות ממתינות: {len(pending)}")
    return 0


def _reset_pin(pin: str) -> int:
    """שחזור קוד שנשכח. דורש הרשאות מנהל כדי שילד/ה לא יוכלו להריץ."""
    if not winsys.is_admin():
        print("צריך להריץ מחלון פקודה עם הרשאות מנהל (Run as administrator).",
              file=sys.stderr)
        return 2
    from .store import Store

    store = Store()
    try:
        store.set_pin(pin)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    store.save()
    print("קוד ההורים אופס.")
    return 0


def _stop(pin: str) -> int:
    """מבקש מהמערכת הרצה להיסגר. הנעילה משתחררת מיד."""
    from .control import send_stop

    result = send_stop(pin)
    if result == "ok":
        print("המערכת נעצרה.")
        return 0
    if result == "bad-pin":
        print("קוד הורים שגוי.", file=sys.stderr)
        return 2
    if result == "not-running":
        print("לא נמצאה מערכת רצה.", file=sys.stderr)
        return 1
    print(f"תשובה לא צפויה: {result}", file=sys.stderr)
    return 1


def _confirm_uninstall() -> int:
    """חלון קוד הורים לפני הסרה. 0 = הקוד נכון, 3 = בוטל.

    בלי זה כל ילד/ה יכולים ללחוץ על "הסרה" ברשימת האפליקציות של Windows.
    """
    from .store import Store

    store = Store()
    if not store.has_pin:
        return 0

    import tkinter as tk

    from . import theme
    from .config import fmt_clock

    root = tk.Tk()
    root.title("הסרת KidTime")
    root.configure(bg=theme.PANEL, padx=36, pady=30)
    root.resizable(False, False)
    root.attributes("-topmost", True)
    result = {"code": 3}

    theme.label(root, "הסרת מערכת זמן המסך", size=20, weight="bold",
                bg=theme.PANEL).pack(anchor="e")
    theme.label(root, "כדי להסיר צריך את קוד ההורים.", size=12, fg=theme.MUTED,
                bg=theme.PANEL).pack(anchor="e", pady=(6, 16))
    field = theme.entry(root, show="•", width=16, size=20, justify="center")
    field.pack(anchor="e", ipady=5)
    error = theme.label(root, "", size=12, fg=theme.DANGER, bg=theme.PANEL)
    error.pack(anchor="e", pady=(10, 14))

    def submit() -> None:
        locked = store.pin_locked_for()
        if locked:
            error.configure(text=f"יותר מדי ניסיונות. נסו שוב בעוד {fmt_clock(locked)}")
            return
        ok = store.check_pin(field.get())
        store.save()
        if ok:
            result["code"] = 0
            root.destroy()
            return
        field.delete(0, "end")
        error.configure(text="קוד שגוי.")

    row = tk.Frame(root, bg=theme.PANEL)
    row.pack(anchor="e")
    theme.button(row, "הסרה", submit, bg=theme.DANGER, padx=26).pack(side="right", padx=6)
    theme.button(row, "ביטול", root.destroy, bg=theme.PANEL2,
                 fg=theme.MUTED).pack(side="right")
    root.bind("<Return>", lambda _e: submit())
    root.bind("<Escape>", lambda _e: root.destroy())
    root.update_idletasks()
    x = (root.winfo_screenwidth() - root.winfo_reqwidth()) // 2
    y = (root.winfo_screenheight() - root.winfo_reqheight()) // 3
    root.geometry(f"+{max(0, x)}+{max(0, y)}")
    root.after(200, field.focus_force)
    root.mainloop()
    return result["code"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="kidtime", description="מגביל זמן מסך לילדים")
    parser.add_argument("--windowed", action="store_true",
                        help="מצב פיתוח: חלון רגיל, בלי מסך מלא ובלי חסימת מקשים")
    parser.add_argument("--status", action="store_true", help="הדפסת מצב הזמנים ויציאה")
    parser.add_argument("--reset-pin", metavar="PIN", help="איפוס קוד ההורים (דורש מנהל)")
    parser.add_argument("--restore-taskbar", action="store_true",
                        help="החזרת שורת המשימות אם המערכת נסגרה באמצע")
    parser.add_argument("--stop", metavar="PIN", nargs="?", const="",
                        help="עצירת המערכת הרצה (דורש את קוד ההורים)")
    parser.add_argument("--confirm-uninstall", action="store_true",
                        help="בקשת קוד הורים לפני הסרה (משמש את סקריפט ההסרה)")
    parser.add_argument("--verbose", action="store_true", help="לוג מפורט גם למסך")
    parser.add_argument("--version", action="version", version=f"KidTime {__version__}")
    args = parser.parse_args(argv)

    _setup_logging(args.verbose)

    if args.restore_taskbar:
        winsys.set_taskbar_visible(True)
        print("שורת המשימות הוחזרה.")
        return 0
    if args.status:
        return _print_status()
    if args.confirm_uninstall:
        return _confirm_uninstall()
    if args.reset_pin:
        return _reset_pin(args.reset_pin)
    if args.stop is not None:
        return _stop(args.stop)

    from .control import SingleInstance

    guard = SingleInstance()
    if not guard.acquired:
        logging.getLogger("kidtime").info("מופע נוסף כבר רץ — יוצאים")
        return 0

    from .app import KidTimeApp

    app = KidTimeApp(windowed=args.windowed, guard=guard)
    try:
        app.run()
    finally:
        app.set_kiosk(False)
        winsys.set_taskbar_visible(True)
        guard.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
