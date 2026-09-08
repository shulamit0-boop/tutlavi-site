"""אשף ההתקנה הראשונה: קביעת קוד הורים והוספת הילדים."""
from __future__ import annotations

import tkinter as tk

from . import theme


class SetupWizard:
    """נפתח בהפעלה הראשונה. אי אפשר לסגור אותו בלי לקבוע קוד."""

    def __init__(self, app, on_done):
        self.app = app
        self.store = app.store
        self.on_done = on_done
        app.modal_open = True

        self.win = tk.Toplevel(app.root)
        self.win.title("הגדרה ראשונה")
        self.win.configure(bg=theme.PANEL, padx=36, pady=30)
        self.win.resizable(False, False)
        self.win.attributes("-topmost", True)
        self.win.protocol("WM_DELETE_WINDOW", lambda: None)

        theme.label(self.win, "ברוכים הבאים למערכת זמן המסך", size=20, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        theme.label(
            self.win,
            "שני דברים ואפשר להתחיל: קוד הורים ורשימת הילדים.\n"
            "הקוד הוא מה שמאפשר להוסיף זמן או להשבית את המערכת — לא לשתף אותו עם הילדים.",
            size=11, fg=theme.MUTED, bg=theme.PANEL, justify="right",
        ).pack(anchor="e", pady=(6, 22))

        theme.label(self.win, "קוד הורים (4 ספרות ומעלה)", size=12,
                    bg=theme.PANEL).pack(anchor="e")
        self.pin = theme.entry(self.win, show="•", width=20, size=15, justify="center")
        self.pin.pack(anchor="e", pady=(6, 10))
        theme.label(self.win, "שוב, לאימות", size=12, bg=theme.PANEL).pack(anchor="e")
        self.pin2 = theme.entry(self.win, show="•", width=20, size=15, justify="center")
        self.pin2.pack(anchor="e", pady=(6, 20))

        theme.label(self.win, "שמות הילדים — שם בכל שורה", size=12,
                    bg=theme.PANEL).pack(anchor="e")
        self.names = tk.Text(
            self.win, width=32, height=5, bg=theme.PANEL2, fg=theme.TEXT,
            insertbackground=theme.TEXT, relief="flat", bd=0, highlightthickness=1,
            highlightbackground=theme.LINE, font=theme.font(13, "normal", self.win),
        )
        self.names.pack(anchor="e", pady=(6, 6))
        for kid in self.store.children:
            self.names.insert("end", kid["name"] + "\n")

        minutes_row = tk.Frame(self.win, bg=theme.PANEL)
        minutes_row.pack(anchor="e", pady=(10, 18))
        theme.label(minutes_row, "דקות ליום לכל ילד/ה:", size=12,
                    bg=theme.PANEL).pack(side="right")
        self.minutes = theme.entry(minutes_row, width=6, size=13, justify="center")
        self.minutes.insert(0, str(self.store.cfg("daily_minutes")))
        self.minutes.pack(side="right", padx=(8, 0))

        self.error = theme.label(self.win, "", size=11, fg=theme.ACCENT, bg=theme.PANEL)
        self.error.pack(anchor="e", pady=(0, 12))
        theme.button(self.win, "סיום והפעלה", self.submit, bg=theme.ACCENT,
                     size=13).pack(anchor="e")

        theme.show_modal(self.win, self.pin)

    def submit(self) -> None:
        pin = self.pin.get().strip()
        if pin != self.pin2.get().strip():
            self.error.configure(text="שני הקודים לא זהים.")
            return
        try:
            self.store.set_pin(pin)
        except ValueError as exc:
            self.error.configure(text=str(exc))
            return
        try:
            minutes = int(self.minutes.get().strip())
            if not 1 <= minutes <= 1440:
                raise ValueError
        except ValueError:
            self.error.configure(text="מספר הדקות חייב להיות בין 1 ל-1440.")
            return
        self.store.set_cfg("daily_minutes", minutes)

        wanted = [line.strip() for line in self.names.get("1.0", "end").splitlines()
                  if line.strip()]
        if not wanted:
            self.error.configure(text="צריך להוסיף לפחות ילד/ה אחד/ת.")
            return
        existing = {kid["name"] for kid in self.store.children}
        for name in wanted:
            if name not in existing:
                self.store.add_child(name)
        self.store.save()

        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        self.on_done()
