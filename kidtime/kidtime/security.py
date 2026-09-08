"""גיבוב ואימות של קוד ההורים (PIN)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

ALGO = "pbkdf2_sha256"
ITERATIONS = 240_000


def hash_pin(pin: str, salt: bytes | None = None, iterations: int = ITERATIONS) -> dict:
    """מחזיר רשומה נשמרת עבור ``pin``. ה-PIN עצמו לעולם לא נשמר."""
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, iterations)
    return {
        "algo": ALGO,
        "iterations": iterations,
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(digest).decode("ascii"),
    }


def verify_pin(pin: str, record: dict | None) -> bool:
    """השוואה בזמן קבוע מול רשומה שנוצרה ב-:func:`hash_pin`."""
    if not record or record.get("algo") != ALGO:
        return False
    try:
        salt = base64.b64decode(record["salt"])
        expected = base64.b64decode(record["hash"])
        iterations = int(record.get("iterations", ITERATIONS))
    except (KeyError, ValueError, TypeError):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(digest, expected)
