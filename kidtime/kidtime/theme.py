"""צבעים, גופנים ווידג'טים קטנים משותפים לכל המסכים."""
from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont

BG = "#0b0b0f"
PANEL = "#15151c"
PANEL2 = "#1e1e27"
LINE = "#2a2a35"
TEXT = "#f5f5f7"
MUTED = "#8b8b98"
ACCENT = "#ef4444"
OK = "#22c55e"
WARN = "#f59e0b"

_FAMILY = None
_CANDIDATES = ("Segoe UI", "Arial", "Noto Sans Hebrew", "DejaVu Sans", "Helvetica")


def family(root: tk.Misc | None = None) -> str:
    """הגופן הראשון מהרשימה שקיים במערכת."""
    global _FAMILY
    if _FAMILY is None:
        available = set()
        try:
            available = {name.lower() for name in tkfont.families(root)}
        except tk.TclError:
            pass
        _FAMILY = next((c for c in _CANDIDATES if c.lower() in available), "TkDefaultFont")
    return _FAMILY


def font(size: int = 12, weight: str = "normal", root: tk.Misc | None = None):
    return (family(root), size, weight)


def button(parent, text, command, *, bg=PANEL2, fg=TEXT, size=12, weight="normal",
           padx=18, pady=10, width=0, active=None):
    """כפתור שטוח בסגנון האפליקציה (ללא הבלטות של Tk)."""
    btn = tk.Button(
        parent, text=text, command=command, bg=bg, fg=fg, activebackground=active or bg,
        activeforeground=fg, relief="flat", bd=0, highlightthickness=0, cursor="hand2",
        font=font(size, weight, parent), padx=padx, pady=pady,
    )
    if width:
        btn.configure(width=width)
    return btn


def label(parent, text="", *, size=12, weight="normal", fg=TEXT, bg=None, **kwargs):
    return tk.Label(
        parent, text=text, fg=fg, bg=bg if bg is not None else parent["bg"],
        font=font(size, weight, parent), **kwargs,
    )


def entry(parent, *, show=None, width=18, size=14, justify="right"):
    return tk.Entry(
        parent, show=show, width=width, font=font(size, "normal", parent), justify=justify,
        bg=PANEL2, fg=TEXT, insertbackground=TEXT, relief="flat", bd=0,
        highlightthickness=1, highlightbackground=LINE, highlightcolor=ACCENT,
    )


def ring(canvas: tk.Canvas, x: int, y: int, radius: int, fraction: float, color: str,
         width: int = 9, track: str = LINE) -> None:
    """טבעת התקדמות: ``fraction`` הוא החלק שנותר (0..1)."""
    canvas.delete("ring")
    box = (x - radius, y - radius, x + radius, y + radius)
    canvas.create_oval(*box, outline=track, width=width, tags="ring")
    fraction = max(0.0, min(1.0, fraction))
    if fraction > 0:
        canvas.create_arc(
            *box, start=90, extent=-359.99 * fraction, style=tk.ARC,
            outline=color, width=width, tags="ring",
        )


def show_modal(win: tk.Toplevel, focus_widget: tk.Misc | None = None) -> None:
    """ממפה חלון מודאלי, לוכד את הקלט וממקד שדה.

    ``focus_force`` על חלון שעדיין לא מוצג מפיל את Tk בחלק מהסביבות,
    ולכן ממקדים בכוח רק אחרי שהחלון באמת על המסך.
    """
    try:
        win.update()
    except tk.TclError:
        return
    try:
        win.grab_set()
    except tk.TclError:
        pass
    if focus_widget is None:
        return
    try:
        if focus_widget.winfo_viewable():
            focus_widget.focus_force()
        else:
            focus_widget.focus_set()
    except tk.TclError:
        pass
