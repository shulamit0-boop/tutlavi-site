"""מסך הנעילה — המסך הראשי שאליו המערכת תמיד חוזרת."""
from __future__ import annotations

import logging
import tkinter as tk
from datetime import datetime

from . import theme, winsys
from .config import CREDIT, fmt_clock

log = logging.getLogger("kidtime.lockscreen")

WEEKDAYS = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]
MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי",
          "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]

TILE = 168        # קוטר הטבעת באריח ילד/ה


def hebrew_date(moment: datetime) -> str:
    return f"יום {WEEKDAYS[moment.weekday()]}, {moment.day} ב{MONTHS[moment.month - 1]}"


class LockScreen:
    """חלון מסך-מלא, תמיד עליון, שמכסה את כל שולחן העבודה."""

    def __init__(self, app):
        self.app = app
        self.store = app.store
        self.visible = False
        self._tiles: dict[str, dict] = {}
        self._signature: tuple = ()
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
        # קרדיט זעיר בפינה. טקסט בלבד ולא קישור — קישור שפותח תוכנת דואר
        # היה פותח לילדים דלת החוצה ממסך הנעילה.
        theme.label(outer, CREDIT, size=9, fg=theme.mix(theme.MUTED, theme.BG, 0.35),
                    bg=theme.BG).place(relx=0.5, rely=1.0, y=-10, anchor="s")
        center = tk.Frame(outer, bg=theme.BG)
        center.place(relx=0.5, rely=0.5, anchor="center")
        self.center = center

        head = tk.Frame(center, bg=theme.BG)
        head.pack(pady=(0, 22))
        self.clock_label = theme.label(head, "", size=60, weight="bold", bg=theme.BG)
        self.clock_label.pack()
        self.date_label = theme.label(head, "", size=15, fg=theme.MUTED, bg=theme.BG)
        self.date_label.pack(pady=(2, 0))

        self.title_label = theme.label(center, "מי משתמש/ת במחשב?", size=26,
                                       weight="bold", bg=theme.BG)
        self.title_label.pack(pady=(0, 24))

        self.tiles_frame = tk.Frame(center, bg=theme.BG)
        self.tiles_frame.pack()

        self.message_label = theme.label(center, "", size=15, weight="bold",
                                         fg=theme.WARN, bg=theme.BG)
        self.message_label.pack(pady=(24, 0))

        footer = tk.Frame(center, bg=theme.BG)
        footer.pack(pady=(26, 0))
        self.parent_btn = theme.button(
            footer, "🔒  הורים", self.app.open_parent, bg=theme.PANEL, fg=theme.TEXT,
            size=14, padx=26, pady=13, active=theme.PANEL2,
        )
        self.parent_btn.pack(side="right", padx=7)
        theme.button(
            footer, "בקשת זמן נוסף", lambda: self.open_request(None), bg=theme.ACCENT,
            size=14, padx=26, pady=13,
        ).pack(side="right", padx=7)

        self.hint_label = theme.label(
            center, "לוחצים על השם כדי להתחיל. השעון נעצר כשלא נוגעים במחשב.",
            size=12, fg=theme.MUTED, bg=theme.BG,
        )
        self.hint_label.pack(pady=(20, 0))

    # -------------------------------------------------------------- הצגה/הסתרה
    def show(self) -> None:
        if not self.visible:
            self.visible = True
            self._apply_geometry()   # לפני deiconify — אחרת Windows ממסגר את החלון
            self.win.deiconify()
            self.refresh()
            try:
                self.win.focus_set()
            except tk.TclError:
                pass
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
        """מחזירה את החלון לחזית — אבל רק כשהוא באמת איבד אותה.

        קודם זה רץ כל שנייה בלי תנאי: ``lift`` + ``-topmost`` + ``focus_force``,
        גם כשהחלון כבר היה בחזית. שינוי בערימת החלונות או בפוקוס באמצע לחיצה
        מבטל את הלחיצה ב-Tk — הכפתור נלחץ ולא קורה כלום. עכשיו, כל עוד אנחנו
        בחזית, לא נוגעים בחלון בכלל.
        """
        if not self.visible or self.app.windowed or self.app.modal_open:
            return
        try:
            hwnd = self.win.winfo_id()
        except tk.TclError:
            return
        if winsys.is_foreground(hwnd):
            return
        try:
            self.win.attributes("-topmost", True)
            self.win.lift()
            winsys.force_foreground(hwnd)
        except tk.TclError:
            pass

    # ------------------------------------------------------------------ תוכן
    def _signature_now(self) -> tuple:
        return tuple((kid["id"], kid["name"], kid["color"]) for kid in self.store.children)

    def refresh(self) -> None:
        """בונה מחדש את אריחי הילדים (אחרי שינוי ברשימה)."""
        for widget in self.tiles_frame.winfo_children():
            widget.destroy()
        self._tiles.clear()
        self._signature = self._signature_now()

        children = self.store.children
        if not children:
            theme.label(
                self.tiles_frame, "עדיין לא הוגדרו ילדים.\nלוחצים על \"הורים\" כדי להוסיף.",
                size=16, fg=theme.MUTED, bg=theme.BG, justify="center",
            ).pack(pady=30)
            return

        per_row = 4 if len(children) > 3 else max(1, len(children))
        for index, kid in enumerate(children):
            self._tiles[kid["id"]] = self._build_tile(kid, index // per_row, index % per_row)
        self.tick()

    def _build_tile(self, kid: dict, row: int, column: int) -> dict:
        """אריח ילד/ה: כרטיס עגול בגוון אישי, עם טבעת זמן במרכז."""
        soft = theme.tint(kid["color"])
        frame = theme.Card(self.tiles_frame, fill=soft, outline=soft, radius=32,
                           padx=26, pady=24, surface=theme.BG, border=3)
        frame.grid(row=row, column=column, padx=11, pady=11, sticky="n")
        frame.configure(cursor="hand2")
        body = frame.body

        canvas = tk.Canvas(body, width=TILE, height=TILE, bg=soft,
                           highlightthickness=0, bd=0)
        canvas.pack(pady=(0, 10))
        minutes = canvas.create_text(TILE / 2, TILE / 2 - 12, text="", fill=theme.TEXT,
                                     font=theme.font(34, "bold", body))
        unit = canvas.create_text(TILE / 2, TILE / 2 + 24, text=theme.rtl("דקות נותרו"),
                                  fill=theme.MUTED, font=theme.font(11, "normal", body))

        name = theme.label(body, kid["name"], size=19, weight="bold", bg=soft)
        name.pack()
        status = theme.label(body, "", size=12, fg=theme.MUTED, bg=soft)
        status.pack(pady=(3, 0))

        tile = {"frame": frame, "canvas": canvas, "minutes": minutes, "unit": unit,
                "name": name, "status": status, "kid": kid}
        for widget in (frame, body, canvas, name, status):
            widget.bind("<Button-1>", lambda _event, cid=kid["id"]: self._pick(cid))
            widget.bind("<Enter>", lambda _e, f=frame, c=kid["color"]: f.outline(c))
            widget.bind("<Leave>", lambda _e, f=frame, s=soft: f.outline(s))
        return tile

    def _pick(self, child_id: str) -> None:
        log.info("נלחץ אריח של %s", child_id)
        if self.store.remaining_seconds(child_id) < 30:
            self.open_request(child_id)
            return
        self.app.start_session(child_id)

    def tick(self) -> None:
        """עדכון שעון, זמנים שנותרו וטבעות — נקרא כל שנייה.

        אם רשימת הילדים השתנתה (הוספה/מחיקה/שינוי שם בפאנל ההורים) —
        בונים את האריחים מחדש, בלי לחכות לשינוי מצב.
        """
        if self._signature != self._signature_now():
            self.refresh()
            return
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
            color = tile["kid"]["color"]
            ring_color = color if remaining else theme.mix(color, "#ffffff", 0.55)
            theme.ring(tile["canvas"], TILE // 2, TILE // 2, TILE // 2 - 14,
                       remaining / quota, ring_color,
                       track=theme.mix(color, "#ffffff", 0.72))
            tile["canvas"].tag_raise(tile["minutes"])
            tile["canvas"].tag_raise(tile["unit"])
            if remaining:
                tile["canvas"].itemconfigure(
                    tile["minutes"], text=fmt_clock(remaining), fill=theme.TEXT)
                tile["canvas"].itemconfigure(tile["unit"], text=theme.rtl("נותרו היום"))
                tile["name"].configure(fg=theme.TEXT)
                tile["status"].configure(text="לוחצים כדי להתחיל", fg=theme.MUTED)
            else:
                tile["canvas"].itemconfigure(tile["minutes"], text="0:00", fill=theme.MUTED)
                tile["canvas"].itemconfigure(tile["unit"], text=theme.rtl("נגמר הזמן"))
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
        self.win.configure(bg=theme.PANEL, padx=34, pady=30)
        if app.lock.visible:
            self.win.transient(app.lock.win)
        self.win.resizable(False, False)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        self.win.attributes("-topmost", True)

        theme.label(self.win, "בקשת זמן נוסף", size=22, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        subtitle = ("הבקשה תישלח להורים במייל, והם יוכלו לאשר מהטלפון."
                    if self.store.mail_ready else
                    "הבקשה תופיע להורים. אפשר לקרוא להם עכשיו.")
        theme.label(self.win, subtitle, size=12, fg=theme.MUTED,
                    bg=theme.PANEL).pack(anchor="e", pady=(5, 20))

        theme.label(self.win, "מי מבקש/ת?", size=13, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.child_var = tk.StringVar()
        kids = self.store.children
        chosen = next((k for k in kids if k["id"] == child_id), kids[0])
        self.child_var.set(chosen["id"])
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e", pady=(8, 18))
        for kid in kids:
            theme.choice(row, kid["name"], kid["id"], self.child_var).pack(
                side="right", padx=5)

        theme.label(self.win, "כמה דקות?", size=13, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.minutes_var = tk.IntVar(value=10)
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e", pady=(8, 18))
        cap = int(self.store.cfg("max_request_minutes"))
        for minutes in (5, 10, 15, 20, 30):
            if minutes > cap:
                continue
            theme.choice(row, f"{minutes}", minutes, self.minutes_var).pack(
                side="right", padx=5)

        theme.label(self.win, "למה? (לא חובה)", size=13, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.reason = theme.entry(self.win, width=34)
        self.reason.pack(anchor="e", pady=(8, 2))
        theme.rtl_preview(self.win, self.reason, pady=(0, 22))

        buttons = tk.Frame(self.win, bg=theme.PANEL)
        buttons.pack(anchor="e")
        theme.button(buttons, "שליחת הבקשה", self.submit, bg=theme.ACCENT,
                     padx=24).pack(side="right", padx=6)
        theme.button(buttons, "ביטול", self.close, bg=theme.PANEL2,
                     fg=theme.MUTED).pack(side="right")

        self.win.bind("<Return>", lambda _e: self.submit())
        self.win.bind("<Escape>", lambda _e: self.close())
        theme.show_modal(self.win, self.reason)

    def submit(self) -> None:
        child_id = self.child_var.get()
        kid = self.store.child(child_id)
        wait = self.store.request_wait_seconds(child_id)
        if wait:
            self.close()
            self.app.lock.message(
                f"הבקשה של {kid['name']} כבר אצל ההורים. אפשר לשלוח בקשה חדשה "
                f"בעוד {max(1, round(wait / 60))} דקות.", theme.WARN, 12)
            return
        self.store.create_request(child_id, self.minutes_var.get(), self.reason.get())
        self.store.save()
        self.close()
        if self.store.mail_ready:
            note = f"הבקשה של {kid['name']} נשלחה להורים במייל. התשובה תגיע לכאן."
        else:
            note = f"הבקשה של {kid['name']} נשלחה. אפשר לקרוא לאבא או לאמא."
        self.app.lock.message(note, theme.OK, 12)

    def close(self) -> None:
        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        self.app.lock.assert_on_top()
