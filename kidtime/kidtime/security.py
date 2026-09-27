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


# ------------------------------------------------------------ הצפנת סיסמאות
# סיסמת המייל חייבת להישמר במחשב, אחרת אי אפשר לשלוח ולקרוא בלי ההורה.
# ב-Windows היא נעטפת ב-DPAPI: רק אותו משתמש Windows, על אותו מחשב, יכול
# לפתוח אותה. מי שפותח את ``state.json`` בפנקס רשימות רואה ג'יבריש, וקובץ
# מצב שנשלח במייל (למשל לצורך תמיכה) לא חושף שום סיסמה.
VAULT_PREFIX = "dpapi:"

if os.name == "nt":  # pragma: no cover - נבדק על Windows
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _CRYPTPROTECT_UI_FORBIDDEN = 0x01
    _ENTROPY = b"KidTime/mail-password/v1"

    def _blob(data: bytes) -> "_BLOB":
        buffer = ctypes.create_string_buffer(data, len(data))
        blob = _BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        blob._keep = buffer          # שה-buffer לא ייאסף באמצע הקריאה
        return blob

    def _dpapi(data: bytes, encrypt: bool) -> bytes | None:
        source, entropy, out = _blob(data), _blob(_ENTROPY), _BLOB()
        call = _crypt32.CryptProtectData if encrypt else _crypt32.CryptUnprotectData
        if encrypt:
            ok = call(ctypes.byref(source), "KidTime", ctypes.byref(entropy), None, None,
                      _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out))
        else:
            ok = call(ctypes.byref(source), None, ctypes.byref(entropy), None, None,
                      _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out))
        if not ok:
            return None
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            _kernel32.LocalFree(out.pbData)


def protect(text: str) -> str:
    """עוטף סיסמה לשמירה. ריק נשאר ריק; מחוץ ל-Windows נשמר כמו שהוא."""
    if not text or text.startswith(VAULT_PREFIX) or os.name != "nt":
        return text or ""
    sealed = _dpapi(text.encode("utf-8"), encrypt=True)
    if sealed is None:
        return text
    return VAULT_PREFIX + base64.b64encode(sealed).decode("ascii")


def unprotect(stored: str) -> str:
    """פותח סיסמה שמורה. אם אי אפשר (מחשב אחר, משתמש אחר) — מחזיר ריק."""
    if not stored or not stored.startswith(VAULT_PREFIX):
        return stored or ""
    if os.name != "nt":
        return ""
    try:
        raw = base64.b64decode(stored[len(VAULT_PREFIX):])
    except ValueError:
        return ""
    opened = _dpapi(raw, encrypt=False)
    return opened.decode("utf-8", "replace") if opened is not None else ""
