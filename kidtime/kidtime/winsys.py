"""עטיפות ל-Windows API. על מערכות אחרות כל הפונקציות הן no-op בטוחות.

מה שקיים כאן: זמן חוסר פעילות, נעילת תחנת העבודה, הסתרת שורת המשימות,
משיכת חלון לחזית, וחסימת צירופי מקשים בזמן שמסך הנעילה פתוח.
"""
from __future__ import annotations

import ctypes
import logging
import sys
import time

log = logging.getLogger("kidtime.winsys")

IS_WINDOWS = sys.platform.startswith("win")

if IS_WINDOWS:  # pragma: no cover - נבדק ידנית על Windows
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
else:  # pragma: no cover
    user32 = None
    kernel32 = None
    wintypes = None


# --------------------------------------------------------------- חוסר פעילות
if IS_WINDOWS:  # pragma: no cover

    class _LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds() -> float:
    """כמה שניות עברו מאז הנגיעה האחרונה במקלדת/עכבר (0 אם לא ידוע)."""
    if not IS_WINDOWS:
        return 0.0
    try:  # pragma: no cover
        info = _LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(info)
        if not user32.GetLastInputInfo(ctypes.byref(info)):
            return 0.0
        ticks = kernel32.GetTickCount64()
        return max(0.0, (ticks - info.dwTime) / 1000.0)
    except Exception:
        return 0.0


# ------------------------------------------------------------------- שמע
# ``GetLastInputInfo`` לא יודע להבדיל בין "קמו מהמחשב" לבין "צופים בסרט":
# בשני המקרים אף אחד לא נוגע במקלדת, והשעון נעצר באמצע סרט שלם. לכן שואלים
# את התקן הפלט של כרטיס הקול מה עוצמת הסאונד ברגע זה. כל מה שמתנגן במחשב
# עובר דרכו — דפדפן, נגן, משחק — ולכן זו הבדיקה היחידה שצריך.
#
# הכל דרך ctypes ישירות ל-COM, בלי שום תלות חיצונית. כשמשהו לא מסתדר
# מחזירים ``None`` והמערכת פשוט מתנהגת כמו קודם.
if IS_WINDOWS:  # pragma: no cover - נבדק ידנית על Windows
    ole32 = ctypes.WinDLL("ole32", use_last_error=True)

    class _GUID(ctypes.Structure):
        _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                    ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    _CLSCTX_ALL = 0x17
    _E_RENDER, _E_CONSOLE = 0, 0
    _RPC_E_CHANGED_MODE = -2147417850      # 0x80010106
    _METER_MAX_AGE = 60.0                  # רענון ההתקן, למשל אחרי חיבור אוזניות

    _com_ready = False
    _meter: ctypes.c_void_p | None = None
    _meter_at = 0.0

    def _guid(text: str) -> "_GUID":
        value = _GUID()
        ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(value))
        return value

    def _method(pointer, index: int, *argtypes):
        """מצביע לשיטה מספר ``index`` בטבלת הווירטואלית של ממשק COM."""
        vtable = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_void_p)).contents.value
        slot = ctypes.cast(vtable, ctypes.POINTER(ctypes.c_void_p))[index]
        # לא ``ctypes.HRESULT``: הוא הופך כל כישלון לחריגה, ואנחנו רוצים
        # לבדוק את הקוד בעצמנו ולהמשיך בשקט.
        return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(slot)

    def _release(pointer) -> None:
        if not pointer:
            return
        try:
            vtable = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_void_p)).contents.value
            slot = ctypes.cast(vtable, ctypes.POINTER(ctypes.c_void_p))[2]
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(slot)(pointer)
        except Exception:
            pass

    def _open_meter():
        """מד עוצמה של התקן הפלט הראשי, או ``None``."""
        global _com_ready
        if not _com_ready:
            result = ole32.CoInitializeEx(None, 0x2)     # APARTMENTTHREADED
            # S_OK / S_FALSE / "כבר אותחל אחרת" — בכולם אפשר להמשיך
            if result < 0 and result != _RPC_E_CHANGED_MODE:
                return None
            _com_ready = True

        enumerator = ctypes.c_void_p()
        if ole32.CoCreateInstance(
                ctypes.byref(_guid("{BCDE0395-E52F-467C-8E3D-C4579291692E}")), None,
                _CLSCTX_ALL,
                ctypes.byref(_guid("{A95664D2-9614-4F35-A746-DE8DB63617E6}")),
                ctypes.byref(enumerator)) < 0 or not enumerator:
            return None

        device = ctypes.c_void_p()
        try:
            # IMMDeviceEnumerator::GetDefaultAudioEndpoint
            hresult = _method(enumerator, 4, ctypes.c_int, ctypes.c_int,
                              ctypes.POINTER(ctypes.c_void_p))(
                enumerator, _E_RENDER, _E_CONSOLE, ctypes.byref(device))
        finally:
            _release(enumerator)
        if hresult < 0 or not device:
            return None

        meter = ctypes.c_void_p()
        try:
            # IMMDevice::Activate עבור IAudioMeterInformation
            hresult = _method(device, 3, ctypes.POINTER(_GUID), wintypes.DWORD,
                              ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(
                device, ctypes.byref(_guid("{C02216F6-8C67-4B5B-9D00-D008E73E0064}")),
                _CLSCTX_ALL, None, ctypes.byref(meter))
        finally:
            _release(device)
        return meter if hresult >= 0 and meter else None


def audio_peak() -> float | None:
    """עוצמת השמע המתנגן ברגע זה, 0..1. ``None`` = לא ניתן לדעת.

    אפס פירושו שקט מוחלט. ערך קטן אך חיובי מספיק כדי לדעת שמשהו מתנגן.
    """
    if not IS_WINDOWS:
        return None
    global _meter, _meter_at
    try:  # pragma: no cover
        now = time.monotonic()
        if _meter is None or now - _meter_at > _METER_MAX_AGE:
            _release(_meter)
            _meter = _open_meter()
            _meter_at = now
            if _meter is None:
                return None
        peak = ctypes.c_float()
        # IAudioMeterInformation::GetPeakValue
        if _method(_meter, 3, ctypes.POINTER(ctypes.c_float))(
                _meter, ctypes.byref(peak)) < 0:
            _release(_meter)
            _meter = None
            return None
        return float(peak.value)
    except Exception:
        return None


# מסך מלא הוא הסימן השני לצפייה: נגן וידאו, יוטיוב במסך מלא ומשחקים כולם
# מבקשים מ-Windows "אל תפריע", ומצב זה ניתן לשאילתה בלי הרשאות מיוחדות.
# זה מה שתופס וידאו גם כשלמחשב אין כרטיס קול פעיל.
_FULLSCREEN_STATES = (2, 3, 4, 7)   # BUSY, D3D_FULL_SCREEN, PRESENTATION, APP


def fullscreen_app_active() -> bool:
    """האם רצה כרגע אפליקציה במסך מלא (וידאו, משחק, מצגת)."""
    if not IS_WINDOWS:
        return False
    try:  # pragma: no cover
        state = ctypes.c_int()
        shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        if shell32.SHQueryUserNotificationState(ctypes.byref(state)) < 0:
            return False
        return state.value in _FULLSCREEN_STATES
    except Exception:
        return False


def uptime_seconds() -> float:
    """כמה שניות המחשב דולק. 0 אם לא ידוע."""
    if IS_WINDOWS:
        try:  # pragma: no cover
            return max(0.0, kernel32.GetTickCount64() / 1000.0)
        except Exception:
            return 0.0
    try:
        with open("/proc/uptime", encoding="ascii") as handle:
            return max(0.0, float(handle.read().split()[0]))
    except (OSError, ValueError, IndexError):
        return 0.0


def boot_stamp() -> float:
    """זמן היוניקס שבו המחשב עלה (0 אם לא ידוע).

    משמש כדי לתת את חלון הבטיחות פעם אחת לכל הדלקה — ולא בכל פעם שהתוכנה
    עולה מחדש, שאחרת אפשר היה לסגור אותה שוב ושוב ולקבל זמן חופשי.
    """
    uptime = uptime_seconds()
    return time.time() - uptime if uptime > 0 else 0.0


# ------------------------------------------------------------------- נעילה
def lock_workstation() -> bool:
    """נעילת חשבון Windows (כמו Win+L). מחזיר True אם הצליח."""
    if not IS_WINDOWS:
        return False
    try:  # pragma: no cover
        return bool(user32.LockWorkStation())
    except Exception:
        log.exception("LockWorkStation נכשל")
        return False


# ------------------------------------------------------------- שורת המשימות
def set_taskbar_visible(visible: bool) -> None:
    """מסתיר/מציג את שורת המשימות.

    בעבר הוסתר כאן גם ``FindWindowW("Button", None)`` — טריק מימי XP לכפתור
    התחל. ב-Windows מודרני אין חלון עליון כזה, והחיפוש היה תופס חלון "Button"
    אקראי של תוכנה אחרת ומסתיר אותו.
    """
    if not IS_WINDOWS:
        return
    try:  # pragma: no cover
        sw = 5 if visible else 0  # SW_SHOW / SW_HIDE
        for cls in ("Shell_TrayWnd", "Shell_SecondaryTrayWnd"):
            hwnd = user32.FindWindowW(cls, None)
            while hwnd:
                user32.ShowWindow(hwnd, sw)
                hwnd = user32.FindWindowExW(None, hwnd, cls, None)
    except Exception:
        log.exception("שינוי מצב שורת המשימות נכשל")


# ---------------------------------------------------------------- חלונות
def virtual_screen_rect() -> tuple[int, int, int, int]:
    """(x, y, width, height) של כל שולחן העבודה, כולל מסכים נוספים."""
    if not IS_WINDOWS:
        return (0, 0, 0, 0)
    try:  # pragma: no cover
        return (
            user32.GetSystemMetrics(76),  # SM_XVIRTUALSCREEN
            user32.GetSystemMetrics(77),  # SM_YVIRTUALSCREEN
            user32.GetSystemMetrics(78),  # SM_CXVIRTUALSCREEN
            user32.GetSystemMetrics(79),  # SM_CYVIRTUALSCREEN
        )
    except Exception:
        return (0, 0, 0, 0)


def root_hwnd(hwnd: int) -> int:
    """ה-HWND העליון של החלון. Tk מחזיר לפעמים חלון פנימי."""
    if not IS_WINDOWS or not hwnd:
        return hwnd
    try:  # pragma: no cover
        return user32.GetAncestor(hwnd, 2) or hwnd  # GA_ROOT
    except Exception:
        return hwnd


def is_foreground(hwnd: int) -> bool:
    """האם החלון הזה הוא חלון החזית כרגע."""
    if not IS_WINDOWS or not hwnd:
        return True          # מחוץ ל-Windows אין מה לאכוף
    try:  # pragma: no cover
        return user32.GetForegroundWindow() == root_hwnd(hwnd)
    except Exception:
        return True


def force_foreground(hwnd: int) -> None:
    """מושך חלון לחזית גם כשה-shell מסרב (טריק AttachThreadInput).

    ⚠️ ``AttachThreadInput`` ממזג את תורי הקלט של שני חוטים. מיזוג שנשאר
    פתוח משבש קלט עכבר בכל המערכת, ולכן הניתוק חייב לרוץ ב-``finally``
    גם כשמשהו באמצע נכשל.
    """
    if not IS_WINDOWS or not hwnd:
        return
    hwnd = root_hwnd(hwnd)
    try:  # pragma: no cover
        foreground = user32.GetForegroundWindow()
        if foreground == hwnd:
            return
        target = user32.GetWindowThreadProcessId(foreground, None)
        current = kernel32.GetCurrentThreadId()
        attached = False
        try:
            if target and target != current:
                attached = bool(user32.AttachThreadInput(current, target, True))
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE — רק אם באמת ממוזער
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(current, target, False)
    except Exception:
        log.debug("force_foreground נכשל", exc_info=True)


def is_admin() -> bool:
    if not IS_WINDOWS:
        try:
            import os

            return os.geteuid() == 0
        except AttributeError:
            return False
    try:  # pragma: no cover
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# ------------------------------------------------------------ חסימת מקשים
WH_KEYBOARD_LL = 13
WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP = 0x0100, 0x0101, 0x0104, 0x0105
VK_TAB, VK_ESCAPE, VK_F4 = 0x09, 0x1B, 0x73
VK_LWIN, VK_RWIN = 0x5B, 0x5C
VK_CONTROL, VK_SHIFT, VK_MENU = 0x11, 0x10, 0x12
LLKHF_ALTDOWN = 0x20

if IS_WINDOWS:  # pragma: no cover

    class _KBDLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [
            ("vkCode", wintypes.DWORD),
            ("scanCode", wintypes.DWORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    # LRESULT ברוחב מצביע. עם ``c_long`` (32 ביט) ערך ההחזרה נחתך ב-64 ביט.
    _HOOKPROC = ctypes.WINFUNCTYPE(
        wintypes.LPARAM, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
    )


class KeyBlocker:
    """חוסם Win / Alt+Tab / Alt+F4 / Ctrl+Esc / Ctrl+Shift+Esc בזמן נעילה.

    שימו לב: ‏Ctrl+Alt+Del **לא ניתן לחסימה** — זו החלטה של Windows.
    """

    def __init__(self):
        self._hook = None
        self._proc = None

    @property
    def active(self) -> bool:
        return self._hook is not None

    def install(self) -> bool:
        if not IS_WINDOWS or self.active:
            return self.active
        try:  # pragma: no cover
            self._proc = _HOOKPROC(self._callback)
            # בלי restype מפורש ctypes מחזיר int של 32 ביט — ה-handle נחתך,
            # ו-SetWindowsHookExW נכשל עם שגיאה 126 (המודול לא נמצא).
            # זו הסיבה שחסימת Win / Alt+Tab לא עבדה בפועל.
            kernel32.GetModuleHandleW.restype = wintypes.HMODULE
            kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
            module = kernel32.GetModuleHandleW(None)
            user32.SetWindowsHookExW.restype = wintypes.HHOOK
            user32.SetWindowsHookExW.argtypes = [
                ctypes.c_int, _HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD
            ]
            user32.CallNextHookEx.restype = wintypes.LPARAM
            user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
            user32.UnhookWindowsHookEx.restype = wintypes.BOOL
            user32.CallNextHookEx.argtypes = [
                wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
            ]
            self._hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._proc, module, 0)
            if not self._hook:
                log.warning("התקנת ה-hook למקלדת נכשלה (%s)", ctypes.get_last_error())
                self._hook = None
                self._proc = None
        except Exception:
            log.exception("התקנת ה-hook למקלדת נכשלה")
            self._hook = None
            self._proc = None
        return self.active

    def uninstall(self) -> None:
        if not IS_WINDOWS or not self.active:
            self._hook = None
            self._proc = None
            return
        try:  # pragma: no cover
            user32.UnhookWindowsHookEx(self._hook)
        except Exception:
            log.debug("שחרור ה-hook נכשל", exc_info=True)
        finally:
            self._hook = None
            self._proc = None

    # -- פנימי ------------------------------------------------------------
    @staticmethod
    def _down(vk: int) -> bool:  # pragma: no cover
        return bool(user32.GetAsyncKeyState(vk) & 0x8000)

    @classmethod
    def should_block(cls, vk: int, alt: bool, ctrl: bool, shift: bool) -> bool:
        """מופרד מה-hook כדי שיהיה בדיק ללא Windows."""
        if vk in (VK_LWIN, VK_RWIN):
            return True
        if vk == VK_TAB and alt:
            return True
        if vk == VK_ESCAPE and (alt or ctrl):
            return True
        if vk == VK_F4 and alt:
            return True
        return False

    def _callback(self, code, wparam, lparam):  # pragma: no cover
        try:
            if code == 0 and wparam in (WM_KEYDOWN, WM_SYSKEYDOWN, WM_KEYUP, WM_SYSKEYUP):
                info = ctypes.cast(lparam, ctypes.POINTER(_KBDLLHOOKSTRUCT)).contents
                alt = bool(info.flags & LLKHF_ALTDOWN) or self._down(VK_MENU)
                if self.should_block(info.vkCode, alt, self._down(VK_CONTROL),
                                     self._down(VK_SHIFT)):
                    return 1
        except Exception:
            log.debug("שגיאה ב-hook המקלדת", exc_info=True)
        return user32.CallNextHookEx(self._hook, code, wparam, lparam)
