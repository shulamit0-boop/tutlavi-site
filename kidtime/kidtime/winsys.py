"""עטיפות ל-Windows API. על מערכות אחרות כל הפונקציות הן no-op בטוחות.

מה שקיים כאן: זמן חוסר פעילות, נעילת תחנת העבודה, הסתרת שורת המשימות,
משיכת חלון לחזית, וחסימת צירופי מקשים בזמן שמסך הנעילה פתוח.
"""
from __future__ import annotations

import ctypes
import logging
import sys

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
    """מסתיר/מציג את שורת המשימות ואת כפתור התחל."""
    if not IS_WINDOWS:
        return
    try:  # pragma: no cover
        sw = 5 if visible else 0  # SW_SHOW / SW_HIDE
        for cls in ("Shell_TrayWnd", "Shell_SecondaryTrayWnd"):
            hwnd = user32.FindWindowW(cls, None)
            while hwnd:
                user32.ShowWindow(hwnd, sw)
                hwnd = user32.FindWindowExW(None, hwnd, cls, None)
        start = user32.FindWindowW("Button", None)
        if start:
            user32.ShowWindow(start, sw)
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


def force_foreground(hwnd: int) -> None:
    """מושך חלון לחזית גם כשה-shell מסרב (טריק AttachThreadInput)."""
    if not IS_WINDOWS or not hwnd:
        return
    try:  # pragma: no cover
        root = user32.GetAncestor(hwnd, 2)  # GA_ROOT — Tk מחזיר לפעמים חלון פנימי
        hwnd = root or hwnd
        foreground = user32.GetForegroundWindow()
        if foreground == hwnd:
            return
        target = user32.GetWindowThreadProcessId(foreground, None)
        current = kernel32.GetCurrentThreadId()
        attached = False
        if target and target != current:
            attached = bool(user32.AttachThreadInput(current, target, True))
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
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

    _HOOKPROC = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
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
            module = kernel32.GetModuleHandleW(None)
            user32.SetWindowsHookExW.restype = wintypes.HHOOK
            user32.SetWindowsHookExW.argtypes = [
                ctypes.c_int, _HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD
            ]
            user32.CallNextHookEx.restype = ctypes.c_long
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
