"""גשר המייל: שולח בקשות זמן להורה וקורא את התשובות.

הרעיון: כשילד/ה מבקש/ת תוספת זמן, יוצא מייל לכתובת של ההורה עם שלושה
כפתורים — אישור מלא, אישור חלקי ודחייה. כל כפתור הוא קישור ``mailto:``
שפותח מייל מוכן לשליחה חזרה לתיבה הייעודית של KidTime, עם קוד חתום בשורת
הנושא. המחשב בודק את התיבה הזאת מדי כמה שניות, מאמת את החתימה ומחיל את
ההחלטה. אין שרת, אין כתובת אינטרנט ואין מה לתחזק — רק תיבת דואר אחת.

כל העבודה מול הרשת רצה בחוט רקע. החוט הזה לא נוגע ב-``Store`` וגם לא
ב-Tk: הוא מקבל מילון הגדרות והודעות מוכנות, ומחזיר קודים גולמיים. האימות
וההחלטה נעשים בחוט הראשי, שם כל שאר המערכת חיה.
"""
from __future__ import annotations

import email
import imaplib
import logging
import queue
import re
import smtplib
import ssl
import threading
import time
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import quote

log = logging.getLogger("kidtime.mailer")

SUBJECT_TAG = "KidTime#"
TOKEN_RE = re.compile(r"KidTime#([0-9a-zA-Z]+\.[a-z]+\.\d+\.[0-9a-f]+)")

NET_TIMEOUT = 20          # שניות לכל פעולת רשת — לא תוקעים את חוט הרקע
MAX_FETCH = 25            # כמה מיילים חדשים לקרוא בסיבוב אחד
LOOKBACK_DAYS = 3         # עד כמה ימים אחורה מחפשים תשובות

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _tls() -> ssl.SSLContext:
    """הקשר TLS שבאמת בודק את תעודת השרת.

    ברירת המחדל של ``smtplib`` ו-``imaplib`` כשלא מעבירים הקשר היא *לא* לבדוק
    תעודות. ברשת עוינת (Wi-Fi ציבורי, נתב פרוץ) זה מאפשר להתחזות לשרת הדואר
    ולקבל ממנו את סיסמת האפליקציה של ההורה.
    """
    return ssl.create_default_context()


def _imap_date(days_ago: int) -> str:
    """תאריך בפורמט של IMAP. נבנה ביד — ‎%b‎ תלוי בשפת המערכת."""
    day = datetime.now() - timedelta(days=days_ago)
    return f"{day.day:02d}-{_MONTHS[day.month - 1]}-{day.year}"


# ============================================================== בניית המייל
INK = "#1d2143"
MUTED = "#787ea0"
LINE = "#e4e8f6"
ACCENT = "#7b61ff"
OK = "#14c46a"
DANGER = "#ff4f70"
FONT = "'Segoe UI', Arial, Helvetica, sans-serif"


def _esc(value) -> str:
    return (str("" if value is None else value)
            .replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def mailto(box: str, token: str, label: str) -> str:
    """קישור שפותח מייל מוכן לשליחה חזרה לתיבה של KidTime."""
    subject = quote(f"{SUBJECT_TAG}{token}", safe="")
    body = quote(f"{label}\n\nאין צורך לכתוב כלום — רק לשלוח.\n", safe="")
    return f"mailto:{box}?subject={subject}&body={body}"


def _pill(href: str, text: str, color: str, fill: bool = True) -> str:
    background = color if fill else "#ffffff"
    ink = "#ffffff" if fill else color
    border = color
    return f"""
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="margin:0 0 10px"><tr>
        <td style="background:{background};border:2px solid {border};border-radius:999px">
          <a href="{_esc(href)}" style="display:inline-block;padding:15px 34px;color:{ink};
             font-family:{FONT};font-size:16px;font-weight:700;text-decoration:none">{_esc(text)}</a>
        </td></tr></table>"""


def build_request_mail(*, to: str, box: str, child: str, minutes: int, reason: str,
                       remaining_text: str, tokens: dict, partial_minutes: int) -> dict:
    """מרכיב את המייל שיוצא להורה. מחזיר ``{to, subject, html, text}``.

    ``tokens`` הוא ``{"full": …, "some": …, "deny": …}`` — הקודים החתומים
    שנוצרו ב-:meth:`Store.mail_token`.
    """
    reason_block = ""
    if reason:
        reason_block = (
            f'<p style="margin:18px 0 0;padding:14px 16px;background:#f7f8fd;'
            f'border-radius:14px;color:{INK};font-size:15px;line-height:1.7">'
            f'“{_esc(reason)}”</p>')

    buttons = (
        _pill(mailto(box, tokens["full"], f"אישור {minutes} דקות"),
              f"אישור {minutes} דקות", OK)
        + _pill(mailto(box, tokens["some"], f"אישור {partial_minutes} דקות"),
                f"רק {partial_minutes} דקות", ACCENT, fill=False)
        + _pill(mailto(box, tokens["deny"], "דחייה"), "לא עכשיו", DANGER, fill=False)
    )

    html = f"""<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>בקשת זמן מסך</title></head>
<body style="margin:0;padding:0;background:#f2f5fc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#f2f5fc;padding:26px 12px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" dir="rtl"
           style="width:560px;max-width:100%;background:#ffffff;border-radius:24px;
                  border:1px solid {LINE};font-family:{FONT};text-align:right">

      <tr><td style="padding:26px 30px 0">
        <div style="color:{ACCENT};font-size:12px;font-weight:700;letter-spacing:.14em">
          בקשת זמן מסך</div>
        <h1 style="margin:10px 0 0;color:{INK};font-size:25px;line-height:1.35;font-weight:800">
          {_esc(child)} מבקש/ת עוד {minutes} דקות</h1>
        <p style="margin:12px 0 0;color:{MUTED};font-size:15px;line-height:1.7">
          {_esc(remaining_text)}</p>
        {reason_block}
      </td></tr>

      <tr><td style="padding:22px 30px 6px">
        {buttons}
      </td></tr>

      <tr><td style="padding:0 30px 26px;color:{MUTED};font-size:13px;line-height:1.8">
        לחיצה על כפתור פותחת מייל מוכן — רק ללחוץ «שלח», והדקות יתווספו במחשב
        תוך פחות מדקה.<br>
        הקישורים תקפים לבקשה הזו בלבד ופגים מעצמם.
      </td></tr>

      <tr><td style="padding:16px 30px;background:#f7f8fd;border-top:1px solid {LINE};
                     border-radius:0 0 24px 24px;color:{MUTED};font-size:12px">
        KidTime · מערכת זמן המסך בבית
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>"""

    text = (f"{child} מבקש/ת עוד {minutes} דקות.\n"
            f"{remaining_text}\n"
            + (f"סיבה: {reason}\n" if reason else "")
            + "\nכדי להכריע, שלחו מייל חזרה עם אחד הנושאים האלה:\n"
            f"  אישור מלא:  {SUBJECT_TAG}{tokens['full']}\n"
            f"  {partial_minutes} דקות:   {SUBJECT_TAG}{tokens['some']}\n"
            f"  דחייה:      {SUBJECT_TAG}{tokens['deny']}\n")

    return {"to": to, "subject": f"בקשת זמן · {child} · {minutes} דקות",
            "html": html, "text": text}


def build_test_mail(to: str) -> dict:
    html = f"""<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f2f5fc;font-family:{FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="padding:26px 12px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" dir="rtl"
       style="width:480px;max-width:100%;background:#fff;border-radius:24px;
              border:1px solid {LINE};text-align:right">
<tr><td style="padding:30px">
  <h1 style="margin:0;color:{INK};font-size:22px;font-weight:800">החיבור עובד</h1>
  <p style="margin:12px 0 0;color:{MUTED};font-size:15px;line-height:1.7">
    מעכשיו כל בקשת זמן של הילדים תגיע לכאן, עם כפתורי אישור ודחייה.</p>
</td></tr></table></td></tr></table></body></html>"""
    return {"to": to, "subject": "KidTime · בדיקת חיבור", "html": html,
            "text": "החיבור עובד. מעכשיו בקשות הזמן של הילדים יגיעו לכתובת הזו."}


# ================================================================ חוט הרקע
class MailBridge:
    """שולח מיילים ומושך תשובות ברקע, בלי לחסום את הממשק."""

    def __init__(self, settings: dict | None = None):
        self._settings = dict(settings or {})
        self._lock = threading.Lock()
        self._outbox: "queue.Queue[dict]" = queue.Queue()
        self._tokens: "queue.Queue[str]" = queue.Queue()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._done: set[str] = set()
        self._status = {"sending": False, "polling": False, "error": "",
                        "last_ok": None, "sent": 0, "received": 0, "probe": None}

    # ------------------------------------------------------------ חיים
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="kidtime-mail",
                                        daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread and thread.is_alive():
            thread.join(timeout=timeout)

    # -------------------------------------------------------- ממשק ציבורי
    def update(self, settings: dict) -> None:
        with self._lock:
            self._settings = dict(settings)

    def send(self, message: dict) -> None:
        """מוסיף מייל לתור היציאה. חוזר מיד."""
        self._outbox.put(dict(message))
        self._wake.set()

    def probe(self, message: dict | None = None) -> None:
        """בדיקת חיבור: שליחה + כניסה לתיבה. התוצאה מופיעה ב-:meth:`status`."""
        self._set(probe="running", error="")
        job = dict(message or {})
        job["_probe"] = True
        self._outbox.put(job)
        self._wake.set()

    def pop_tokens(self) -> list[str]:
        """הקודים שהגיעו מאז הקריאה הקודמת."""
        found = []
        while True:
            try:
                found.append(self._tokens.get_nowait())
            except queue.Empty:
                return found

    def status(self) -> dict:
        with self._lock:
            return dict(self._status)

    def _set(self, **fields) -> None:
        with self._lock:
            self._status.update(fields)

    def _config(self) -> dict:
        with self._lock:
            return dict(self._settings)

    @staticmethod
    def _usable(cfg: dict) -> bool:
        return bool(cfg.get("mail_enabled") and cfg.get("mail_to")
                    and cfg.get("smtp_user") and cfg.get("smtp_password"))

    # ---------------------------------------------------------- הלולאה
    def _loop(self) -> None:
        last_poll = 0.0
        while not self._stop.is_set():
            cfg = self._config()
            forced = not self._outbox.empty()
            if self._usable(cfg) or forced:
                if forced:
                    self._flush(cfg)
                gap = max(10, int(cfg.get("mail_poll_seconds") or 25))
                if self._usable(cfg) and time.monotonic() - last_poll >= gap:
                    last_poll = time.monotonic()
                    self._poll(cfg)
            self._wake.wait(timeout=2.0)
            self._wake.clear()

    # ---------------------------------------------------------- שליחה
    def _flush(self, cfg: dict) -> None:
        jobs = []
        while True:
            try:
                jobs.append(self._outbox.get_nowait())
            except queue.Empty:
                break
        if not jobs:
            return
        probing = any(job.get("_probe") for job in jobs)
        self._set(sending=True)
        try:
            self._send_all(cfg, jobs)
            self._set(error="", last_ok=time.time(),
                      sent=self.status()["sent"] + len(jobs))
            if probing:
                # שליחה עבדה; עכשיו לוודא שגם הקריאה מהתיבה עובדת
                self._set(probe="ok" if self._can_read(cfg) else "read-failed")
        except Exception as exc:                     # noqa: BLE001
            message = _human(exc)
            log.warning("שליחת מייל נכשלה: %s", exc)
            self._set(error=message)
            if probing:
                self._set(probe="send-failed")
            for job in jobs:                         # ניסיון נוסף בסיבוב הבא
                if not job.get("_probe") and job.get("_tries", 0) < 3:
                    job["_tries"] = job.get("_tries", 0) + 1
                    self._outbox.put(job)
        finally:
            self._set(sending=False)

    def _send_all(self, cfg: dict, jobs: list[dict]) -> None:
        host = cfg.get("smtp_host") or "smtp.gmail.com"
        port = int(cfg.get("smtp_port") or 587)
        user = cfg.get("smtp_user") or ""
        password = cfg.get("smtp_password") or ""
        sender = formataddr(("KidTime", user))

        if port == 465:
            server_cm = smtplib.SMTP_SSL(host, port, timeout=NET_TIMEOUT, context=_tls())
        else:
            server_cm = smtplib.SMTP(host, port, timeout=NET_TIMEOUT)
        with server_cm as server:
            if port != 465:
                server.starttls(context=_tls())
            server.login(user, clean_password(host, password))
            for job in jobs:
                to = job.get("to") or cfg.get("mail_to")
                if not to:
                    continue
                message = EmailMessage()
                message["From"] = sender
                message["To"] = to
                message["Subject"] = job.get("subject") or "KidTime"
                message["Reply-To"] = user
                message.set_content(job.get("text") or "")
                if job.get("html"):
                    message.add_alternative(job["html"], subtype="html")
                server.send_message(message)

    # ---------------------------------------------------------- קריאה
    def _open_imap(self, cfg: dict) -> imaplib.IMAP4_SSL:
        host = cfg.get("imap_host") or "imap.gmail.com"
        port = int(cfg.get("imap_port") or 993)
        box = imaplib.IMAP4_SSL(host, port, ssl_context=_tls(), timeout=NET_TIMEOUT)
        box.login(cfg.get("smtp_user") or "",
                  clean_password(host, cfg.get("smtp_password") or ""))
        return box

    def _can_read(self, cfg: dict) -> bool:
        try:
            box = self._open_imap(cfg)
        except Exception as exc:                     # noqa: BLE001
            log.warning("כניסה לתיבת הדואר נכשלה: %s", exc)
            self._set(error=_human(exc))
            return False
        try:
            box.select("INBOX")
            return True
        except Exception:                            # noqa: BLE001
            return False
        finally:
            _close(box)

    def _search(self, box, *criteria) -> list:
        try:
            status, data = box.search(None, *criteria)
        except Exception:                            # noqa: BLE001
            return []
        if status != "OK":
            return []
        return (data[0] or b"").split()

    @staticmethod
    def _all_mail(box):
        """שם תיקיית "כל הדואר" לפי הדגל All — השם עצמו מתורגם בכל שפה."""
        try:
            status, data = box.list()
        except Exception:                            # noqa: BLE001
            return None
        if status != "OK":
            return None
        for line in data or []:
            text = line.decode("utf-8", "replace") if isinstance(line, bytes) else str(line)
            if "\\All" in text and ' "/" ' in text:
                return text.split(' "/" ')[-1].strip()
        return None

    def _harvest(self, box, ids) -> int:
        """שולף קודים מנושאי ההודעות, בלי לטפל באותו קוד פעמיים."""
        found = 0
        handled = set()
        for msg_id in ids[-MAX_FETCH:]:
            if msg_id in handled:
                continue
            handled.add(msg_id)
            token = self._token_of(box, msg_id)
            if not token or token in self._done:
                continue
            self._done.add(token)
            self._tokens.put(token)
            found += 1
            log.info("התקבלה תשובה חדשה במייל")
            try:
                box.store(msg_id, "+FLAGS", "\\Seen")
            except Exception:                        # noqa: BLE001
                pass
        if len(self._done) > 500:
            self._done.clear()       # קוד שכבר הוכרע ממילא לא מוסיף דקות שוב
        return found

    def _poll(self, cfg: dict) -> None:
        self._set(polling=True)
        box = None
        try:
            box = self._open_imap(cfg)
            since = _imap_date(LOOKBACK_DAYS)
            box.select("INBOX")
            # חיפוש "הודעות שלא נקראו" לבדו לא מספיק: כשכתובת ההורה וכתובת
            # התיבה זהות, Gmail מסמן את מייל האישור כנקרא ברגע שהוא מגיע —
            # כי שלחת אותו לעצמך. לכן מחפשים גם לפי שורת הנושא, בלי תלות
            # בסימון, וזו הבדיקה שבאמת תופסת את האישור.
            harvested = self._harvest(
                box,
                self._search(box, "UNSEEN")
                + self._search(box, "SINCE", since, "SUBJECT", '"KidTime"'))
            if not harvested:
                # ויש תיבות שבהן מייל לעצמך מדלג על INBOX ויושב רק בכל הדואר
                folder = self._all_mail(box)
                if folder:
                    box.select(folder)
                    harvested = self._harvest(
                        box,
                        self._search(box, "SINCE", since, "SUBJECT", '"KidTime"'))
            if harvested:
                log.info("נקלטו %d תשובות מהמייל", harvested)
                self._set(received=self.status()["received"] + harvested)
            self._set(error="", last_ok=time.time())
        except Exception as exc:                     # noqa: BLE001
            log.warning("קריאת תיבת הדואר נכשלה: %s", exc)
            self._set(error=_human(exc))
        finally:
            _close(box)
            self._set(polling=False)

    @staticmethod
    def _token_of(box: imaplib.IMAP4_SSL, msg_id: bytes) -> str | None:
        """שולף קוד KidTime מנושא ההודעה, בלי לסמן אותה כנקראה."""
        try:
            status, data = box.fetch(msg_id, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])")
        except Exception:                            # noqa: BLE001
            return None
        if status != "OK" or not data or not isinstance(data[0], tuple):
            return None
        try:
            headers = email.message_from_bytes(data[0][1])
            subject = str(make_header(decode_header(headers.get("Subject", ""))))
        except Exception:                            # noqa: BLE001
            return None
        match = TOKEN_RE.search(subject)
        if not match:
            return None
        return match.group(1)


def clean_password(host: str, password: str) -> str:
    """Google מציגה את סיסמת האפליקציה בקבוצות של ארבע עם רווחים ביניהן.

    הרווחים הם רק לתצוגה, אבל הורה שמעתיק-מדביק מקבל אותם — ואז הכניסה
    נכשלת בלי הסבר. אצל ספקים אחרים רווח יכול להיות חלק אמיתי מהסיסמה.
    """
    password = (password or "").strip()
    if "gmail" in (host or "gmail").lower() or "google" in (host or "").lower():
        return "".join(password.split())
    return password


def _close(box) -> None:
    if box is None:
        return
    try:
        box.close()
    except Exception:                                # noqa: BLE001
        pass
    try:
        box.logout()
    except Exception:                                # noqa: BLE001
        pass


def _human(exc: Exception) -> str:
    """הודעת שגיאה קצרה בעברית, כזו שאפשר להציג בפאנל ההורים."""
    if isinstance(exc, smtplib.SMTPAuthenticationError) or "AUTHENTICATIONFAILED" in str(exc).upper():
        return "שם המשתמש או סיסמת האפליקציה שגויים."
    if isinstance(exc, ssl.SSLCertVerificationError):
        return "תעודת האבטחה של שרת הדואר לא תקינה — החיבור נחסם."
    if isinstance(exc, (TimeoutError, OSError)) and "getaddrinfo" in str(exc):
        return "אין חיבור לאינטרנט."
    if isinstance(exc, TimeoutError):
        return "השרת לא ענה בזמן."
    text = str(exc).strip()
    return text[:120] or exc.__class__.__name__
