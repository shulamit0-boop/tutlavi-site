"""פאנל ההורים: אישור בקשות, הוספת זמן, השבתה זמנית והגדרות."""
from __future__ import annotations

import tkinter as tk
from datetime import datetime, timedelta

from . import theme
from .config import fmt_clock


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
        self.win.configure(padx=34, pady=28)
        self.win.protocol("WM_DELETE_WINDOW", self.close)

        theme.label(self.win, title, size=20, weight="bold", bg=theme.PANEL).pack(anchor="e")
        self.hint = theme.label(self.win, "מקלידים את הקוד ולוחצים אנטר.", size=11,
                                fg=theme.MUTED, bg=theme.PANEL)
        self.hint.pack(anchor="e", pady=(4, 16))

        self.entry = theme.entry(self.win, show="•", width=16, size=20, justify="center")
        self.entry.pack(anchor="e")
        self.error = theme.label(self.win, "", size=11, fg=theme.ACCENT, bg=theme.PANEL)
        self.error.pack(anchor="e", pady=(8, 14))

        buttons = tk.Frame(self.win, bg=theme.PANEL)
        buttons.pack(anchor="e")
        theme.button(buttons, "כניסה", self.submit, bg=theme.ACCENT,
                     active="#d93a3a").pack(side="right", padx=6)
        theme.button(buttons, "ביטול", self.close, bg=theme.PANEL2).pack(side="right")

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
        self.win.configure(padx=0, pady=0)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        self.win.geometry("820x600")

        header = tk.Frame(self.win, bg=theme.PANEL2, padx=20, pady=14)
        header.pack(fill="x")
        theme.label(header, "פאנל הורים", size=18, weight="bold",
                    bg=theme.PANEL2).pack(side="right")
        theme.button(header, "סגירה", self.close, bg=theme.PANEL, size=11,
                     padx=14, pady=6).pack(side="left")

        self.tabbar = tk.Frame(self.win, bg=theme.PANEL, padx=14, pady=10)
        self.tabbar.pack(fill="x")
        self.body = tk.Frame(self.win, bg=theme.BG, padx=22, pady=18)
        self.body.pack(fill="both", expand=True)

        self.tabs: dict[str, tuple[tk.Button, callable]] = {}
        for key, text, builder in (
            ("requests", "בקשות", self._tab_requests),
            ("time", "זמן היום", self._tab_time),
            ("disable", "השבתה זמנית", self._tab_disable),
            ("children", "ילדים", self._tab_children),
            ("settings", "הגדרות", self._tab_settings),
        ):
            button = theme.button(self.tabbar, text, lambda k=key: self.open_tab(k),
                                  bg=theme.PANEL, size=12, padx=14, pady=8)
            button.pack(side="right", padx=3)
            self.tabs[key] = (button, builder)

        self.status = theme.label(self.win, "", size=11, fg=theme.OK, bg=theme.PANEL,
                                  anchor="e", padx=20, pady=8)
        self.status.pack(fill="x")

        self.current = None
        self.open_tab("requests" if self.store.pending_requests() else "time")
        theme.show_modal(self.win)

    # ------------------------------------------------------------------ שלד
    def open_tab(self, key: str) -> None:
        self.current = key
        for name, (button, _builder) in self.tabs.items():
            selected = name == key
            button.configure(bg=theme.ACCENT if selected else theme.PANEL,
                             fg=theme.TEXT if selected else theme.MUTED)
        for widget in self.body.winfo_children():
            widget.destroy()
        self.tabs[key][1]()

    def refresh(self, message: str = "") -> None:
        self.store.save()
        self.app.on_state_changed()
        if message:
            self.say(message)
        self.open_tab(self.current)

    def say(self, message: str, color: str = theme.OK) -> None:
        self.status.configure(text=message, fg=color)
        self.win.after(6000, lambda: self.status.configure(text=""))

    def _section(self, title: str, subtitle: str = "") -> tk.Frame:
        theme.label(self.body, title, size=16, weight="bold", bg=theme.BG).pack(anchor="e")
        if subtitle:
            theme.label(self.body, subtitle, size=11, fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=(2, 0))
        frame = tk.Frame(self.body, bg=theme.BG)
        frame.pack(fill="both", expand=True, pady=(14, 0))
        return frame

    @staticmethod
    def _card(parent) -> tk.Frame:
        card = tk.Frame(parent, bg=theme.PANEL, padx=16, pady=12,
                        highlightthickness=1, highlightbackground=theme.LINE)
        card.pack(fill="x", pady=5)
        return card

    # -------------------------------------------------------------- בקשות
    def _tab_requests(self) -> None:
        pending = self.store.pending_requests()
        frame = self._section(
            "בקשות זמן", "כל בקשה שהילדים שלחו ממסך הנעילה. אישור מוסיף את הדקות להיום.")
        if not pending:
            theme.label(frame, "אין בקשות ממתינות.", size=13, fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=20)
        for request in reversed(pending):
            kid = self.store.child(request["child_id"])
            card = self._card(frame)
            created = request["created_at"][11:16]
            title = f"{kid['name'] if kid else 'לא ידוע'} · {request['minutes']} דקות · {created}"
            theme.label(card, title, size=14, weight="bold", bg=theme.PANEL).pack(anchor="e")
            if request["reason"]:
                theme.label(card, request["reason"], size=11, fg=theme.MUTED,
                            bg=theme.PANEL).pack(anchor="e", pady=(2, 0))
            row = tk.Frame(card, bg=theme.PANEL)
            row.pack(anchor="e", pady=(10, 0))
            theme.button(row, f"אישור {request['minutes']} דק'",
                         lambda r=request: self._decide(r, True), bg=theme.OK,
                         size=11, padx=14, pady=6).pack(side="right", padx=4)
            theme.button(row, "אישור 5 דק'",
                         lambda r=request: self._decide(r, True, 5), bg=theme.PANEL2,
                         size=11, padx=14, pady=6).pack(side="right", padx=4)
            theme.button(row, "דחייה", lambda r=request: self._decide(r, False),
                         bg=theme.PANEL2, size=11, padx=14, pady=6).pack(side="right", padx=4)

        history = [r for r in self.store.data["requests"] if r["status"] != "pending"][-5:]
        if history:
            theme.label(frame, "בקשות אחרונות", size=12, fg=theme.MUTED,
                        bg=theme.BG).pack(anchor="e", pady=(18, 4))
            for request in reversed(history):
                kid = self.store.child(request["child_id"])
                mark = "אושרה" if request["status"] == "approved" else "נדחתה"
                granted = request.get("granted_minutes") or request["minutes"]
                theme.label(
                    frame,
                    f"{kid['name'] if kid else '—'} · {granted} דק' · {mark}",
                    size=11, fg=theme.MUTED, bg=theme.BG,
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
            theme.label(frame, "עדיין לא הוגדרו ילדים — לשונית \"ילדים\".", size=13,
                        fg=theme.MUTED, bg=theme.BG).pack(anchor="e", pady=20)
            return
        for kid in self.store.children:
            card = self._card(frame)
            remaining = self.store.remaining_seconds(kid["id"])
            used = self.store.used_seconds(kid["id"])
            top = tk.Frame(card, bg=theme.PANEL)
            top.pack(fill="x")
            theme.label(top, kid["name"], size=15, weight="bold",
                        bg=theme.PANEL, fg=kid["color"]).pack(side="right")
            theme.label(top, f"נותרו {fmt_clock(remaining)} · נוצלו {fmt_clock(used)}",
                        size=12, fg=theme.MUTED, bg=theme.PANEL).pack(side="left")
            row = tk.Frame(card, bg=theme.PANEL)
            row.pack(anchor="e", pady=(10, 0))
            for minutes in (5, 10, 15, 30):
                theme.button(row, f"+{minutes}",
                             lambda k=kid, m=minutes: self._grant(k, m),
                             bg=theme.PANEL2, size=11, padx=12, pady=5).pack(side="right", padx=3)
            theme.button(row, "−5", lambda k=kid: self._grant(k, -5), bg=theme.PANEL2,
                         size=11, padx=12, pady=5).pack(side="right", padx=3)
            theme.button(row, "איפוס היום", lambda k=kid: self._reset_day(k),
                         bg=theme.PANEL2, size=11, padx=12, pady=5).pack(side="right", padx=(14, 3))

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
        card = self._card(frame)
        if until and until > datetime.now():
            theme.label(card, f"המערכת מושבתת עד {until.strftime('%H:%M')}", size=15,
                        weight="bold", fg=theme.OK, bg=theme.PANEL).pack(anchor="e")
            theme.button(card, "החזרת המערכת עכשיו", self._enable_now, bg=theme.ACCENT,
                         size=12).pack(anchor="e", pady=(10, 0))
        else:
            theme.label(card, "המערכת פעילה.", size=15, weight="bold",
                        bg=theme.PANEL).pack(anchor="e")

        options = tk.Frame(frame, bg=theme.BG)
        options.pack(anchor="e", pady=(16, 0))
        for label, minutes in (("30 דקות", 30), ("שעה", 60), ("שעתיים", 120), ("4 שעות", 240)):
            theme.button(options, label, lambda m=minutes: self._disable(m),
                         bg=theme.PANEL2, size=12, padx=16).pack(side="right", padx=4)
        theme.button(options, "עד סוף היום", self._disable_rest_of_day, bg=theme.PANEL2,
                     size=12, padx=16).pack(side="right", padx=4)

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
            card = self._card(frame)
            row = tk.Frame(card, bg=theme.PANEL)
            row.pack(fill="x")
            name = theme.entry(row, width=18, size=13)
            name.insert(0, kid["name"])
            name.pack(side="right")
            theme.label(row, "  דקות ליום:", size=11, fg=theme.MUTED,
                        bg=theme.PANEL).pack(side="right", padx=(12, 0))
            quota = theme.entry(row, width=6, size=13, justify="center")
            quota.insert(0, "" if kid.get("daily_minutes") is None else str(kid["daily_minutes"]))
            quota.pack(side="right", padx=(6, 0))
            theme.button(row, "שמירה",
                         lambda k=kid, n=name, q=quota: self._save_child(k, n, q),
                         bg=theme.PANEL2, size=11, padx=12, pady=5).pack(side="left", padx=4)
            theme.button(row, "מחיקה", lambda k=kid: self._remove_child(k),
                         bg=theme.PANEL2, size=11, padx=12, pady=5).pack(side="left")

        add = self._card(frame)
        theme.label(add, "הוספת ילד/ה", size=13, weight="bold", bg=theme.PANEL).pack(anchor="e")
        row = tk.Frame(add, bg=theme.PANEL)
        row.pack(anchor="e", pady=(8, 0))
        new_name = theme.entry(row, width=18, size=13)
        new_name.pack(side="right")
        theme.button(row, "הוספה", lambda: self._add_child(new_name), bg=theme.OK,
                     size=11, padx=14, pady=5).pack(side="left", padx=(10, 0))
        row.bind("<Return>", lambda _e: self._add_child(new_name))

    def _save_child(self, kid: dict, name_entry: tk.Entry, quota_entry: tk.Entry) -> None:
        raw = quota_entry.get().strip()
        minutes: int | None = None
        if raw:
            try:
                minutes = max(0, int(raw))
            except ValueError:
                self.say("המכסה חייבת להיות מספר דקות.", theme.ACCENT)
                return
        self.store.rename_child(kid["id"], name_entry.get())
        self.store.set_child_quota(kid["id"], minutes)
        self.refresh("נשמר.")

    def _add_child(self, entry: tk.Entry) -> None:
        try:
            kid = self.store.add_child(entry.get())
        except ValueError:
            self.say("צריך למלא שם.", theme.ACCENT)
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

    # ------------------------------------------------------------- הגדרות
    def _tab_settings(self) -> None:
        frame = self._section("הגדרות", "שינויים נשמרים מיד.")
        self._number_row(frame, "מכסה יומית לכל ילד/ה (דקות)", "daily_minutes", 1, 1440)
        self._number_row(frame, "שעת תחילת יום חדש", "day_reset_hour", 0, 23)
        self._number_row(frame, "עצירת השעון אחרי חוסר פעילות (שניות)",
                         "idle_pause_seconds", 15, 3600)
        self._number_row(frame, "תקרה לבקשת זמן של ילד/ה (דקות)", "max_request_minutes", 1, 600)

        card = self._card(frame)
        theme.label(card, "רמת אכיפה", size=13, weight="bold", bg=theme.PANEL).pack(anchor="e")
        self.enforcement = tk.StringVar(value=self.store.cfg("enforcement"))
        for value, text in (
            ("lock_screen", "מסך נעילה בלבד (מומלץ)"),
            ("workstation_lock", "מסך נעילה + נעילת חשבון Windows"),
        ):
            tk.Radiobutton(
                card, text=text, value=value, variable=self.enforcement,
                command=self._save_enforcement, bg=theme.PANEL, fg=theme.TEXT,
                selectcolor=theme.PANEL2, activebackground=theme.PANEL,
                activeforeground=theme.TEXT, font=theme.font(12, "normal", card),
                bd=0, highlightthickness=0, anchor="e",
            ).pack(anchor="e", pady=2)

        card = self._card(frame)
        for key, text in (
            ("hide_taskbar", "הסתרת שורת המשימות בזמן נעילה"),
            ("block_hotkeys", "חסימת Win / Alt+Tab / Alt+F4 בזמן נעילה"),
        ):
            var = tk.BooleanVar(value=bool(self.store.cfg(key)))
            tk.Checkbutton(
                card, text=text, variable=var,
                command=lambda k=key, v=var: self._save_flag(k, v),
                bg=theme.PANEL, fg=theme.TEXT, selectcolor=theme.PANEL2,
                activebackground=theme.PANEL, activeforeground=theme.TEXT,
                font=theme.font(12, "normal", card), bd=0, highlightthickness=0, anchor="e",
            ).pack(anchor="e", pady=2)

        row = tk.Frame(frame, bg=theme.BG)
        row.pack(anchor="e", pady=(16, 0))
        theme.button(row, "שינוי קוד הורים", lambda: ChangePin(self.app, self),
                     bg=theme.PANEL2, size=12).pack(side="right", padx=4)
        theme.button(row, "כיבוי המערכת", self._quit, bg=theme.ACCENT,
                     size=12).pack(side="right", padx=4)

    def _number_row(self, parent, text: str, key: str, low: int, high: int) -> None:
        card = self._card(parent)
        theme.label(card, text, size=12, bg=theme.PANEL).pack(side="right")
        entry = theme.entry(card, width=6, size=13, justify="center")
        entry.insert(0, str(self.store.cfg(key)))
        entry.pack(side="left", padx=(10, 0))
        theme.button(card, "שמירה",
                     lambda: self._save_number(key, entry, low, high, text),
                     bg=theme.PANEL2, size=11, padx=12, pady=4).pack(side="left", padx=(8, 0))
        entry.bind("<Return>", lambda _e: self._save_number(key, entry, low, high, text))

    def _save_number(self, key: str, entry: tk.Entry, low: int, high: int, text: str) -> None:
        try:
            value = int(entry.get().strip())
        except ValueError:
            self.say(f"\"{text}\" — צריך מספר שלם.", theme.ACCENT)
            return
        if not low <= value <= high:
            self.say(f"\"{text}\" — ערך בין {low} ל-{high}.", theme.ACCENT)
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
        self.win.configure(padx=30, pady=24)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        theme.label(self.win, title, size=16, weight="bold", bg=theme.PANEL).pack(anchor="e")
        theme.label(self.win, body, size=11, fg=theme.MUTED, bg=theme.PANEL,
                    justify="right").pack(anchor="e", pady=(6, 18))
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.button(row, "כן", self._yes, bg=theme.ACCENT).pack(side="right", padx=6)
        theme.button(row, "ביטול", self.close, bg=theme.PANEL2).pack(side="right")
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
        self.win.configure(padx=30, pady=26)
        self.win.protocol("WM_DELETE_WINDOW", self.close)

        theme.label(self.win, "שינוי קוד הורים", size=17, weight="bold",
                    bg=theme.PANEL).pack(anchor="e")
        self.fields = {}
        for key, text in (("current", "הקוד הנוכחי"), ("new", "קוד חדש (4 ספרות ומעלה)"),
                          ("again", "שוב, לאימות")):
            theme.label(self.win, text, size=11, fg=theme.MUTED,
                        bg=theme.PANEL).pack(anchor="e", pady=(12, 4))
            field = theme.entry(self.win, show="•", width=18, size=15, justify="center")
            field.pack(anchor="e")
            self.fields[key] = field

        self.error = theme.label(self.win, "", size=11, fg=theme.ACCENT, bg=theme.PANEL)
        self.error.pack(anchor="e", pady=(10, 12))
        row = tk.Frame(self.win, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.button(row, "שמירה", self.submit, bg=theme.ACCENT).pack(side="right", padx=6)
        theme.button(row, "ביטול", self.close, bg=theme.PANEL2).pack(side="right")
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
