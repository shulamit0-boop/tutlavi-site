"""ערוץ השליטה המקומי: מופע יחיד ופקודת עצירה.

מודול זה לא מייבא Tk בכוונה — ``--stop`` הוא כלי חירום וצריך לעבוד גם כשהממשק
לא עולה.
"""
from __future__ import annotations

import socket

SINGLE_INSTANCE_PORT = 47611


class SingleInstance:
    """מונע שתי הפעלות במקביל, ומשמש גם כערוץ שליטה.

    מתזמן המשימות מנסה להריץ שוב כל כמה דקות — מופע שני נכשל ב-bind ויוצא.
    אותו שקע מקבל גם פקודת ``stop`` עם קוד ההורים, כדי שאפשר יהיה לעצור את
    המערכת בלי מנהל המשימות.
    """

    def __init__(self, port: int = SINGLE_INSTANCE_PORT):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.port = port
        try:
            self.sock.bind(("127.0.0.1", port))
            self.sock.listen(1)
            self.sock.setblocking(False)
            self.port = self.sock.getsockname()[1]   # port=0 → פורט חופשי (בדיקות)
            self.acquired = True
        except OSError:
            self.sock.close()
            self.acquired = False

    def poll_command(self):
        """מחזיר ``(connection, message)`` אם מישהו פנה, אחרת ``None``."""
        if not self.acquired:
            return None
        try:
            conn, _addr = self.sock.accept()
        except (BlockingIOError, OSError):
            return None
        try:
            conn.settimeout(1.0)
            return conn, conn.recv(256).decode("utf-8", "replace").strip()
        except OSError:
            conn.close()
            return None

    def release(self) -> None:
        if self.acquired:
            try:
                self.sock.close()
            except OSError:
                pass
            self.acquired = False


def send_stop(pin: str, port: int = SINGLE_INSTANCE_PORT) -> str:
    """מבקש ממופע רץ להיסגר. מחזיר ``ok`` / ``bad-pin`` / ``not-running``."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=3) as conn:
            conn.sendall(f"stop {pin}\n".encode("utf-8"))
            return conn.recv(64).decode("utf-8", "replace").strip() or "no-reply"
    except OSError:
        return "not-running"
