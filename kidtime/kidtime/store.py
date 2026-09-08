"""מצב המערכת: ילדים, מכסות, שימוש יומי, בקשות זמן והשבתה זמנית.

המודול הזה לא נוגע ב-Tk ולא ב-Windows — כל הלוגיקה כאן בדיקה.
"""
from __future__ import annotations

import json
import os
import secrets
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from . import config
from .security import hash_pin, verify_pin

STATE_VERSION = 1


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
        return raw

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
        return self.data["config"].get(key, config.DEFAULT_CONFIG.get(key))

    def set_cfg(self, key: str, value) -> None:
        self.data["config"][key] = value
        self.dirty = True

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
    def create_request(self, child_id: str, minutes: int, reason: str = "",
                       now: datetime | None = None) -> dict:
        minutes = max(1, min(int(minutes), int(self.cfg("max_request_minutes"))))
        request = {
            "id": new_id(),
            "child_id": child_id,
            "minutes": minutes,
            "reason": (reason or "").strip()[:200],
            "created_at": _iso(_now(now)),
            "status": "pending",
            "decided_at": None,
            "granted_minutes": None,
        }
        self.data["requests"].append(request)
        self.dirty = True
        return request

    def pending_requests(self) -> list[dict]:
        return [r for r in self.data["requests"] if r["status"] == "pending"]

    def request(self, request_id: str) -> dict | None:
        for item in self.data["requests"]:
            if item["id"] == request_id:
                return item
        return None

    def decide_request(self, request_id: str, approve: bool, minutes: int | None = None,
                       now: datetime | None = None) -> bool:
        item = self.request(request_id)
        if not item or item["status"] != "pending":
            return False
        item["status"] = "approved" if approve else "denied"
        item["decided_at"] = _iso(_now(now))
        if approve:
            granted = int(minutes if minutes is not None else item["minutes"])
            item["granted_minutes"] = granted
            self.grant_minutes(item["child_id"], granted, now)
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
