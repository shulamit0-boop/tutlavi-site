"""הלב של KidTime: מצבי המערכת, ספירת הזמן ואכיפת הנעילה."""
from __future__ import annotations

import logging
import time
import tkinter as tk
from datetime import datetime

from . import theme, winsys
from .config import fmt_clock
from .control import SingleInstance  # noqa: F401  — מיוצא מכאן לתאימות לאחור
from .grace import GraceWindow
from .hud import Hud
from .lockscreen import LockScreen
from .mailer import MailBridge, build_request_mail, build_test_mail
from .parent import Notice, ParentPanel, PinDialog
from .setup_wizard import SetupWizard
from .store import Store

log = logging.getLogger("kidtime.app")

LOCKED, SESSION, DISABLED, GRACE = "locked", "session", "disabled", "grace"

TICK_MS = 1000
MAX_TICK_DELTA = 10.0   # לא מחייבים יותר מזה בטיק אחד (עומס/השהיה)
SLEEP_GAP = 60.0        # פער גדול מזה = המחשב היה ישן — מסיימים סשן
SAVE_EVERY = 5          # שמירה לדיסק כל 5 טיקים, כדי שכיבוי פתאומי לא ימחק זמן
AUDIO_ON = 0.004        # עוצמת שמע שמעליה נחשב שמשהו מתנגן
MEDIA_GRACE = 25.0      # שניות של שקט לפני שמפסיקים להחשיב את זה כצפייה


class KidTimeApp:
    def __init__(self, windowed: bool = False, store: Store | None = None,
                 root: tk.Tk | None = None, guard: "SingleInstance | None" = None):
        self.windowed = windowed
        self.guard = guard
        self.setup_mode = False
        self.damaged = False
        self._stopping = False
        self.store = store or Store()
        self.modal_open = False
        self.mode: str | None = None
        self.session: dict | None = None
        self.keys = winsys.KeyBlocker()
        self._kiosk = False
        self._ticks = 0
        self.ui_activity_at = time.monotonic()
        self._media_at = 0.0
        self._toast: tk.Toplevel | None = None

        self._owns_root = root is None
        self.root = root or tk.Tk()
        if self._owns_root:
            self.root.withdraw()
            self.root.title("KidTime")
        theme.family(self.root)
        theme.detect_direction(self.root)   # לפני שנוצר טקסט כלשהו

        self.lock = LockScreen(self)
        self.hud = Hud(self)
        self.grace = GraceWindow(self)

        # גשר המייל עולה רק כשהוגדרה תיבה — מחשב בלי מייל לא פותח חוט רקע
        self.mail = MailBridge(self.store.mail_settings())
        self.mail_changed()

    # ------------------------------------------------------------------ הפעלה
    def run(self) -> None:
        self.start()
        self.root.after(TICK_MS, self._tick)
        self.root.mainloop()

    def start(self) -> None:
        """המסך הראשון: אשף, חלון בטיחות, או נעילה — לפי המצב."""
        if not self.store.has_pin:
            if self.store.was_configured:
                # היה כאן מצב קודם והוא נמחק או נפגם. פתיחת אשף כאן הייתה
                # הופכת מחיקה של קובץ אחד לעקיפה מלאה של המערכת.
                log.warning("נתוני המערכת חסרים או פגומים — נכנסים למצב נעול")
                self.damaged = True
                self.enter_locked()
                self._damaged_message()
                return
            # מחשב שעדיין לא הוגדר לא נועל את עצמו: קודם האשף, והנעילה
            # מתחילה רק אחרי שיש קוד הורים ולפחות ילד/ה אחד/ת.
            # כשכבר יש קוד — לא פותחים את האשף גם אם אין ילדים, אחרת כל מי
            # שעובר ליד המחשב יכול לקבוע קוד הורים חדש במקום הקוד הקיים.
            self.setup_mode = True
            SetupWizard(self, self._setup_finished)
            return

        seconds = int(self.store.cfg("grace_seconds"))
        if seconds > 0 and self.store.claim_boot_grace(winsys.boot_stamp()):
            self.store.save_if_dirty()
            self.enter_grace(seconds)
            return
        self.on_state_changed()

    def _setup_finished(self) -> None:
        """אחרי ההגדרה הראשונה — המחשב נשאר פתוח, שיהיה זמן להתארגן."""
        self.setup_mode = False
        minutes = int(self.store.cfg("setup_grace_minutes"))
        if minutes > 0:
            until = self.store.disable_for(minutes)
            self.store.save()
            self.on_state_changed()
            self.toast(
                f"ההגדרה הושלמה. המחשב פתוח עד {until.strftime('%H:%M')} — "
                f"הנעילה תתחיל אחר כך.", theme.OK, 10)
            return
        self.on_state_changed()

    def shutdown(self) -> None:
        """יציאה מסודרת — מפאנל ההורים או מפקודת ``--stop``."""
        self._stopping = True
        self.end_session("shutdown")
        self.set_kiosk(False)
        self.mail.stop()
        self.store.save_if_dirty()
        if not self._owns_root:
            return
        try:
            self.root.destroy()
        except tk.TclError:
            pass

    # -------------------------------------------------------------- מצבי מסך
    def on_state_changed(self) -> None:
        """נקראת אחרי כל שינוי במצב (פאנל, אשף, סוף סשן)."""
        if self.store.is_disabled():
            self.enter_disabled()
        elif self.session:
            self.enter_session()
        else:
            self.enter_locked()
        self.store.save_if_dirty()

    def enter_locked(self) -> None:
        changed = self.mode != LOCKED
        self.mode = LOCKED
        self.grace.hide()
        self.hud.hide()
        self.lock.show()
        if changed:
            self.lock.refresh()
        else:
            self.lock.tick()
        self.set_kiosk(True)

    def enter_session(self) -> None:
        self.mode = SESSION
        self.set_kiosk(False)
        self.grace.hide()
        self.lock.hide()
        self.hud.show("session")

    def enter_grace(self, seconds: int) -> None:
        """חלון בטיחות: המחשב פתוח לגמרי, עם ספירה לאחור לנעילה."""
        self.mode = GRACE
        self.set_kiosk(False)
        self.lock.hide()
        self.hud.hide()
        self.grace.show(seconds)

    def end_grace(self) -> None:
        self.grace.hide()
        self.enter_locked()

    def enter_disabled(self) -> None:
        self.mode = DISABLED
        self.set_kiosk(False)
        self.grace.hide()
        self.lock.hide()
        self.hud.show("disabled")

    def set_kiosk(self, active: bool) -> None:
        """מפעיל/מכבה את חסימת המקשים והסתרת שורת המשימות."""
        active = active and not self.windowed
        if active == self._kiosk:
            return
        self._kiosk = active
        if self.store.cfg("hide_taskbar"):
            winsys.set_taskbar_visible(not active)
        if self.store.cfg("block_hotkeys"):
            if active:
                self.keys.install()
            else:
                self.keys.uninstall()
        if not active:
            # גם אם ההגדרות השתנו באמצע — לא משאירים שורת משימות מוסתרת
            winsys.set_taskbar_visible(True)
            self.keys.uninstall()

    # --------------------------------------------------------------- סשנים
    def session_child_id(self) -> str | None:
        return self.session["child_id"] if self.session else None

    def start_session(self, child_id: str) -> None:
        kid = self.store.child(child_id)
        if not kid:
            return
        if self.store.remaining_seconds(child_id) < 30:
            self.lock.open_request(child_id)
            return
        self.session = {
            "child_id": child_id,
            "name": kid["name"],
            "mono": time.monotonic(),
            "warned": set(),
        }
        log.info("תחילת סשן: %s", kid["name"])
        self.enter_session()
        self.toast(f"שלום {kid['name']}! נותרו "
                   f"{fmt_clock(self.store.remaining_seconds(child_id))}", theme.OK)

    def end_session(self, reason: str = "manual") -> None:
        if not self.session:
            return
        log.info("סיום סשן (%s): %s", reason, self.session["name"])
        self.session = None
        self.store.save_if_dirty()

    def end_session_early(self) -> None:
        if not self.session:
            return
        name = self.session["name"]
        remaining = self.store.remaining_seconds(self.session["child_id"])
        self.end_session("early")
        self.enter_locked()
        self.lock.message(f"{name} סיים/ה. נשמרו {fmt_clock(remaining)} להמשך היום.", theme.OK)

    def _time_is_up(self) -> None:
        name = self.session["name"] if self.session else ""
        self.end_session("time_up")
        self.enter_locked()
        self.lock.message(f"הזמן של {name} להיום נגמר. אפשר לבקש תוספת מההורים.", theme.ACCENT)
        if self.store.cfg("enforcement") == "workstation_lock":
            self.root.after(400, winsys.lock_workstation)

    # ------------------------------------------------------------------ טיק
    def _tick(self) -> None:
        try:
            self._tick_once()
        except Exception:  # לא נותנים לשגיאה אחת להרוג את המערכת
            log.exception("שגיאה בטיק")
        finally:
            if not self._stopping:
                try:
                    self.root.after(TICK_MS, self._tick)
                except tk.TclError:
                    pass

    def _handle_control(self) -> None:
        """פקודת ``stop`` משורת הפקודה — נסגר רק מול קוד הורים תקין."""
        if not self.guard:
            return
        received = self.guard.poll_command()
        if not received:
            return
        conn, message = received
        try:
            if not message.startswith("stop"):
                conn.sendall(b"unknown\n")
                return
            pin = message[4:].strip()
            if not self.store.has_pin or self.store.check_pin(pin):
                conn.sendall(b"ok\n")
                log.info("עצירה לפי בקשה משורת הפקודה")
                self.shutdown()
                return
            self.store.save()
            conn.sendall(b"bad-pin\n")
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def _tick_once(self) -> None:
        self._handle_control()
        if self._stopping or self.setup_mode:
            return
        self._ticks += 1
        self._mail_pump()
        now = datetime.now()

        if self.store.is_disabled(now):
            if self.session:
                self.end_session("disabled")
            if self.mode != DISABLED:
                self.enter_disabled()
            until = self.store.disabled_until_dt()
            self.hud.update_disabled(until.strftime("%H:%M") if until else "")
            self._periodic_save()
            return

        if self.mode == DISABLED:
            self.enter_locked()
            self.lock.message("ההשבתה הסתיימה — המערכת חזרה לפעול.")

        if self.mode == GRACE:
            if self.grace.tick() <= 0:
                self.end_grace()
                self.lock.message("חלון הבטיחות הסתיים. המערכת פעילה.")
            self._periodic_save()
            return

        if self.session:
            self._tick_session(now)
        else:
            if self.mode != LOCKED:
                self.enter_locked()
            self.lock.tick()
            self.lock.assert_on_top()
        self._periodic_save()

    def _tick_session(self, now: datetime) -> None:
        session = self.session
        child_id = session["child_id"]
        elapsed = time.monotonic() - session["mono"]
        session["mono"] = time.monotonic()

        if elapsed > SLEEP_GAP:
            # המחשב ישן או הופסק — לא מחייבים את הפער, חוזרים לנעילה
            self.end_session("resume")
            self.enter_locked()
            self.lock.message("המחשב חזר מהשהיה — צריך להתחבר מחדש.")
            return

        idle = winsys.idle_seconds()
        paused = (idle >= float(self.store.cfg("idle_pause_seconds"))
                  and not self._media_active())
        if not paused:
            self.store.add_usage(child_id, min(elapsed, MAX_TICK_DELTA), now)

        remaining = self.store.remaining_seconds(child_id, now)
        self.hud.update_session(session["name"], remaining, paused)

        for threshold in sorted(self.store.cfg("warn_seconds"), reverse=True):
            if remaining <= threshold and threshold not in session["warned"]:
                session["warned"].add(threshold)
                self.hud.flash(6)
                self.toast(f"נותרו {fmt_clock(remaining)} ל{session['name']}",
                           theme.ACCENT if threshold <= 60 else theme.WARN)
                break

        if remaining <= 0:
            self._time_is_up()

    def _media_active(self) -> bool:
        """האם המחשב מציג תוכן גם בלי שנוגעים בו — שמע או מסך מלא.

        בלי זה השעון נעצר באמצע סרט: אף אחד לא נוגע במקלדת שעה שלמה,
        ו-``GetLastInputInfo`` לא מבדיל בין זה לבין ילד/ה שקמו מהמחשב.
        שני סימנים נבדקים, כי לא כל מחשב יודע לדווח על שניהם: עוצמת השמע
        (תופסת גם וידאו בחלון) ואפליקציה במסך מלא (תופסת גם כשאין כרטיס קול).
        הזיהוי דביק לרבע דקה, כדי ששתיקה בין משפטים בסרט לא תעצור את השעון.
        """
        if not self.store.cfg("media_keeps_clock"):
            return False
        peak = winsys.audio_peak()
        if (peak is not None and peak > AUDIO_ON) or winsys.fullscreen_app_active():
            self._media_at = time.monotonic()
        return bool(self._media_at) and time.monotonic() - self._media_at < MEDIA_GRACE

    def _periodic_save(self) -> None:
        if self._ticks % SAVE_EVERY == 0:
            self.store.save_if_dirty()

    # ------------------------------------------------------------------ מייל
    def mail_changed(self) -> None:
        """נקראת אחרי שינוי בהגדרות המייל — מדליקה או מכבה את חוט הרקע."""
        self.mail.update(self.store.mail_settings())
        if self.store.mail_ready:
            self.mail.start()
        else:
            self.mail.stop()

    def mail_test(self) -> None:
        """שולחת מייל בדיקה ומוודאת שאפשר גם לקרוא מהתיבה."""
        self.mail.update(self.store.mail_settings())
        self.mail.start()
        self.mail.probe(build_test_mail(self.store.cfg("mail_to")))

    def _compose_request_mail(self, request: dict) -> dict:
        kid = self.store.child(request["child_id"])
        name = kid["name"] if kid else "ילד/ה"
        used = self.store.used_seconds(request["child_id"])
        remaining = self.store.remaining_seconds(request["child_id"])
        partial = min(5, int(request["minutes"]))
        return build_request_mail(
            to=self.store.cfg("mail_to"),
            box=self.store.cfg("smtp_user"),
            child=name,
            minutes=int(request["minutes"]),
            reason=request.get("reason") or "",
            remaining_text=(f"נוצלו היום {fmt_clock(used)}, "
                            f"ונותרו {fmt_clock(remaining)}."),
            tokens={
                "full": self.store.mail_token(request["id"], "full", request["minutes"]),
                "some": self.store.mail_token(request["id"], "some", partial),
                "deny": self.store.mail_token(request["id"], "deny", 0),
            },
            partial_minutes=partial,
        )

    def _mail_pump(self) -> None:
        """מוציאה בקשות חדשות למייל וקולטת החלטות שחזרו ממנו."""
        decided = [self.store.apply_mail_token(token)
                   for token in self.mail.pop_tokens()]
        for request in [r for r in decided if r]:
            self._announce_mail_decision(request)

        if not self.store.mail_ready:
            return
        for request in self.store.unmailed_requests():
            try:
                self.mail.send(self._compose_request_mail(request))
            except Exception:       # noqa: BLE001 — בקשה לא נופלת בגלל המייל
                log.exception("בניית מייל הבקשה נכשלה")
                continue
            self.store.mark_mailed(request["id"])

    def _announce_mail_decision(self, request: dict) -> None:
        kid = self.store.child(request["child_id"])
        name = kid["name"] if kid else ""
        if request["status"] == "approved":
            minutes = request.get("granted_minutes") or request["minutes"]
            text = f"ההורים אישרו {minutes} דקות ל{name} 🎉"
            color = theme.OK
        else:
            text = f"ההורים ענו: לא עכשיו ({name})."
            color = theme.MUTED
        log.info("החלטה מהמייל: %s", text)
        self.store.save()
        self.on_state_changed()
        self.toast(text, color, 8)
        if self.mode == LOCKED:
            self.lock.message(text, color, 12)

    # ----------------------------------------------------------------- הורים
    def note_activity(self, _event=None) -> None:
        """כל נגיעה בחלון של ההורים מאפסת את שעון הסגירה האוטומטית."""
        self.ui_activity_at = time.monotonic()

    def restore_from_disabled(self) -> None:
        """מחזיר את המערכת מהשבתה זמנית — מול קוד הורים."""
        log.info("נלחץ כפתור החזרת המערכת")
        if self.modal_open:
            return

        def apply() -> None:
            self.store.enable_now()
            self.store.save()
            self.on_state_changed()
            self.toast("המערכת חזרה לפעול.", theme.OK, 5)

        if not self.store.has_pin:
            apply()
            return
        PinDialog(self, apply, "קוד הורים — החזרת המערכת")

    DAMAGED_HELP = (
        "קובץ הנתונים של המערכת נמחק או נפגם, ולכן המחשב נשאר נעול.\n\n"
        "לשחזור צריך שורת פקודה עם הרשאות מנהל, מתוך תיקיית ההתקנה:\n"
        "    python -m kidtime --reset-pin 1234\n\n"
        "הפקודה קובעת קוד הורים חדש. אחריה אפשר להוסיף שוב את הילדים\n"
        "מפאנל ההורים."
    )

    def _damaged_message(self) -> None:
        self.lock.message(
            "נתוני המערכת נמחקו. נדרשת התערבות של מבוגר — לחצו על \"הורים\".",
            theme.DANGER, 3600)

    def open_parent(self) -> None:
        log.info("נלחץ כפתור ההורים")
        if self.modal_open:
            log.info("דיאלוג אחר כבר פתוח — מתעלמים")
            return
        if self.damaged:
            # בלי קוד הורים אין מה לאמת, ולכן לא פותחים כאן אשף חדש
            Notice(self, "נדרש שחזור", self.DAMAGED_HELP)
            return
        if not self.store.has_pin:
            SetupWizard(self, self.on_state_changed)
            return
        PinDialog(self, lambda: ParentPanel(self))

    # ------------------------------------------------------------------ טוסט
    def toast(self, text: str, color: str = theme.TEXT, seconds: int = 4) -> None:
        """הודעה קצרה שצפה מעל הכל ונעלמת לבד."""
        try:
            if self._toast is not None and self._toast.winfo_exists():
                self._toast.destroy()
        except tk.TclError:
            pass
        win = tk.Toplevel(self.root)
        win.configure(bg=theme.PANEL)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        theme.label(win, text, size=15, weight="bold", fg=color, bg=theme.PANEL,
                    padx=26, pady=14).pack()
        win.update_idletasks()
        x = max(0, (win.winfo_screenwidth() - win.winfo_reqwidth()) // 2)
        y = max(0, int(win.winfo_screenheight() * 0.16))
        win.geometry(f"+{x}+{y}")
        self._toast = win
        win.after(seconds * 1000, lambda: win.winfo_exists() and win.destroy())
