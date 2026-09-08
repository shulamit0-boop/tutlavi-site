"""מסך הנעילה — המסך הראשי שאליו המערכת תמיד חוזרת."""
from __future__ import annotations

import tkinter as tk
from datetime import datetime

from . import theme, winsys
from .config import fmt_clock

WEEKDAYS = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]
MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי",
          "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def hebrew_date(moment: datetime) -> str:
    return f"יום {WEEKDAYS[moment.weekday()]}, {moment.day} ב{MONTHS[moment.month - 1]}"


class LockScreen:
    """חלון מסך-מלא, תמיד עליון, שמכסה את כל שולחן העבודה."""

    def __init__(self, app):
        self.app = app
        self.store = app.store
        self.visible = False
        self._tiles: dict[str, dict] = {}
        self._message_until = 0.0

        self.win = tk.Toplevel(app.root)
        self.win.title("זמן מסך")
        self.win.configure(bg=theme.BG)
        self.win.protocol("WM_DELETE_WINDOW", lambda: None)
        self.win.withdraw()
        self._build()

    # ------------------------------------------------------------------ בנייה
    def _build(self) -> None:
        outer = tk.Frame(self.win, bg=theme.BG)
        outer.pack(fill="both", expand=True)
        center = tk.Frame(outer, bg=theme.BG)
        center.place(relx=0.5, rely=0.5, anchor="center")
        self.center = center

        head = tk.Frame(center, bg=theme.BG)
        head.pack(pady=(0, 26))
        self.clock_label = theme.label(head, "", size=52, weight="bold", bg=theme.BG)
        self.clock_label.pack()
        self.date_label = theme.label(head, "", size=14, fg=theme.MUTED, bg=theme.BG)
        self.date_label.pack(pady=(2, 0))

        self.title_label = theme.label(center, "מי משתמש/ת במחשב?", size=22, bg=theme.BG)
        self.title_label.pack(pady=(0, 20))

        self.tiles_frame = tk.Frame(center, bg=theme.BG)
        self.tiles_frame.pack()

        self.message_label = theme.label(center, "", size=14, fg=theme.WARN, bg=theme.BG)
        self.message_label.pack(pady=(22, 0))

        footer = tk.Frame(center, bg=theme.BG)
        footer.pack(pady=(24, 0))
        self.parent_btn = theme.button(
            footer, "🔒  הורים", self.app.open_parent, bg=theme.PANEL, size=13,
            active=theme.PANEL2,
        )
        self.parent_btn.pack(side="right", padx=6)
        theme.button(
            footer, "בקשת זמן נוסף", lambda: self.open_request(None), bg=theme.PANEL,
            size=13, active=theme.PANEL2,
        ).pack(side="right", padx=6)

        self.hint_label = theme.label(
            center, "לוחצים על השם כדי להתחיל. השעון נעצר כשלא נוגעים במחשב.",
            size=11, fg=theme.MUTED, bg=theme.BG,
        )
        self.hint_label.pack(pady=(18, 0))

    # -------------------------------------------------------------- הצגה/הסתרה
    def show(self) -> None:
        if not self.visible:
            self.visible = True
            self._apply_geometry()   # לפני deiconify — אחרת Windows ממסגר את החלון
            self.win.deiconify()
            self.refresh()
        self.assert_on_top()

    def hide(self) -> None:
        if self.visible:
            self.visible = False
            self.win.withdraw()

    def _apply_geometry(self) -> None:
        if self.app.windowed:
            self.win.geometry("1100x760")
            return
        rect = winsys.virtual_screen_rect()
        if rect[2] and rect[3]:
            self.win.overrideredirect(True)
            self.win.geometry(f"{rect[2]}x{rect[3]}+{rect[0]}+{rect[1]}")
        else:
            self.win.attributes("-fullscreen", True)
        self.win.attributes("-topmost", True)

    def assert_on_top(self) -> None:
        """נקראת כל שנייה — מחזירה את החלון לחזית אם משהו קפץ מעליו."""
        if not self.visible or self.app.windowed:
            return
        try:
            self.win.attributes("-topmost", True)
            if self.app.modal_open:
                return  # דיאלוג פתוח מעלינו — לא מכסים אותו
            self.win.lift()
            winsys.force_foreground(self.win.winfo_id())
            if self.win.winfo_viewable():
                self.win.focus_force()
        except tk.TclError:
            pass

    # ------------------------------------------------------------------ תוכן
    def refresh(self) -> None:
        """בונה מחדש את אריחי הילדים (אחרי שינוי ברשימה)."""
        for widget in self.tiles_frame.winfo_children():
            widget.destroy()
        self._tiles.clear()

        children = self.store.children
        if not children:
            theme.label(
                self.tiles_frame, "עדיין לא הוגדרו ילדים.\nלוחצים על \"הורים\" כדי להוסיף.",
                size=15, fg=theme.MUTED, bg=theme.BG, justify="center",
            ).pack(pady=30)
            return

        per_row = 4 if len(children) > 3 else max(1, len(children))
        for index, kid in enumerate(children):
            self._tiles[kid["id"]] = self._build_tile(kid, index // per_row, index % per_row)
        self.tick()

    def _build_tile(self, kid: dict, row: int, column: int) -> dict:
        frame = tk.Frame(self.tiles_frame, bg=theme.PANEL, cursor="hand2",
                         highlightthickness=1, highlightbackground=theme.LINE)
        frame.grid(row=row, column=column, padx=10, pady=10, sticky="n")

        canvas = tk.Canvas(frame, width=170, height=170, bg=theme.PANEL,
                           highlightthickness=0, bd=0)
        canvas.pack(padx=22, pady=(22, 6))
        minutes = canvas.create_text(85, 80, text="", fill=theme.TEXT,
                                     font=theme.font(34, "bold", frame))
        unit = canvas.create_text(85, 112, text="דקות נותרו", fill=theme.MUTED,
                                  font=theme.font(10, "normal", frame))

        name = theme.label(frame, kid["name"], size=18, weight="bold", bg=theme.PANEL)
        name.pack(pady=(0, 2))
        status = theme.label(frame, "", size=11, fg=theme.MUTED, bg=theme.PANEL)
        status.pack(pady=(0, 20))

        tile = {"frame": frame, "canvas": canvas, "minutes": minutes, "unit": unit,
                "name": name, "status": status, "kid": kid}
        for widget in (frame, canvas, name, status):
            widget.bind("<Button-1>", lambda _event, cid=kid["id"]: self._pick(cid))
        frame.bind("<Enter>", lambda _e, f=frame: f.configure(highlightbackground=kid["color"]))
        frame.bind("<Leave>", lambda _e, f=frame: f.configure(highlightbackground=theme.LINE))
        return tile

    def _pick(self, child_id: str) -> None:
        if self.store.remaining_seconds(child_id) < 30:
            self.open_request(child_id)
            return
        self.app.start_session(child_id)

    def tick(self) -> None:
        """עדכון שעון, זמנים שנותרו וטבעות — נקרא כל שנייה."""
        now = datetime.now()
        self.clock_label.configure(text=now.strftime("%H:%M"))
        self.date_label.configure(text=hebrew_date(now))

        pending = len(self.store.pending_requests())
        self.parent_btn.configure(
            text=f"🔒  הורים  ({pending})" if pending else "🔒  הורים",
            fg=theme.WARN if pending else theme.TEXT,
        )

        for child_id, tile in self._tiles.items():
            remaining = self.store.remaining_seconds(child_id, now)
            quota = max(1, self.store.quota_seconds(child_id)
                        + self.store.bonus_seconds(child_id, now))
            color = tile["kid"]["color"] if remaining else theme.LINE
            theme.ring(tile["canvas"], 85, 85, 62, remaining / quota, color)
            tile["canvas"].tag_raise(tile["minutes"])
            tile["canvas"].tag_raise(tile["unit"])
            if remaining:
                tile["canvas"].itemconfigure(
                    tile["minutes"], text=fmt_clock(remaining), fill=theme.TEXT)
                tile["canvas"].itemconfigure(tile["unit"], text="נותרו היום")
                tile["name"].configure(fg=theme.TEXT)
                tile["status"].configure(text="לוחצים כדי להתחיל", fg=theme.MUTED)
            else:
                tile["canvas"].itemconfigure(tile["minutes"], text="0:00", fill=theme.MUTED)
                tile["canvas"].itemconfigure(tile["unit"], text="נגמר הזמן")
                tile["name"].configure(fg=theme.MUTED)
                tile["status"].configure(text="בקשת זמן נוסף ›", fg=theme.ACCENT)

        if self._message_until and now.timestamp() > self._message_until:
            self._message_until = 0.0
            self.message_label.configure(text="")

    def message(self, text: str, color: str = theme.WARN, seconds: int = 8) -> None:
        self.message_label.configure(text=text, fg=color)
        self._message_until = datetime.now().timestamp() + seconds

    # ---------------------------------------------------------------- בקשות
    def open_request(self, child_id: str | None) -> None:
        if not self.store.children:
            self.message("קודם צריך להוסיף ילד/ה בפאנל ההורים.")
            return
        RequestDialog(self.app, child_id)


class RequestDialog:
    """דיאלוג "בקשת זמן נוסף" — נשמר כבקשה ממתינה לאישור הורה."""

    def __init__(self, app, child_id: str | None):
        self.app = app
        self.store = app.store
        app.modal_open = True

        self.win = tk.Toplevel(app.root)
        self.win.title("בקשת זמן נוסף")
        self.win.configure(bg=theme.PANEL, padx=30, pady=26)
        if app.lock.visible:
            self.win.transient(app.lock.win)
        self.win.resizable(False, False)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        self.win.attributes("-topmost", True)

        theme.label(self.win, "בקשת זמן נוסף", size=20, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        theme.label(self.win, "הבקשה תופיע להורים. אפשר לקרוא להם עכשיו.",
                    size=11, fg=theme.MUTED, bg=theme.PANEL).pack(anchor="e", pady=(4, 18))

        theme.label(self.win, "מי מבקש/ת?", size=12, bg=theme.PANEL).pack(anchor="e")
        self.child_var = tk.StringVar()
        kids = self.store.children
        chosen = next((k for k in kids if k["id"] == child_id), kids[0])
        self.child_var.set(chosen["id"])
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e", pady=(6, 16))
        for kid in kids:
            tk.Radiobutton(
                row, text=kid["name"], value=kid["id"], variable=self.child_var,
                bg=theme.PANEL, fg=theme.TEXT, selectcolor=theme.PANEL2,
                activebackground=theme.PANEL, activeforeground=theme.TEXT,
                font=theme.font(12, "normal", row), bd=0, highlightthickness=0,
            ).pack(side="right", padx=4)

        theme.label(self.win, "כמה דקות?", size=12, bg=theme.PANEL).pack(anchor="e")
        self.minutes_var = tk.IntVar(value=10)
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e", pady=(6, 16))
        cap = int(self.store.cfg("max_request_minutes"))
        for minutes in (5, 10, 15, 20, 30):
            if minutes > cap:
                continue
            tk.Radiobutton(
                row, text=f"{minutes}", value=minutes, variable=self.minutes_var,
                bg=theme.PANEL, fg=theme.TEXT, selectcolor=theme.PANEL2,
                activebackground=theme.PANEL, activeforeground=theme.TEXT,
                font=theme.font(12, "normal", row), bd=0, highlightthickness=0,
            ).pack(side="right", padx=4)

        theme.label(self.win, "למה? (לא חובה)", size=12, bg=theme.PANEL).pack(anchor="e")
        self.reason = theme.entry(self.win, width=34)
        self.reason.pack(anchor="e", pady=(6, 20))

        buttons = tk.Frame(self.win, bg=theme.PANEL)
        buttons.pack(anchor="e")
        theme.button(buttons, "שליחת הבקשה", self.submit, bg=theme.ACCENT,
                     active="#d93a3a").pack(side="right", padx=6)
        theme.button(buttons, "ביטול", self.close, bg=theme.PANEL2).pack(side="right")

        self.win.bind("<Return>", lambda _e: self.submit())
        self.win.bind("<Escape>", lambda _e: self.close())
        theme.show_modal(self.win, self.reason)

    def submit(self) -> None:
        child_id = self.child_var.get()
        self.store.create_request(child_id, self.minutes_var.get(), self.reason.get())
        self.store.save()
        kid = self.store.child(child_id)
        self.close()
        self.app.lock.message(
            f"הבקשה של {kid['name']} נשלחה. אפשר לקרוא לאבא או לאמא.", theme.OK, 12)

    def close(self) -> None:
        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        self.app.lock.assert_on_top()
