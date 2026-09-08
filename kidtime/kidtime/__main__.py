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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="kidtime", description="מגביל זמן מסך לילדים")
    parser.add_argument("--windowed", action="store_true",
                        help="מצב פיתוח: חלון רגיל, בלי מסך מלא ובלי חסימת מקשים")
    parser.add_argument("--status", action="store_true", help="הדפסת מצב הזמנים ויציאה")
    parser.add_argument("--reset-pin", metavar="PIN", help="איפוס קוד ההורים (דורש מנהל)")
    parser.add_argument("--restore-taskbar", action="store_true",
                        help="החזרת שורת המשימות אם המערכת נסגרה באמצע")
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
    if args.reset_pin:
        return _reset_pin(args.reset_pin)

    from .app import KidTimeApp, SingleInstance

    guard = SingleInstance()
    if not guard.acquired:
        logging.getLogger("kidtime").info("מופע נוסף כבר רץ — יוצאים")
        return 0

    app = KidTimeApp(windowed=args.windowed)
    try:
        app.run()
    finally:
        app.set_kiosk(False)
        winsys.set_taskbar_visible(True)
        guard.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
