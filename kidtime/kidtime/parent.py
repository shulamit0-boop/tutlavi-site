"""פאנל ההורים: אישור בקשות, הוספת זמן, השבתה זמנית, מייל והגדרות."""
from __future__ import annotations

import tkinter as tk
from datetime import datetime, timedelta

from . import theme
from .config import CREDIT, fmt_clock

# אפשרויות ההשבתה הזמנית. חמש ועשר דקות הן ל"רק רגע אחד" — עדכון
# ווינדוס, הדפסה, שיחת וידאו — בלי לפתוח את המחשב לחצי שעה.
DISABLE_OPTIONS = (
    ("5 דקות", 5), ("10 דקות", 10), ("30 דקות", 30),
    ("שעה", 60), ("שעתיים", 120), ("4 שעות", 240),
)


def _modal(app, title: str, width: int | None = None) -> tk.Toplevel:
    win = tk.Toplevel(app.root)
    win.title(title)
    win.configure(bg=theme.PANEL)
    win.resizable(False, False)
    win.attributes("-topmost", True)
    if app.lock.visible:
        win.transient(app.lock.win)
    if width:
        win.minsize(width, 1)
    return win


class PinDialog:
    """מבקש את קוד ההורים. חוסם אחרי יותר מדי טעויות."""

    def __init__(self, app, on_success, title: str = "קוד הורים"):
        self.app = app
        self.store = app.store
        self.on_success = on_success
        app.modal_open = True

        self.win = _modal(app, title)
        self.win.configure(padx=38, pady=32)
        self.win.protocol("WM_DELETE_WINDOW", self.close)

        theme.label(self.win, title, size=23, weight="bold", bg=theme.PANEL).pack(anchor="e")
        self.hint = theme.label(self.win, "מקלידים את הקוד ולוחצים אנטר.", size=12,
                                fg=theme.MUTED, bg=theme.PANEL)
        self.hint.pack(anchor="e", pady=(5, 18))

        self.entry = theme.entry(self.win, show="•", width=16, size=22, justify="center")
        self.entry.pack(anchor="e", ipady=6)
        self.error = theme.label(self.win, "", size=12, fg=theme.DANGER, bg=theme.PANEL)
        self.error.pack(anchor="e", pady=(10, 16))

        buttons = tk.Frame(self.win, bg=theme.PANEL)
        buttons.pack(anchor="e")
        theme.button(buttons, "כניסה", self.submit, bg=theme.ACCENT,
                     padx=28).pack(side="right", padx=6)
        theme.button(buttons, "ביטול", self.close, bg=theme.PANEL2,
                     fg=theme.MUTED).pack(side="right")

        self.win.bind("<Return>", lambda _e: self.submit())
        self.win.bind("<Escape>", lambda _e: self.close())
        theme.show_modal(self.win, self.entry)
        self._tick()

    def _tick(self) -> None:
        if not self.win.winfo_exists():
            return
        locked = self.store.pin_locked_for()
        if locked:
            self.error.configure(text=f"יותר מדי ניסיונות. אפשר לנסות שוב בעוד {fmt_clock(locked)}")
            self.entry.configure(state="disabled")
        else:
            self.entry.configure(state="normal")
        self.win.after(1000, self._tick)

    def submit(self) -> None:
        locked = self.store.pin_locked_for()
        if locked:
            return
        if self.store.check_pin(self.entry.get()):
            self.store.save()
            self.close(run=True)
            return
        self.store.save()
        self.entry.delete(0, "end")
        remaining = self.store.pin_locked_for()
        self.error.configure(
            text="קוד שגוי. ננעל לכמה דקות." if remaining else "קוד שגוי, נסו שוב.")

    def close(self, run: bool = False) -> None:
        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        if run:
            self.on_success()
        else:
            self.app.lock.assert_on_top()


class ParentPanel:
    """החלון שנפתח אחרי קוד נכון."""

    def __init__(self, app):
        self.app = app
        self.store = app.store
        app.modal_open = True

        self.win = _modal(app, "פאנל הורים")
        self.win.configure(padx=0, pady=0, bg=theme.BG)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        self.win.geometry("860x640")

        header = tk.Frame(self.win, bg=theme.PANEL, padx=24, pady=16)
        header.pack(fill="x")
        theme.label(header, "פאנל הורים", size=20, weight="bold",
                    bg=theme.PANEL).pack(side="right")
        theme.button(header, "סגירה", self.close, bg=theme.PANEL2, fg=theme.MUTED,
                     size=12, padx=18, pady=8).pack(side="left")

        self.tabbar = tk.Frame(self.win, bg=theme.BG, padx=16, pady=12)
        self.tabbar.pack(fill="x")
        # גוף גליל: לשונית ההגדרות ארוכה מהחלון, וכפתורי שינוי הקוד וכיבוי
        # המערכת יושבים בתחתיתה — בלי גלילה הם פשוט לא נגישים.
        holder = tk.Frame(self.win, bg=theme.BG)
        holder.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(holder, bg=theme.BG, highlightthickness=0, bd=0)
        self.scrollbar = tk.Scrollbar(
            holder, orient="vertical", command=self.canvas.yview,
            bg=theme.PANEL2, troughcolor=theme.BG, activebackground=theme.LINE,
            relief="flat", bd=0, highlightthickness=0, width=12,
        )
        self.scrollbar.pack(side="left", fill="y")      # ימין-לשמאל: הפס בצד שמאל
        self.canvas.pack(side="right", fill="both", expand=True)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.body = tk.Frame(self.canvas, bg=theme.BG, padx=24, pady=18)
        self._body_id = self.canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>", self._resize_body)
        self.canvas.bind("<Configure>", self._resize_body)
        self.canvas.bind("<Enter>", lambda _e: self._wheel(True))
        self.canvas.bind("<Leave>", lambda _e: self._wheel(False))

        self.tabs: dict[str, tuple[tk.Widget, callable]] = {}
        for key, text, builder in (
            ("requests", "בקשות", self._tab_requests),
            ("time", "זמן היום", self._tab_time),
            ("disable", "השבתה זמנית", self._tab_disable),
            ("children", "ילדים", self._tab_children),
            ("mail", "מייל", self._tab_mail),
            ("settings", "הגדרות", self._tab_settings),
        ):
            button = theme.button(self.tabbar, text, lambda k=key: self.open_tab(k),
                                  bg=theme.PANEL, fg=theme.MUTED, size=12,
                                  padx=17, pady=9)
            button.pack(side="right", padx=3)
            self.tabs[key] = (button, builder)

        self.status = theme.label(self.win, "", size=12, weight="bold", fg=theme.OK,
                                  bg=theme.BG, anchor="e", padx=24, pady=10)
        self.status.pack(fill="x")
        theme.label(self.win, CREDIT, size=9, fg=theme.MUTED, bg=theme.BG,
                    anchor="center", pady=4).pack(fill="x", side="bottom")

        self.current = None
        self.new_child_entry: tk.Entry | None = None
        self.mail_status: tk.Label | None = None
        self.open_tab("requests" if self.store.pending_requests() else "time")
        self._mail_tick()
        theme.show_modal(self.win)

    # ------------------------------------------------------------------ שלד
    def _resize_body(self, _event=None) -> None:
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        self.canvas.itemconfigure(self._body_id, width=self.canvas.winfo_width())

    def _wheel(self, enable: bool) -> None:
        """גלילה בגלגל העכבר רק כשהסמן מעל הפאנל."""
        if enable:
            self.canvas.bind_all("<MouseWheel>", self._on_wheel)
            self.canvas.bind_all("<Button-4>", self._on_wheel)
            self.canvas.bind_all("<Button-5>", self._on_wheel)
        else:
            for sequence in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
                self.canvas.unbind_all(sequence)

    def _on_wheel(self, event) -> None:
        if getattr(event, "num", None) == 4:
            step = -1
        elif getattr(event, "num", None) == 5:
            step = 1
        else:
            step = -1 if event.delta > 0 else 1
        self.canvas.yview_scroll(step, "units")

    def open_tab(self, key: str) -> None:
        self.current = key
        self.mail_status = None
        for name, (button, _builder) in self.tabs.items():
            selected = name == key
            button.configure(bg=theme.ACCENT if selected else theme.PANEL,
                             fg="#ffffff" if selected else theme.MUTED)
        for widget in self.body.winfo_children():
            widget.destroy()
        self.tabs[key][1]()
        self.canvas.yview_moveto(0)     # כל לשונית מתחילה מלמעלה
        self.body.update_idletasks()
        self._resize_body()

    def refresh(self, message: str = "") -> None:
        self.store.save()
        self.app.on_state_changed()
        if message:
            self.say(message)
        self.open_tab(self.current)

    def say(self, message: str, color: str = theme.OK) -> None:
        self.status.configure(text=message, fg=color)
        self.win.after(6000, lambda: self.status.winfo_exists()
                       and self.status.configure(text=""))

    def _section(self, title: str, subtitle: str = "") -> tk.Frame:
        theme.label(self.body, title, size=19, weight="bold", bg=theme.BG).pack(anchor="e")
        if subtitle:
            theme.label(self.body, subtitle, size=12, fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=(3, 0))
        frame = tk.Frame(self.body, bg=theme.BG)
        frame.pack(fill="both", expand=True, pady=(16, 0))
        return frame

    @staticmethod
    def _card(parent, *, fill=theme.PANEL) -> tk.Frame:
        card = theme.Card(parent, fill=fill, radius=22, padx=20, pady=16)
        card.pack(fill="x", pady=6)
        return card.body

    # -------------------------------------------------------------- בקשות
    def _tab_requests(self) -> None:
        pending = self.store.pending_requests()
        subtitle = "כל בקשה שהילדים שלחו ממסך הנעילה. אישור מוסיף את הדקות להיום."
        if self.store.mail_ready:
            subtitle += " הבקשות נשלחות גם במייל."
        frame = self._section("בקשות זמן", subtitle)
        if not pending:
            theme.label(frame, "אין בקשות ממתינות.", size=14, fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=22)
        for request in reversed(pending):
            kid = self.store.child(request["child_id"])
            color = kid["color"] if kid else theme.ACCENT
            card = self._card(frame, fill=theme.tint(color, 0.93))
            fill = theme.tint(color, 0.93)
            created = request["created_at"][11:16]
            title = f"{kid['name'] if kid else 'לא ידוע'} · {request['minutes']} דקות · {created}"
            theme.label(card, title, size=15, weight="bold", bg=fill).pack(anchor="e")
            if request["reason"]:
                theme.label(card, f"סיבה: {request['reason']}", size=12, fg=theme.MUTED,
                            bg=fill).pack(anchor="e", pady=(3, 0))
            if self.store.mail_ready:
                sent = "נשלחה במייל ✓" if request.get("mailed") else "ממתינה לשליחה במייל…"
                theme.label(card, sent, size=11, fg=theme.MUTED,
                            bg=fill).pack(anchor="e", pady=(3, 0))
            row = tk.Frame(card, bg=fill)
            row.pack(anchor="e", pady=(12, 0))
            theme.button(row, f"אישור {request['minutes']} דקות",
                         lambda r=request: self._decide(r, True), bg=theme.OK,
                         size=12, padx=16, pady=7).pack(side="right", padx=4)
            theme.button(row, "אישור 5 דקות",
                         lambda r=request: self._decide(r, True, 5), bg=theme.PANEL,
                         fg=theme.TEXT, size=12, padx=16, pady=7).pack(side="right", padx=4)
            theme.button(row, "דחייה", lambda r=request: self._decide(r, False),
                         bg=theme.PANEL, fg=theme.DANGER, size=12,
                         padx=16, pady=7).pack(side="right", padx=4)

        history = [r for r in self.store.data["requests"] if r["status"] != "pending"][-5:]
        if history:
            theme.label(frame, "בקשות אחרונות", size=13, weight="bold", fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=(20, 6))
            for request in reversed(history):
                kid = self.store.child(request["child_id"])
                mark = {"approved": "אושרה", "replaced": "הוחלפה בבקשה חדשה"}.get(
                    request["status"], "נדחתה")
                if request.get("decided_by") == "mail":
                    mark += " במייל"
                granted = request.get("granted_minutes") or request["minutes"]
                theme.label(
                    frame,
                    f"{kid['name'] if kid else '—'} · {granted} דקות · {mark}",
                    size=12, fg=theme.MUTED, bg=theme.BG,
                ).pack(anchor="e")

    def _decide(self, request: dict, approve: bool, minutes: int | None = None) -> None:
        self.store.decide_request(request["id"], approve, minutes)
        kid = self.store.child(request["child_id"])
        name = kid["name"] if kid else ""
        if approve:
            self.refresh(f"אושרו {minutes or request['minutes']} דקות ל{name}.")
        else:
            self.refresh(f"הבקשה של {name} נדחתה.")

    # ------------------------------------------------------------- זמן היום
    def _tab_time(self) -> None:
        frame = self._section("הזמן של היום",
                              "הוספה או הורדה של דקות משפיעה על היום הנוכחי בלבד.")
        if not self.store.children:
            theme.label(frame, "עדיין לא הוגדרו ילדים — לשונית \"ילדים\".", size=14,
                        fg=theme.MUTED, bg=theme.BG).pack(anchor="e", pady=22)
            return
        for kid in self.store.children:
            fill = theme.tint(kid["color"], 0.93)
            card = self._card(frame, fill=fill)
            remaining = self.store.remaining_seconds(kid["id"])
            used = self.store.used_seconds(kid["id"])
            top = tk.Frame(card, bg=fill)
            top.pack(fill="x")
            theme.label(top, kid["name"], size=16, weight="bold",
                        bg=fill, fg=kid["color"]).pack(side="right")
            theme.label(top, f"נותרו {fmt_clock(remaining)} · נוצלו {fmt_clock(used)}",
                        size=12, fg=theme.MUTED, bg=fill).pack(side="left")
            row = tk.Frame(card, bg=fill)
            row.pack(anchor="e", pady=(12, 0))
            for minutes in (5, 10, 15, 30):
                theme.button(row, f"+{minutes}",
                             lambda k=kid, m=minutes: self._grant(k, m),
                             bg=theme.PANEL, fg=theme.TEXT, size=12,
                             padx=14, pady=6).pack(side="right", padx=3)
            theme.button(row, "−5", lambda k=kid: self._grant(k, -5), bg=theme.PANEL,
                         fg=theme.TEXT, size=12, padx=14, pady=6).pack(side="right", padx=3)
            theme.button(row, "איפוס היום", lambda k=kid: self._reset_day(k),
                         bg=theme.PANEL, fg=theme.MUTED, size=12, padx=14,
                         pady=6).pack(side="right", padx=(14, 3))

    def _grant(self, kid: dict, minutes: int) -> None:
        self.store.grant_minutes(kid["id"], minutes)
        sign = "נוספו" if minutes > 0 else "הורדו"
        self.refresh(f"{sign} {abs(minutes)} דקות ל{kid['name']}.")

    def _reset_day(self, kid: dict) -> None:
        self.store.reset_today(kid["id"])
        self.refresh(f"היום של {kid['name']} אופס — המכסה המלאה חזרה.")

    # ------------------------------------------------------------- השבתה
    def _tab_disable(self) -> None:
        frame = self._section(
            "השבתה זמנית",
            "בזמן ההשבתה המחשב פתוח לגמרי ואף שעון לא רץ. המערכת חוזרת לבד בסוף.")
        until = self.store.disabled_until_dt()
        if until and until > datetime.now():
            card = self._card(frame, fill=theme.tint(theme.OK, 0.9))
            fill = theme.tint(theme.OK, 0.9)
            left = int((until - datetime.now()).total_seconds())
            theme.label(card, f"המערכת מושבתת עד {until.strftime('%H:%M')}", size=17,
                        weight="bold", fg=theme.TEXT, bg=fill).pack(anchor="e")
            theme.label(card, f"עוד {fmt_clock(left)}", size=12, fg=theme.MUTED,
                        bg=fill).pack(anchor="e", pady=(3, 0))
            theme.button(card, "החזרת המערכת עכשיו", self._enable_now, bg=theme.DANGER,
                         size=13, padx=22).pack(anchor="e", pady=(12, 0))
        else:
            card = self._card(frame)
            theme.label(card, "המערכת פעילה.", size=17, weight="bold",
                        bg=theme.PANEL).pack(anchor="e")

        theme.label(frame, "להשבית למשך", size=13, weight="bold", fg=theme.MUTED,
                    bg=theme.BG).pack(anchor="e", pady=(20, 8))
        options = tk.Frame(frame, bg=theme.BG)
        options.pack(anchor="e")
        # שלוש בשורה, מימין לשמאל — כך הכפתורים הקצרים לא נדחקים מהחלון
        for index, (label, minutes) in enumerate(DISABLE_OPTIONS):
            theme.button(options, label, lambda m=minutes: self._disable(m),
                         bg=theme.PANEL, fg=theme.TEXT, size=13, padx=20,
                         pady=11).grid(row=index // 3, column=2 - index % 3,
                                       padx=5, pady=5)
        theme.button(frame, "עד סוף היום", self._disable_rest_of_day, bg=theme.PANEL2,
                     fg=theme.TEXT, size=13, padx=20, pady=11).pack(anchor="e", pady=(10, 0))

    def _disable(self, minutes: int) -> None:
        until = self.store.disable_for(minutes)
        self.refresh(f"המערכת מושבתת עד {until.strftime('%H:%M')}.")

    def _disable_rest_of_day(self) -> None:
        now = datetime.now()
        reset_hour = int(self.store.cfg("day_reset_hour"))
        until = now.replace(hour=reset_hour, minute=0, second=0, microsecond=0)
        if until <= now:
            until += timedelta(days=1)
        self.store.disable_until(until)
        self.refresh(f"המערכת מושבתת עד {until.strftime('%H:%M')} מחר.")

    def _enable_now(self) -> None:
        self.store.enable_now()
        self.refresh("המערכת חזרה לפעול.")

    # -------------------------------------------------------------- ילדים
    def _tab_children(self) -> None:
        frame = self._section("ילדים", "מכסה ריקה = המכסה הכללית מלשונית ההגדרות.")
        for kid in self.store.children:
            fill = theme.tint(kid["color"], 0.93)
            card = self._card(frame, fill=fill)
            row = tk.Frame(card, bg=fill)
            row.pack(fill="x")
            name = theme.entry(row, width=18, size=13)
            name.insert(0, kid["name"])
            name.pack(side="right", ipady=4)
            theme.label(row, "  דקות ליום:", size=12, fg=theme.MUTED,
                        bg=fill).pack(side="right", padx=(12, 0))
            quota = theme.entry(row, width=6, size=13, justify="center")
            quota.insert(0, "" if kid.get("daily_minutes") is None else str(kid["daily_minutes"]))
            quota.pack(side="right", padx=(6, 0), ipady=4)
            theme.button(row, "שמירה",
                         lambda k=kid, n=name, q=quota: self._save_child(k, n, q),
                         bg=theme.PANEL, fg=theme.TEXT, size=12,
                         padx=14, pady=6).pack(side="left", padx=4)
            for field in (name, quota):
                field.bind("<Return>",
                           lambda _e, k=kid, n=name, q=quota: self._save_child(k, n, q))
            theme.button(row, "מחיקה", lambda k=kid: self._remove_child(k),
                         bg=theme.PANEL, fg=theme.DANGER, size=12,
                         padx=14, pady=6).pack(side="left")

        add = self._card(frame)
        theme.label(add, "הוספת ילד/ה", size=14, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        row = tk.Frame(add, bg=theme.PANEL)
        row.pack(anchor="e", pady=(10, 0))
        new_name = theme.entry(row, width=18, size=13)
        new_name.pack(side="right", ipady=4)
        self.new_child_entry = new_name
        theme.button(row, "הוספה", lambda: self._add_child(new_name), bg=theme.ACCENT,
                     size=12, padx=18, pady=6).pack(side="left", padx=(10, 0))
        new_name.bind("<Return>", lambda _e: self._add_child(new_name))
        new_name.focus_set()

    def _save_child(self, kid: dict, name_entry: tk.Entry, quota_entry: tk.Entry) -> None:
        raw = quota_entry.get().strip()
        minutes: int | None = None
        if raw:
            try:
                minutes = max(0, int(raw))
            except ValueError:
                self.say("המכסה חייבת להיות מספר דקות.", theme.DANGER)
                return
        self.store.rename_child(kid["id"], name_entry.get())
        self.store.set_child_quota(kid["id"], minutes)
        self.refresh("נשמר.")

    def _add_child(self, entry: tk.Entry) -> None:
        try:
            kid = self.store.add_child(entry.get())
        except ValueError:
            self.say("צריך למלא שם.", theme.DANGER)
            return
        self.refresh(f"{kid['name']} נוסף/ה.")

    def _remove_child(self, kid: dict) -> None:
        Confirm(self.app, f"למחוק את {kid['name']}?",
                "היסטוריית השימוש שלו/ה תישאר, אבל השם ייעלם ממסך הנעילה.",
                lambda: self._do_remove(kid))

    def _do_remove(self, kid: dict) -> None:
        if self.app.session_child_id() == kid["id"]:
            self.app.end_session("child_removed")
        self.store.remove_child(kid["id"])
        self.refresh(f"{kid['name']} נמחק/ה.")

    # ---------------------------------------------------------------- מייל
    def _tab_mail(self) -> None:
        frame = self._section(
            "אישור בקשות במייל",
            "כל בקשת זמן תישלח לכתובת שלכם, עם כפתורי אישור ודחייה ללחיצה מהטלפון.")

        card = self._card(frame, fill=theme.tint(theme.ACCENT, 0.94))
        fill = theme.tint(theme.ACCENT, 0.94)
        theme.label(card, "איך מחברים", size=14, weight="bold", bg=fill).pack(anchor="e")
        # כל שורה עומדת בפני עצמה: טקסט מעורב עברית-אנגלית שנשבר באמצע
        # משפט מתהפך על המסך וקשה לקריאה.
        for line in (
            "1. בחשבון Google מפעילים אימות דו-שלבי.",
            "2. יוצרים סיסמת אפליקציה בת 16 אותיות ומדביקים כאן.",
            "3. אפשר לכתוב את אותה כתובת בשני השדות הראשונים.",
        ):
            theme.label(card, line, size=12, fg=theme.MUTED,
                        bg=fill).pack(anchor="e", pady=(6, 0))
        theme.label(card, "הסיסמה נשמרת מוצפנת, רק במחשב הזה. אפשר לבטל אותה בכל רגע ב-Google.",
                    size=11, fg=theme.MUTED, bg=fill).pack(anchor="e", pady=(10, 0))

        self.mail_fields: dict[str, tk.Entry] = {}
        for key, text, hidden in (
            ("mail_to", "המייל שלכם — לשם נשלחות הבקשות", False),
            ("smtp_user", "התיבה שממנה נשלח ונקרא (אפשר אותה כתובת)", False),
            ("smtp_password", "סיסמת האפליקציה של התיבה הזו", True),
        ):
            row = self._card(frame)
            theme.label(row, text, size=13, weight="bold",
                        bg=theme.PANEL).pack(anchor="e")
            field = theme.entry(row, width=34, size=13, justify="left",
                                show="•" if hidden else None)
            field.insert(0, str(self.store.cfg(key) or ""))
            field.pack(anchor="e", pady=(8, 0), ipady=5)
            self.mail_fields[key] = field

        card = self._card(frame)
        self.mail_enabled = tk.BooleanVar(value=bool(self.store.cfg("mail_enabled")))
        theme.toggle(card, "לשלוח בקשות למייל ולקבל אישורים משם",
                     self.mail_enabled, size=13).pack(anchor="e")

        row = tk.Frame(frame, bg=theme.BG)
        row.pack(anchor="e", pady=(16, 0))
        theme.button(row, "שמירה", self._save_mail, bg=theme.ACCENT,
                     size=13, padx=24).pack(side="right", padx=4)
        theme.button(row, "שליחת מייל בדיקה", self._test_mail, bg=theme.PANEL,
                     fg=theme.TEXT, size=13, padx=20).pack(side="right", padx=4)

        self.mail_status = theme.label(frame, "", size=12, fg=theme.MUTED, bg=theme.BG,
                                       justify="right")
        self.mail_status.pack(anchor="e", pady=(14, 0))
        self._render_mail_status()

        advanced = self._card(frame)
        theme.label(advanced, "שרתים (לשנות רק אם אינכם ב-Gmail)", size=12,
                    weight="bold", fg=theme.MUTED, bg=theme.PANEL).pack(anchor="e")
        grid = tk.Frame(advanced, bg=theme.PANEL)
        grid.pack(anchor="e", pady=(8, 0))
        self.mail_servers: dict[str, tk.Entry] = {}
        for column, (key, text, width) in enumerate((
            ("smtp_host", "SMTP", 18), ("smtp_port", "פורט", 5),
            ("imap_host", "IMAP", 18), ("imap_port", "פורט", 5),
        )):
            holder = tk.Frame(grid, bg=theme.PANEL)
            holder.grid(row=column // 2, column=column % 2, padx=6, pady=4, sticky="e")
            theme.label(holder, text, size=11, fg=theme.MUTED,
                        bg=theme.PANEL).pack(anchor="e")
            field = theme.entry(holder, width=width, size=12, justify="left")
            field.insert(0, str(self.store.cfg(key) or ""))
            field.pack(anchor="e")
            self.mail_servers[key] = field

    def _save_mail(self) -> None:
        for key, field in self.mail_fields.items():
            self.store.set_cfg(key, field.get().strip())
        for key, field in self.mail_servers.items():
            raw = field.get().strip()
            if key.endswith("_port"):
                try:
                    raw = int(raw)
                except ValueError:
                    self.say("הפורט חייב להיות מספר.", theme.DANGER)
                    return
            self.store.set_cfg(key, raw)
        wanted = bool(self.mail_enabled.get())
        self.store.set_cfg("mail_enabled", wanted)
        self.store.save()
        self.app.mail_changed()
        if wanted and not self.store.mail_ready:
            self.say("חסרים פרטים — צריך את שתי הכתובות ואת הסיסמה.", theme.WARN)
        else:
            self.say("הגדרות המייל נשמרו." if wanted else "שליחת המיילים כבויה.")
        self.open_tab("mail")

    def _test_mail(self) -> None:
        self._save_mail()
        if not (self.store.cfg("mail_to") and self.store.cfg("smtp_user")
                and self.store.cfg("smtp_password")):
            self.say("צריך למלא את שתי הכתובות ואת הסיסמה.", theme.DANGER)
            return
        self.app.mail_test()
        self.say("שולח מייל בדיקה…", theme.MUTED)

    def _render_mail_status(self) -> None:
        if not (self.mail_status and self.mail_status.winfo_exists()):
            return
        state = self.app.mail.status()
        probe = state.get("probe")
        if probe == "running":
            text, color = "בודק…", theme.MUTED
        elif probe == "ok":
            text, color = "החיבור עובד — המייל נשלח והתיבה נקראת.", theme.OK
        elif probe == "send-failed":
            text, color = f"השליחה נכשלה: {state.get('error') or 'שגיאה'}", theme.DANGER
        elif probe == "read-failed":
            text = f"המייל נשלח, אבל אי אפשר לקרוא מהתיבה: {state.get('error') or 'שגיאה'}"
            color = theme.DANGER
        elif state.get("error"):
            text, color = f"תקלה אחרונה: {state['error']}", theme.WARN
        elif self.store.mail_ready:
            text, color = "פעיל. בקשות חדשות יישלחו למייל.", theme.OK
        else:
            text, color = "כבוי. הבקשות מופיעות רק כאן בפאנל.", theme.MUTED
        self.mail_status.configure(text=text, fg=color)

    def _mail_tick(self) -> None:
        """מרענן את שורת הסטטוס בזמן שהבדיקה רצה ברקע."""
        if not self.win.winfo_exists():
            return
        if self.current == "mail":
            self._render_mail_status()
        self.win.after(1200, self._mail_tick)

    # ------------------------------------------------------------- הגדרות
    def _tab_settings(self) -> None:
        frame = self._section("הגדרות", "שינויים נשמרים מיד.")
        self._number_row(frame, "מכסה יומית לכל ילד/ה (דקות)", "daily_minutes", 1, 1440)
        self._number_row(frame, "שעת תחילת יום חדש", "day_reset_hour", 0, 23)
        self._number_row(frame, "עצירת השעון אחרי חוסר פעילות (שניות)",
                         "idle_pause_seconds", 15, 3600)
        self._number_row(frame, "תקרה לבקשת זמן של ילד/ה (דקות)", "max_request_minutes", 1, 600)
        self._number_row(frame, "חלון בטיחות אחרי הדלקת המחשב (שניות)", "grace_seconds", 0, 900)
        self._number_row(frame, "זמן פתוח אחרי הגדרה/השהיה (דקות)", "setup_grace_minutes", 0, 240)

        card = self._card(frame)
        theme.label(card, "רמת אכיפה", size=14, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.enforcement = tk.StringVar(value=self.store.cfg("enforcement"))
        for value, text in (
            ("lock_screen", "מסך נעילה בלבד (מומלץ)"),
            ("workstation_lock", "מסך נעילה + נעילת חשבון Windows"),
        ):
            theme.choice(card, text, value, self.enforcement,
                         self._save_enforcement).pack(anchor="e", pady=3)

        card = self._card(frame)
        for key, text in (
            ("media_keeps_clock", "וידאו ושמע נחשבים שימוש — השעון לא נעצר בזמן צפייה"),
            ("hide_taskbar", "הסתרת שורת המשימות בזמן נעילה"),
            ("block_hotkeys", "חסימת Win / Alt+Tab / Alt+F4 בזמן נעילה"),
        ):
            var = tk.BooleanVar(value=bool(self.store.cfg(key)))
            theme.toggle(card, text, var,
                         lambda k=key, v=var: self._save_flag(k, v)).pack(anchor="e", pady=3)

        row = tk.Frame(frame, bg=theme.BG)
        row.pack(anchor="e", pady=(20, 0))
        theme.button(row, "שינוי קוד הורים", lambda: ChangePin(self.app, self),
                     bg=theme.PANEL, fg=theme.TEXT, size=13,
                     padx=20).pack(side="right", padx=4)
        theme.button(row, "כיבוי המערכת", self._quit, bg=theme.DANGER,
                     size=13, padx=20).pack(side="right", padx=4)

    def _number_row(self, parent, text: str, key: str, low: int, high: int) -> None:
        card = self._card(parent)
        theme.label(card, text, size=13, bg=theme.PANEL).pack(side="right")
        entry = theme.entry(card, width=6, size=13, justify="center")
        entry.insert(0, str(self.store.cfg(key)))
        entry.pack(side="left", padx=(10, 0), ipady=4)
        theme.button(card, "שמירה",
                     lambda: self._save_number(key, entry, low, high, text),
                     bg=theme.PANEL2, fg=theme.TEXT, size=12,
                     padx=14, pady=6).pack(side="left", padx=(8, 0))
        entry.bind("<Return>", lambda _e: self._save_number(key, entry, low, high, text))

    def _save_number(self, key: str, entry: tk.Entry, low: int, high: int, text: str) -> None:
        try:
            value = int(entry.get().strip())
        except ValueError:
            self.say(f"\"{text}\" — צריך מספר שלם.", theme.DANGER)
            return
        if not low <= value <= high:
            self.say(f"\"{text}\" — ערך בין {low} ל-{high}.", theme.DANGER)
            return
        self.store.set_cfg(key, value)
        self.refresh("ההגדרה נשמרה.")

    def _save_enforcement(self) -> None:
        self.store.set_cfg("enforcement", self.enforcement.get())
        self.store.save()
        self.say("רמת האכיפה עודכנה.")

    def _save_flag(self, key: str, var: tk.BooleanVar) -> None:
        self.store.set_cfg(key, bool(var.get()))
        self.store.save()
        self.app.on_state_changed()
        self.say("ההגדרה נשמרה.")

    def _quit(self) -> None:
        Confirm(self.app, "לכבות את מערכת זמן המסך?",
                "המחשב ייפתח לגמרי עד ההפעלה הבאה של המערכת.",
                self.app.shutdown)

    # ----------------------------------------------------------------- סגירה
    def close(self) -> None:
        self.store.save_if_dirty()
        self._wheel(False)
        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        self.app.on_state_changed()
        self.app.lock.assert_on_top()


class Confirm:
    """אישור פעולה בשני כפתורים."""

    def __init__(self, app, title: str, body: str, on_yes):
        self.app = app
        self.on_yes = on_yes
        self.win = _modal(app, title)
        self.win.configure(padx=34, pady=28)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        theme.label(self.win, title, size=18, weight="bold", bg=theme.PANEL).pack(anchor="e")
        theme.label(self.win, body, size=12, fg=theme.MUTED, bg=theme.PANEL,
                    justify="right").pack(anchor="e", pady=(8, 20))
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.button(row, "כן", self._yes, bg=theme.ACCENT, padx=26).pack(side="right", padx=6)
        theme.button(row, "ביטול", self.close, bg=theme.PANEL2,
                     fg=theme.MUTED).pack(side="right")
        self.win.bind("<Escape>", lambda _e: self.close())
        theme.show_modal(self.win)

    def _yes(self) -> None:
        self.close()
        self.on_yes()

    def close(self) -> None:
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass


class ChangePin:
    """החלפת קוד ההורים — דורש את הקוד הנוכחי."""

    def __init__(self, app, panel: ParentPanel | None = None):
        self.app = app
        self.store = app.store
        self.panel = panel
        self.win = _modal(app, "שינוי קוד הורים")
        self.win.configure(padx=34, pady=30)
        self.win.protocol("WM_DELETE_WINDOW", self.close)

        theme.label(self.win, "שינוי קוד הורים", size=20, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.fields = {}
        for key, text in (("current", "הקוד הנוכחי"), ("new", "קוד חדש (4 ספרות ומעלה)"),
                          ("again", "שוב, לאימות")):
            theme.label(self.win, text, size=12, fg=theme.MUTED,
                        bg=theme.PANEL).pack(anchor="e", pady=(14, 5))
            field = theme.entry(self.win, show="•", width=18, size=15, justify="center")
            field.pack(anchor="e", ipady=5)
            self.fields[key] = field

        self.error = theme.label(self.win, "", size=12, fg=theme.DANGER, bg=theme.PANEL)
        self.error.pack(anchor="e", pady=(12, 14))
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.button(row, "שמירה", self.submit, bg=theme.ACCENT,
                     padx=26).pack(side="right", padx=6)
        theme.button(row, "ביטול", self.close, bg=theme.PANEL2,
                     fg=theme.MUTED).pack(side="right")
        self.win.bind("<Return>", lambda _e: self.submit())
        theme.show_modal(self.win, self.fields["current"])

    def submit(self) -> None:
        if not self.store.check_pin(self.fields["current"].get()):
            self.store.save()
            self.error.configure(text="הקוד הנוכחי שגוי.")
            return
        new = self.fields["new"].get().strip()
        if new != self.fields["again"].get().strip():
            self.error.configure(text="שני הקודים החדשים לא זהים.")
            return
        try:
            self.store.set_pin(new)
        except ValueError as exc:
            self.error.configure(text=str(exc))
            return
        self.store.save()
        self.close()
        if self.panel:
            self.panel.say("קוד ההורים הוחלף.")

    def close(self) -> None:
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
