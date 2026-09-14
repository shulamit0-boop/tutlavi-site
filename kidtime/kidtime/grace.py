"""חלון הבטיחות — הדרך של המבוגרים להיכנס לפני שהמסך ננעל.

מופיע אחרי כל הדלקה של המחשב, לפני שהקיוסק נדלק: שורת המשימות במקומה,
המקשים פתוחים, ואפשר לעצור את הנעילה או להשהות אותה. נועד למנוע בדיוק את
המצב שבו המערכת נועלת את הבית ואין דרך חזרה.
"""
from __future__ import annotations

import tkinter as tk

from . import theme
from .config import fmt_clock


class GraceWindow:
    """חלון קטן עם ספירה לאחור, "נעל עכשיו" ו"השהיה למבוגרים"."""

    def __init__(self, app):
        self.app = app
        self.remaining = 0
        self.visible = False

        self.win = tk.Toplevel(app.root)
        self.win.title("מערכת זמן המסך")
        self.win.configure(bg=theme.PANEL, padx=30, pady=24)
        self.win.resizable(False, False)
        self.win.protocol("WM_DELETE_WINDOW", self.app.end_grace)
        self.win.withdraw()

        theme.label(self.win, "מערכת זמן המסך עולה", size=18, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        theme.label(
            self.win,
            "זה החלון שמאפשר להורים להיכנס לפני שהמסך ננעל.\n"
            "המחשב פתוח לגמרי כרגע — שורת המשימות והמקשים עובדים.",
            size=11, fg=theme.MUTED, bg=theme.PANEL, justify="right",
        ).pack(anchor="e", pady=(6, 16))

        self.countdown = theme.label(self.win, "", size=15, weight="bold",
                                     fg=theme.WARN, bg=theme.PANEL)
        self.countdown.pack(anchor="e", pady=(0, 16))

        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.button(row, "השהיה למבוגרים", self.pause, bg=theme.OK,
                     size=12).pack(side="right", padx=6)
        theme.button(row, "נעל עכשיו", self.app.end_grace, bg=theme.PANEL2,
                     size=12).pack(side="right")

    # ------------------------------------------------------------------ תצוגה
    def show(self, seconds: int) -> None:
        self.remaining = max(1, int(seconds))
        self._render()
        if not self.visible:
            self.visible = True
            self.win.deiconify()
            self.win.update_idletasks()
            width, height = self.win.winfo_reqwidth(), self.win.winfo_reqheight()
            x = max(0, (self.win.winfo_screenwidth() - width) // 2)
            y = max(0, (self.win.winfo_screenheight() - height) // 3)
            self.win.geometry(f"+{x}+{y}")
        self.win.attributes("-topmost", True)
        self.win.lift()

    def hide(self) -> None:
        if self.visible:
            self.visible = False
            self.win.withdraw()

    def tick(self) -> int:
        """מוריד שנייה ומחזיר כמה נשאר. אפס = הזמן נגמר."""
        self.remaining = max(0, self.remaining - 1)
        self._render()
        return self.remaining

    def _render(self) -> None:
        self.countdown.configure(
            text=f"הנעילה תתחיל בעוד {fmt_clock(self.remaining)}",
            fg=theme.ACCENT if self.remaining <= 10 else theme.WARN,
        )

    # ----------------------------------------------------------------- השהיה
    def pause(self) -> None:
        """דורש קוד הורים ואז משאיר את המחשב פתוח לפרק זמן."""
        from .parent import PinDialog

        if not self.app.store.has_pin:
            self._apply_pause()
            return
        PinDialog(self.app, self._apply_pause, "קוד הורים — השהיית הנעילה")

    def _apply_pause(self) -> None:
        minutes = int(self.app.store.cfg("setup_grace_minutes"))
        until = self.app.store.disable_for(minutes)
        self.app.store.save()
        self.hide()
        self.app.on_state_changed()
        self.app.toast(f"המערכת מושהית עד {until.strftime('%H:%M')}", theme.OK, 6)
