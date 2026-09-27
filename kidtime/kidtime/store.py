"""מצב המערכת: ילדים, מכסות, שימוש יומי, בקשות זמן והשבתה זמנית.

המודול הזה לא נוגע ב-Tk ולא ב-Windows — כל הלוגיקה כאן בדיקה.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from . import config
from .security import hash_pin, protect, unprotect, verify_pin

STATE_VERSION = 1

# הפעולות שקישור במייל יכול לבקש. ``full`` = כל הדקות שהילד/ה ביקש/ה.
MAIL_ACTIONS = ("full", "some", "deny")

# הגדרות שנשמרות מוצפנות בקובץ המצב (ראו ``security.protect``)
SECRET_KEYS = ("smtp_password",)


def _now(now: datetime | None = None) -> datetime:
    return now or datetime.now()


def _iso(moment: datetime) -> str:
    return moment.replace(microsecond=0).isoformat()


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def new_id() -> str:
    return secrets.token_hex(6)


class Store:
    """קורא/כותב את ``state.json`` ומחזיק את כל חשבון הזמן."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else config.state_path()
        self.data = self._load()
        self.dirty = False

    # ------------------------------------------------------------------ קבצים
    def _blank(self) -> dict:
        return {
            "version": STATE_VERSION,
            "config": dict(config.DEFAULT_CONFIG),
            "children": [],
            "usage": {},
            "requests": [],
            "pin": None,
            "pin_failures": 0,
            "pin_locked_until": None,
            "disabled_until": None,
            "last_day_key": None,
            "clock_warning": False,
            "grace_boot_at": None,
            "mail_secret": None,
        }

    def _load(self) -> dict:
        blank = self._blank()
        if not self.path.exists():
            return blank
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            # קובץ פגום — לא מוחקים אותו, שומרים בצד ומתחילים נקי
            try:
                self.path.replace(self.path.with_suffix(".corrupt.json"))
            except OSError:
                pass
            return blank
        if not isinstance(raw, dict):
            return blank
        for key, value in blank.items():
            raw.setdefault(key, value)
        merged = dict(config.DEFAULT_CONFIG)
        merged.update(raw.get("config") or {})
        raw["config"] = merged
        self._migrate(raw)
        return raw

    @staticmethod
    def _migrate(raw: dict) -> None:
        """משלים שדות שנוספו בגרסאות מאוחרות יותר.

        בקשות שנוצרו לפני שהמייל היה קיים נחשבות כאילו כבר נשלחו — אחרת
        ברגע שמחברים תיבת דואר כל ההיסטוריה הממתינה יוצאת בבת אחת.
        """
        for request in raw.get("requests") or []:
            request.setdefault("mailed", True)
            request.setdefault("decided_by", None)
        # סיסמה שנשמרה בגרסה קודמת כטקסט גלוי — נעטפת עכשיו
        settings = raw.get("config") or {}
        for key in SECRET_KEYS:
            if settings.get(key):
                settings[key] = protect(settings[key])

    def save(self) -> None:
        """כתיבה אטומית — קובץ זמני ואז ``os.replace``."""
        self._prune()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), prefix=".state-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self.data, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self.dirty = False

    def save_if_dirty(self) -> None:
        if self.dirty:
            self.save()

    def _prune(self) -> None:
        keep = int(self.cfg("keep_history_days"))
        usage = self.data.get("usage") or {}
        if len(usage) > keep:
            for key in sorted(usage)[:-keep]:
                usage.pop(key, None)
        requests = self.data.get("requests") or []
        if len(requests) > 200:
            self.data["requests"] = requests[-200:]

    # ------------------------------------------------------------------ הגדרות
    def cfg(self, key: str):
        value = self.data["config"].get(key, config.DEFAULT_CONFIG.get(key))
        if key in SECRET_KEYS:
            return unprotect(value)
        return value

    def set_cfg(self, key: str, value) -> None:
        if key in SECRET_KEYS:
            value = protect(value)
        self.data["config"][key] = value
        self.dirty = True

    MAIL_KEYS = ("mail_enabled", "mail_to", "smtp_host", "smtp_port", "smtp_user",
                 "smtp_password", "imap_host", "imap_port", "mail_poll_seconds")

    def mail_settings(self) -> dict:
        """צילום מצב של הגדרות המייל — נמסר לחוט הרקע כדי שלא ייגע ב-Store."""
        return {key: self.cfg(key) for key in self.MAIL_KEYS}

    @property
    def mail_ready(self) -> bool:
        """האם יש מספיק פרטים כדי לשלוח בכלל."""
        return bool(self.cfg("mail_enabled") and self.cfg("mail_to")
                    and self.cfg("smtp_user") and self.cfg("smtp_password"))

    # -------------------------------------------------------------------- יום
    def today(self, now: datetime | None = None) -> str:
        """מפתח היום הנוכחי, עם הגנה מפני הזזת שעון אחורה.

        מפתחות ISO ממוינים לקסיקוגרפית, ולכן היום לעולם לא "חוזר אחורה":
        הזזת השעון ליום קודם לא מייצרת מכסה חדשה.
        """
        key = config.day_key(_now(now), int(self.cfg("day_reset_hour")))
        last = self.data.get("last_day_key")
        if last and key < last:
            if not self.data.get("clock_warning"):
                self.data["clock_warning"] = True
                self.dirty = True
            return last
        if key != last:
            self.data["last_day_key"] = key
            self.data["clock_warning"] = False
            self.dirty = True
        return key

    # ------------------------------------------------------------------ ילדים
    @property
    def children(self) -> list[dict]:
        return self.data["children"]

    def child(self, child_id: str) -> dict | None:
        for kid in self.children:
            if kid["id"] == child_id:
                return kid
        return None

    def add_child(self, name: str, daily_minutes: int | None = None) -> dict:
        name = (name or "").strip()
        if not name:
            raise ValueError("שם ריק")
        color = config.CHILD_COLORS[len(self.children) % len(config.CHILD_COLORS)]
        kid = {"id": new_id(), "name": name, "color": color, "daily_minutes": daily_minutes}
        self.children.append(kid)
        self.dirty = True
        return kid

    def remove_child(self, child_id: str) -> None:
        self.data["children"] = [k for k in self.children if k["id"] != child_id]
        self.data["requests"] = [r for r in self.data["requests"] if r["child_id"] != child_id]
        self.dirty = True

    def rename_child(self, child_id: str, name: str) -> None:
        kid = self.child(child_id)
        if kid and name.strip():
            kid["name"] = name.strip()
            self.dirty = True

    def set_child_quota(self, child_id: str, minutes: int | None) -> None:
        kid = self.child(child_id)
        if kid:
            kid["daily_minutes"] = minutes
            self.dirty = True

    # ------------------------------------------------------------------- זמן
    def quota_seconds(self, child_id: str) -> int:
        kid = self.child(child_id)
        minutes = None if kid is None else kid.get("daily_minutes")
        if minutes is None:
            minutes = self.cfg("daily_minutes")
        return int(minutes) * 60

    def _day_row(self, child_id: str, now: datetime | None = None) -> dict:
        day = self.today(now)
        usage = self.data.setdefault("usage", {}).setdefault(day, {})
        return usage.setdefault(child_id, {"used": 0, "bonus": 0})

    def used_seconds(self, child_id: str, now: datetime | None = None) -> int:
        return int(self._day_row(child_id, now)["used"])

    def bonus_seconds(self, child_id: str, now: datetime | None = None) -> int:
        return int(self._day_row(child_id, now)["bonus"])

    def remaining_seconds(self, child_id: str, now: datetime | None = None) -> int:
        row = self._day_row(child_id, now)
        return max(0, self.quota_seconds(child_id) + int(row["bonus"]) - int(row["used"]))

    def add_usage(self, child_id: str, seconds: float, now: datetime | None = None) -> None:
        if seconds <= 0:
            return
        row = self._day_row(child_id, now)
        row["used"] = round(float(row["used"]) + float(seconds), 2)
        self.dirty = True

    def grant_minutes(self, child_id: str, minutes: float, now: datetime | None = None) -> None:
        """מוסיף (או מוריד, במינוס) דקות ליום הנוכחי."""
        row = self._day_row(child_id, now)
        row["bonus"] = round(float(row["bonus"]) + float(minutes) * 60, 2)
        self.dirty = True

    def reset_today(self, child_id: str, now: datetime | None = None) -> None:
        row = self._day_row(child_id, now)
        row["used"] = 0
        row["bonus"] = 0
        self.dirty = True

    # ---------------------------------------------------------------- בקשות
    def request_wait_seconds(self, child_id: str, now: datetime | None = None) -> int:
        """כמה שניות עד שהילד/ה יכול/ה לשלוח בקשה חדשה (0 = אפשר עכשיו).

        כל בקשה יוצאת כמייל. בלי הגבלה, לחיצה חוזרת על "שליחת הבקשה" מציפה את
        תיבת ההורה — ו-Gmail חוסם זמנית חשבון ששולח יותר מדי.
        """
        gap = timedelta(minutes=float(self.cfg("request_cooldown_minutes") or 0))
        latest = None
        for item in self.pending_requests():
            if item["child_id"] == child_id:
                created = _parse(item.get("created_at"))
                if created and (latest is None or created > latest):
                    latest = created
        if latest is None:
            return 0
        left = (latest + gap - _now(now)).total_seconds()
        return int(left) + 1 if left > 0 else 0

    def create_request(self, child_id: str, minutes: int, reason: str = "",
                       now: datetime | None = None) -> dict:
        minutes = max(1, min(int(minutes), int(self.cfg("max_request_minutes"))))
        # בקשה אחת פתוחה לכל ילד/ה: בקשה חדשה מחליפה את הקודמת, כדי שההורה לא
        # יאשר בטעות שתי בקשות ויעניק את הדקות פעמיים.
        for item in self.pending_requests():
            if item["child_id"] == child_id:
                item["status"] = "replaced"
                item["decided_at"] = _iso(_now(now))
        request = {
            "id": new_id(),
            "child_id": child_id,
            "minutes": minutes,
            "reason": (reason or "").strip()[:200],
            "created_at": _iso(_now(now)),
            "status": "pending",
            "decided_at": None,
            "granted_minutes": None,
            "mailed": False,        # האם כבר נשלח מייל להורה על הבקשה הזו
            "decided_by": None,     # "local" מפאנל ההורים, "mail" מקישור במייל
        }
        self.data["requests"].append(request)
        self.dirty = True
        return request

    def unmailed_requests(self) -> list[dict]:
        """בקשות ממתינות שעדיין לא נשלח עליהן מייל."""
        return [r for r in self.pending_requests() if not r.get("mailed")]

    def mark_mailed(self, request_id: str, ok: bool = True) -> None:
        item = self.request(request_id)
        if item is not None:
            item["mailed"] = bool(ok)
            self.dirty = True

    def pending_requests(self) -> list[dict]:
        return [r for r in self.data["requests"] if r["status"] == "pending"]

    def request(self, request_id: str) -> dict | None:
        for item in self.data["requests"]:
            if item["id"] == request_id:
                return item
        return None

    def decide_request(self, request_id: str, approve: bool, minutes: int | None = None,
                       now: datetime | None = None, by: str = "local") -> bool:
        item = self.request(request_id)
        if not item or item["status"] != "pending":
            return False
        item["status"] = "approved" if approve else "denied"
        item["decided_at"] = _iso(_now(now))
        item["decided_by"] = by
        if approve:
            granted = int(minutes if minutes is not None else item["minutes"])
            item["granted_minutes"] = granted
            self.grant_minutes(item["child_id"], granted, now)
        self.dirty = True
        return True

    # --------------------------------------------------- אישור מרחוק במייל
    def mail_secret(self) -> str:
        """סוד מקומי שממנו נגזרות חתימות קישורי האישור. נוצר פעם אחת."""
        secret = self.data.get("mail_secret")
        if not secret:
            secret = secrets.token_hex(32)
            self.data["mail_secret"] = secret
            self.dirty = True
        return secret

    def mail_token(self, request_id: str, action: str, minutes: int) -> str:
        """הקוד שנוסע בנושא המייל. בלעדיו אי אפשר להכריע בקשה מרחוק."""
        message = f"{request_id}.{action}.{int(minutes)}".encode("utf-8")
        digest = hmac.new(self.mail_secret().encode("utf-8"), message,
                          hashlib.sha256).hexdigest()
        return f"{request_id}.{action}.{int(minutes)}.{digest[:20]}"

    def parse_mail_token(self, token: str) -> tuple[str, str, int] | None:
        """מפרק ומאמת קוד שחזר במייל. ``None`` = מזויף או פגום."""
        parts = (token or "").strip().split(".")
        if len(parts) != 4:
            return None
        request_id, action, raw_minutes, signature = parts
        if action not in MAIL_ACTIONS:
            return None
        try:
            minutes = int(raw_minutes)
        except ValueError:
            return None
        expected = self.mail_token(request_id, action, minutes)
        if not hmac.compare_digest(expected, token.strip()):
            return None
        return request_id, action, minutes

    def apply_mail_token(self, token: str, now: datetime | None = None) -> dict | None:
        """מכריע בקשה לפי קוד שהגיע במייל.

        מחזיר את הבקשה שהוכרעה, או ``None`` אם הקוד לא תקין, פג תוקף,
        או שהבקשה כבר הוכרעה (למשל אושרה בינתיים מפאנל ההורים).
        """
        parsed = self.parse_mail_token(token)
        if parsed is None:
            return None
        request_id, action, minutes = parsed
        item = self.request(request_id)
        if not item or item["status"] != "pending":
            return None
        created = _parse(item.get("created_at"))
        hours = float(self.cfg("mail_token_hours") or 0)
        if created and hours > 0 and _now(now) - created > timedelta(hours=hours):
            return None
        approve = action != "deny"
        granted = minutes if action == "some" else item["minutes"]
        if not self.decide_request(request_id, approve, granted if approve else None,
                                   now, by="mail"):
            return None
        return item

    # -------------------------------------------------- חלון בטיחות להורים
    def claim_boot_grace(self, boot_stamp: float, tolerance: float = 120.0) -> bool:
        """האם מגיע חלון בטיחות עכשיו — כלומר זו הדלקה שעוד לא קיבלה אחד.

        ``boot_stamp`` הוא זמן העלייה של המחשב. אפס = לא ידוע, ואז נותנים
        חלון (עדיף להיות סלחניים מלכלוא את ההורה).
        """
        if boot_stamp <= 0:
            return True
        previous = self.data.get("grace_boot_at")
        if previous is not None and abs(float(previous) - boot_stamp) <= tolerance:
            return False
        self.data["grace_boot_at"] = boot_stamp
        self.dirty = True
        return True

    # -------------------------------------------------------------- השבתה
    def disable_for(self, minutes: float, now: datetime | None = None) -> datetime:
        until = _now(now) + timedelta(minutes=float(minutes))
        self.data["disabled_until"] = _iso(until)
        self.dirty = True
        return until

    def disable_until(self, until: datetime) -> None:
        self.data["disabled_until"] = _iso(until)
        self.dirty = True

    def enable_now(self) -> None:
        if self.data.get("disabled_until"):
            self.data["disabled_until"] = None
            self.dirty = True

    def disabled_until_dt(self) -> datetime | None:
        return _parse(self.data.get("disabled_until"))

    def is_disabled(self, now: datetime | None = None) -> bool:
        until = self.disabled_until_dt()
        if until is None:
            return False
        if _now(now) >= until:
            self.data["disabled_until"] = None
            self.dirty = True
            return False
        return True

    # ------------------------------------------------------------------ PIN
    @property
    def has_pin(self) -> bool:
        return bool(self.data.get("pin"))

    def set_pin(self, pin: str) -> None:
        pin = (pin or "").strip()
        if len(pin) < 4:
            raise ValueError("הקוד חייב להיות באורך 4 ספרות לפחות")
        self.data["pin"] = hash_pin(pin)
        self.data["pin_failures"] = 0
        self.data["pin_locked_until"] = None
        self.dirty = True

    def pin_locked_for(self, now: datetime | None = None) -> int:
        """כמה שניות נותרו עד שאפשר לנסות PIN שוב (0 = אפשר עכשיו)."""
        until = _parse(self.data.get("pin_locked_until"))
        if not until:
            return 0
        remaining = (until - _now(now)).total_seconds()
        if remaining <= 0:
            self.data["pin_locked_until"] = None
            self.data["pin_failures"] = 0
            self.dirty = True
            return 0
        return int(remaining) + 1

    def check_pin(self, pin: str, now: datetime | None = None) -> bool:
        if self.pin_locked_for(now):
            return False
        if verify_pin(pin, self.data.get("pin")):
            self.data["pin_failures"] = 0
            self.data["pin_locked_until"] = None
            self.dirty = True
            return True
        failures = int(self.data.get("pin_failures", 0)) + 1
        self.data["pin_failures"] = failures
        if failures >= int(self.cfg("pin_max_failures")):
            until = _now(now) + timedelta(minutes=float(self.cfg("pin_lock_minutes")))
            self.data["pin_locked_until"] = _iso(until)
            self.data["pin_failures"] = 0
        self.dirty = True
        return False
