"""שעון קטן וצף שמלווה את הילד/ה בזמן השימוש (וגם בזמן השבתה)."""
from __future__ import annotations

import tkinter as tk

from . import theme
from .config import fmt_clock

# צבע שלא מופיע בעיצוב — Windows הופך אותו לשקוף, וכך פינות הגלולה
# באמת עגולות ולא יושבות על ריבוע אפור.
MAGIC = "#ff00fe"


class Hud:
    """גלולה צפה בראש המסך: כמה זמן נשאר, סיום מוקדם ובקשת תוספת."""

    def __init__(self, app):
        self.app = app
        self.visible = False
        self._flash_ticks = 0

        self.win = tk.Toplevel(app.root)
        self.win.title("זמן מסך")
        self.win.configure(bg=theme.BG)
        self.win.protocol("WM_DELETE_WINDOW", lambda: None)
        self.win.withdraw()
        if not app.windowed:
            self.win.overrideredirect(True)
        self.win.attributes("-topmost", True)
        try:
            self.win.configure(bg=MAGIC)
            self.win.attributes("-transparentcolor", MAGIC)
        except tk.TclError:
            self.win.configure(bg=theme.BG)

        card = theme.Card(self.win, fill=theme.PANEL, outline=theme.LINE, radius=26,
                          padx=16, pady=9, surface=self.win["bg"], border=2)
        card.pack()
        self.card = card
        body = card.body
        self.body = body

        self.time_label = theme.label(body, "", size=18, weight="bold", bg=theme.PANEL)
        self.time_label.pack(side="right", padx=(10, 0))
        self.name_label = theme.label(body, "", size=12, fg=theme.MUTED, bg=theme.PANEL)
        self.name_label.pack(side="right")

        self.end_btn = theme.button(body, "סיום", self.app.end_session_early,
                                    bg=theme.PANEL2, fg=theme.TEXT, size=11,
                                    padx=14, pady=6)
        self.end_btn.pack(side="left", padx=(14, 0))
        self.request_btn = theme.button(
            body, "בקשה", lambda: self.app.lock.open_request(self.app.session_child_id()),
            bg=theme.ACCENT, size=11, padx=14, pady=6,
        )
        self.request_btn.pack(side="left", padx=(6, 0))
        self.parent_btn = theme.button(body, "🔒", self.app.open_parent, bg=theme.PANEL2,
                                       fg=theme.TEXT, size=11, padx=11, pady=6)
        self.parent_btn.pack(side="left", padx=(6, 0))

        # גרירה: אפשר להזיז את הפס אם הוא מסתיר משהו
        for widget in (card, body, self.time_label, self.name_label):
            widget.bind("<Button-1>", self._drag_start)
            widget.bind("<B1-Motion>", self._drag)
        self._drag_origin = (0, 0)
        self._moved_by_hand = False
        self._placed_width = 0

    # -------------------------------------------------------------- מיקום
    def _place(self) -> None:
        """ממרכז את הגלולה בראש המסך, לפי הרוחב האמיתי של התוכן."""
        self.card._sync()          # הכרטיס מודד את עצמו מחדש כאן ועכשיו
        self.win.update_idletasks()
        width = self.win.winfo_reqwidth()
        screen = self.win.winfo_screenwidth()
        self._placed_width = width
        self.win.geometry(f"+{max(0, (screen - width) // 2)}+14")

    def _recenter(self) -> None:
        """הטקסט משתנה כל שנייה ואיתו הרוחב. מי שגרר את הפס — שלו נשאר."""
        if self._moved_by_hand or not self.visible:
            return
        if abs(self.win.winfo_reqwidth() - self._placed_width) > 8:
            self._place()

    def _drag_start(self, event) -> None:
        self._drag_origin = (event.x_root - self.win.winfo_x(),
                             event.y_root - self.win.winfo_y())

    def _drag(self, event) -> None:
        self._moved_by_hand = True
        self.win.geometry(
            f"+{event.x_root - self._drag_origin[0]}+{event.y_root - self._drag_origin[1]}")

    # ------------------------------------------------------------ הצגה/עדכון
    def show(self, mode: str = "session") -> None:
        session = mode == "session"
        for button in (self.end_btn, self.request_btn):
            if session:
                button.pack(side="left", padx=(6, 0))
            else:
                button.pack_forget()
        if not self.visible:
            self.visible = True
            self.win.deiconify()
            self._place()
        self.win.attributes("-topmost", True)
        self.win.lift()

    def hide(self) -> None:
        if self.visible:
            self.visible = False
            self.win.withdraw()

    def update_session(self, name: str, remaining: float, paused: bool) -> None:
        color = theme.TEXT
        if remaining <= 60:
            color = theme.DANGER
        elif remaining <= 300:
            color = theme.WARN
        self.time_label.configure(text=fmt_clock(remaining), fg=color)
        self.name_label.configure(text=f"{name} · " + ("מושהה" if paused else "נותרו"))
        if self._flash_ticks:
            self._flash_ticks -= 1
            self.card.outline(color if self._flash_ticks % 2 else theme.LINE)
        else:
            self.card.outline(theme.LINE)
        self._recenter()

    def update_disabled(self, until_text: str) -> None:
        self.time_label.configure(text=until_text, fg=theme.OK)
        self.name_label.configure(text="המערכת מושבתת עד")
        self._recenter()

    def flash(self, seconds: int = 8) -> None:
        self._flash_ticks = seconds
