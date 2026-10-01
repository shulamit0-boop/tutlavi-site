"""אשף ההגדרה הראשונה: קוד הורים, הילדים, והמייל להתראות.

זה המסך הראשון שהורה רואה אחרי ההתקנה. שלושה שלבים קצרים, כל אחד בעמוד
משלו, עם אפשרות לחזור אחורה. המייל הוא השלב היחיד שאפשר לדלג עליו —
את השאר המערכת צריכה כדי לעבוד.
"""
from __future__ import annotations

import tkinter as tk
import webbrowser

from . import theme
from .config import CREDIT

APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords"
TWO_STEP_URL = "https://myaccount.google.com/signinoptions/twosv"

STEPS = ("קוד הורים", "הילדים", "מייל להתראות")


class SetupWizard:
    """נפתח בהפעלה הראשונה. אי אפשר לסגור אותו בלי לקבוע קוד."""

    def __init__(self, app, on_done):
        self.app = app
        self.store = app.store
        self.on_done = on_done
        self.step = 0
        app.modal_open = True

        self.win = tk.Toplevel(app.root)
        self.win.title("KidTime · הגדרה ראשונה")
        self.win.configure(bg=theme.BG, padx=0, pady=0)
        self.win.resizable(False, False)
        self.win.attributes("-topmost", True)
        self.win.protocol("WM_DELETE_WINDOW", lambda: None)

        card = theme.Card(self.win, fill=theme.PANEL, radius=28, padx=36, pady=22,
                          surface=theme.BG)
        card.pack(padx=18, pady=(16, 6))
        self.card = card.body

        self.dots = tk.Frame(self.card, bg=theme.PANEL)
        self.dots.pack(anchor="e")
        self.title = theme.label(self.card, "", size=23, weight="bold", bg=theme.PANEL)
        self.title.pack(anchor="e", pady=(8, 0))
        self.subtitle = theme.label(self.card, "", size=12, fg=theme.MUTED,
                                    bg=theme.PANEL, justify="right")
        self.subtitle.pack(anchor="e", pady=(4, 14))

        self.pages = tk.Frame(self.card, bg=theme.PANEL)
        self.pages.pack(fill="x")
        self.page_frames = [self._page_pin(), self._page_children(), self._page_mail()]

        self.error = theme.label(self.card, "", size=12, fg=theme.DANGER, bg=theme.PANEL,
                                 justify="right")
        self.error.pack(anchor="e", pady=(8, 6))

        self.nav = tk.Frame(self.card, bg=theme.PANEL)
        self.nav.pack(fill="x")
        self.next_btn = theme.button(self.nav, "הבא", self.next, bg=theme.ACCENT,
                                     size=14, padx=30, pady=12)
        self.next_btn.pack(side="right")
        self.skip_btn = theme.button(self.nav, "דילוג — בלי מייל", self.skip_mail,
                                     bg=theme.PANEL2, fg=theme.MUTED, size=12, padx=18)
        self.back_btn = theme.button(self.nav, "חזרה", self.back, bg=theme.PANEL2,
                                     fg=theme.MUTED, size=12, padx=18)

        theme.label(self.win, CREDIT, size=9, fg=theme.MUTED,
                    bg=theme.BG).pack(pady=(0, 8))

        self.win.bind("<Return>", self._on_return)
        self._show(0)
        self._center()
        theme.show_modal(self.win, self.pin)

    # ------------------------------------------------------------- עמודים
    def _field_label(self, parent, text: str, pady=(0, 0)) -> None:
        theme.label(parent, text, size=13, weight="bold",
                    bg=theme.PANEL).pack(anchor="e", pady=pady)

    def _note(self, parent, text: str, pady=(4, 0)) -> tk.Label:
        note = theme.label(parent, text, size=11, fg=theme.MUTED, bg=theme.PANEL,
                           justify="right")
        note.pack(anchor="e", pady=pady)
        return note

    def _page_pin(self) -> tk.Frame:
        page = tk.Frame(self.pages, bg=theme.PANEL)
        self._field_label(page, "קוד הורים (4 ספרות ומעלה)")
        self.pin = theme.entry(page, show="•", width=20, size=16, justify="center")
        self.pin.pack(anchor="e", pady=(6, 14), ipady=4)
        self._field_label(page, "שוב, לאימות")
        self.pin2 = theme.entry(page, show="•", width=20, size=16, justify="center")
        self.pin2.pack(anchor="e", pady=(6, 0), ipady=4)
        self._note(page, "את הקוד לא משתפים עם הילדים. הוא פותח את פאנל ההורים.",
                   pady=(12, 0))
        return page

    def _page_children(self) -> tk.Frame:
        page = tk.Frame(self.pages, bg=theme.PANEL)
        self._field_label(page, "שמות הילדים — שם בכל שורה")
        self.names = tk.Text(
            page, width=32, height=5, bg=theme.PANEL2, fg=theme.TEXT,
            insertbackground=theme.ACCENT, relief="flat", bd=0, highlightthickness=2,
            highlightbackground=theme.PANEL2, highlightcolor=theme.ACCENT,
            font=theme.font(13, "normal", page), padx=10, pady=8,
        )
        self.names.pack(anchor="e", pady=(6, 2))
        theme.rtl_preview(self.names.master, self.names, pady=(0, 14))
        for kid in self.store.children:
            self.names.insert("end", kid["name"] + "\n")

        row = tk.Frame(page, bg=theme.PANEL)
        row.pack(anchor="e")
        theme.label(row, "דקות מסך ליום לכל ילד/ה:", size=13, weight="bold",
                    bg=theme.PANEL).pack(side="right")
        self.minutes = theme.entry(row, width=6, size=14, justify="center")
        self.minutes.insert(0, str(self.store.cfg("daily_minutes")))
        self.minutes.pack(side="right", padx=(10, 0), ipady=3)
        self._note(page, "אפשר לשנות אחר כך, גם לכל ילד/ה בנפרד.", pady=(10, 0))
        return page

    def _page_mail(self) -> tk.Frame:
        page = tk.Frame(self.pages, bg=theme.PANEL)
        self._field_label(page, "כתובת Gmail שלכם")
        self.mail_address = theme.entry(page, width=32, size=13, justify="left")
        self.mail_address.insert(0, str(self.store.cfg("mail_to") or ""))
        self.mail_address.pack(anchor="e", pady=(5, 10), ipady=3)

        self._field_label(page, "סיסמת אפליקציה (16 אותיות)")
        self.mail_password = theme.entry(page, show="•", width=32, size=13, justify="left")
        self.mail_password.pack(anchor="e", pady=(5, 3), ipady=3)
        self._note(page, "זו לא הסיסמה הרגילה של המייל. היא נשמרת מוצפנת, רק במחשב הזה.",
                   pady=(0, 8))

        help_card = theme.Card(page, fill=theme.tint(theme.ACCENT, 0.94), radius=18,
                               padx=16, pady=10, surface=theme.PANEL)
        help_card.pack(fill="x", pady=(6, 0))
        fill = theme.tint(theme.ACCENT, 0.94)
        body = help_card.body
        theme.label(body, "איך משיגים סיסמת אפליקציה? (שתי דקות)", size=12,
                    weight="bold", bg=fill).pack(anchor="e")
        for line in (
            "הכפתור הסגול פותח דף של Google. כותבים KidTime ולוחצים על יצירה.",
            "מעתיקים את 16 האותיות ומדביקים בשדה למעלה.",
            "כתוב שהאפשרות לא זמינה? קודם מפעילים אימות דו-שלבי בכפתור הלבן.",
        ):
            theme.label(body, line, size=11, fg=theme.MUTED, bg=fill).pack(
                anchor="e", pady=(3, 0))
        links = tk.Frame(body, bg=fill)
        links.pack(anchor="e", pady=(8, 0))
        theme.button(links, "פתיחת דף סיסמאות האפליקציה",
                     lambda: self._open(APP_PASSWORDS_URL), bg=theme.ACCENT,
                     size=11, padx=14, pady=7).pack(side="right", padx=(0, 6))
        theme.button(links, "הפעלת אימות דו-שלבי", lambda: self._open(TWO_STEP_URL),
                     bg=theme.PANEL, fg=theme.TEXT, size=11, padx=14,
                     pady=7).pack(side="right")

        row = tk.Frame(page, bg=theme.PANEL)
        row.pack(anchor="e", pady=(10, 0))
        theme.button(row, "שליחת מייל בדיקה", self.test_mail, bg=theme.PANEL2,
                     fg=theme.TEXT, size=12, padx=16, pady=8).pack(side="right")
        self.mail_status = theme.label(row, "", size=11, fg=theme.MUTED, bg=theme.PANEL)
        self.mail_status.pack(side="right", padx=(0, 12))
        return page

    # ------------------------------------------------------------- ניווט
    def _show(self, step: int) -> None:
        self.step = step
        for index, frame in enumerate(self.page_frames):
            if index == step:
                frame.pack(fill="x")
            else:
                frame.pack_forget()

        for widget in self.dots.winfo_children():
            widget.destroy()
        for index, name in enumerate(STEPS):
            active = index == step
            done = index < step
            color = theme.ACCENT if active else (theme.OK if done else theme.MUTED)
            text = f"✓ {name}" if done else f"{index + 1}. {name}"
            theme.label(self.dots, text, size=11, weight="bold" if active else "normal",
                        fg=color, bg=theme.PANEL).pack(side="right", padx=(0, 16))

        titles = (
            ("ברוכים הבאים!", "שלושה צעדים קצרים ואפשר להתחיל. קודם — קוד הורים."),
            ("מי הילדים?", "לכל ילד/ה יהיה אריח משלו במסך הנעילה, עם זמן משלו."),
            ("מייל להתראות",
             "כל בקשת זמן מגיעה אליכם למייל, ומאשרים מהטלפון. לא חובה."),
        )
        self.title.configure(text=titles[step][0])
        self.subtitle.configure(text=titles[step][1])
        self.error.configure(text="")

        last = step == len(STEPS) - 1
        self.next_btn.configure(text="סיום והפעלה" if last else "הבא")
        self.back_btn.pack_forget()
        self.skip_btn.pack_forget()
        if last:
            self.skip_btn.pack(side="left")
        if step > 0:
            self.back_btn.pack(side="left", padx=(0, 8))

        focus = (self.pin, self.names, self.mail_address)[step]
        try:
            focus.focus_set()
        except tk.TclError:
            pass
        if self.win.winfo_ismapped():
            self._center()          # כל עמוד בגובה אחר — שלא יגלוש מתחתית המסך

    def _center(self) -> None:
        self.win.update_idletasks()
        width, height = self.win.winfo_reqwidth(), self.win.winfo_reqheight()
        x = max(0, (self.win.winfo_screenwidth() - width) // 2)
        y = max(0, (self.win.winfo_screenheight() - height) // 2 - 20)
        self.win.geometry(f"+{x}+{y}")

    def _on_return(self, event) -> None:
        if event.widget is self.names:
            return                  # אנטר בתיבת השמות = שורה חדשה
        self.next()

    def next(self) -> None:
        checks = (self._check_pin, self._check_children)
        if self.step < len(checks):
            problem = checks[self.step]()
            if problem:
                self.error.configure(text=problem)
                return
            self._show(self.step + 1)
            return
        self.submit()

    def back(self) -> None:
        if self.step > 0:
            self._show(self.step - 1)

    def skip_mail(self) -> None:
        self.mail_address.delete(0, "end")
        self.mail_password.delete(0, "end")
        self.submit()

    def _open(self, url: str) -> None:
        # שהדפדפן יוכל לעלות מעל האשף
        self.win.attributes("-topmost", False)
        webbrowser.open(url)

    # ------------------------------------------------------------ בדיקות
    def _check_pin(self) -> str:
        pin = self.pin.get().strip()
        if len(pin) < 4:
            return "הקוד חייב להיות באורך 4 ספרות לפחות."
        if pin != self.pin2.get().strip():
            return "שני הקודים לא זהים."
        return ""

    def _wanted_children(self) -> list[str]:
        return [line.strip() for line in self.names.get("1.0", "end").splitlines()
                if line.strip()]

    def _minutes(self) -> int | None:
        try:
            minutes = int(self.minutes.get().strip())
        except ValueError:
            return None
        return minutes if 1 <= minutes <= 1440 else None

    def _check_children(self) -> str:
        if not self._wanted_children():
            return "צריך להוסיף לפחות ילד/ה אחד/ת."
        if self._minutes() is None:
            return "מספר הדקות חייב להיות בין 1 ל-1440."
        return ""

    def _mail_values(self) -> tuple[str, str]:
        address = self.mail_address.get().strip()
        password = "".join(self.mail_password.get().split())
        return address, password

    def _check_mail(self) -> str:
        address, password = self._mail_values()
        if not address and not password:
            return ""
        if "@" not in address or "." not in address.split("@")[-1]:
            return "כתובת המייל לא נראית תקינה."
        if not password:
            return "חסרה סיסמת האפליקציה. אפשר גם ללחוץ \"דילוג\"."
        return ""

    def _apply_mail(self) -> bool:
        """שומר את פרטי המייל. אותה כתובת משמשת לשליחה, לקבלה ולקריאת התשובות."""
        address, password = self._mail_values()
        if not (address and password):
            return False
        self.store.set_cfg("mail_to", address)
        self.store.set_cfg("smtp_user", address)
        self.store.set_cfg("smtp_password", password)
        self.store.set_cfg("mail_enabled", True)
        return True

    # ------------------------------------------------------------- מייל
    def test_mail(self) -> None:
        problem = self._check_mail() or ("" if any(self._mail_values())
                                         else "צריך למלא כתובת וסיסמה.")
        if problem:
            self.error.configure(text=problem)
            return
        self.error.configure(text="")
        self._apply_mail()
        self.store.save()
        self.app.mail_test()
        self.mail_status.configure(text="שולח…", fg=theme.MUTED)
        self.win.after(800, self._poll_test)

    def _poll_test(self) -> None:
        if not self.win.winfo_exists():
            return
        state = self.app.mail.status()
        probe = state.get("probe")
        if probe == "running":
            self.win.after(800, self._poll_test)
            return
        if probe == "ok":
            self.mail_status.configure(text="✓ עובד! בדקו את תיבת הדואר.", fg=theme.OK)
        else:
            self.mail_status.configure(text="לא הצליח", fg=theme.DANGER)
            self.error.configure(
                text=(state.get("error") or "החיבור נכשל.")
                + "\nבדקו את הכתובת ואת הסיסמה, או לחצו \"דילוג\" והגדירו אחר כך.")

    # ------------------------------------------------------------- סיום
    def submit(self) -> None:
        for step, check in enumerate((self._check_pin, self._check_children,
                                      self._check_mail)):
            problem = check()
            if problem:
                if step != self.step:
                    self._show(step)
                self.error.configure(text=problem)
                return

        self.store.set_pin(self.pin.get().strip())
        self.store.set_cfg("daily_minutes", self._minutes())
        existing = {kid["name"] for kid in self.store.children}
        for name in self._wanted_children():
            if name not in existing:
                self.store.add_child(name)
        self._apply_mail()
        self.store.save()
        self.app.mail_changed()

        self.app.modal_open = False
        try:
            self.win.grab_release()
            self.win.destroy()
        except tk.TclError:
            pass
        self.on_done()
