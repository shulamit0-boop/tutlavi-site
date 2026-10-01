"""שפת העיצוב של KidTime: צבעים, גופנים וּוידג'טים עגולים.

הסגנון בהיר, עגול ואוורירי — כרטיסים לבנים על רקע תכלת רך, כפתורי גלולה
צבעוניים וטיפוגרפיה גדולה. Tk לא יודע לעגל פינות של Frame או Button, ולכן
הכרטיסים והכפתורים כאן הם ``Canvas`` שמציירים מלבן מעוגל ושמים את התוכן
מעליו. זה נראה כמו ווידג'ט רגיל מבחוץ: ``pack``/``grid``, ``configure``
ו-``cget`` עובדים כרגיל.
"""
from __future__ import annotations

import re
import tkinter as tk
from tkinter import font as tkfont

# ----------------------------------------------------------------- לוח צבעים
BG = "#f2f5fc"        # רקע המסך
BG2 = "#e8edfa"       # רקע משני, מעט כהה יותר
PANEL = "#ffffff"     # כרטיסים
PANEL2 = "#eceffb"    # משטח כפתור רגיל / שדה קלט
LINE = "#dfe4f4"      # קווי הפרדה ומסגרות עדינות
TEXT = "#1d2143"      # דיו כהה
MUTED = "#787ea0"     # טקסט משני

ACCENT = "#7b61ff"    # סגול — הפעולה הראשית
ACCENT2 = "#00c2cb"   # טורקיז — פעולה משנית
OK = "#14c46a"        # ירוק — הצלחה
WARN = "#ffab1f"      # כתום — אזהרה
DANGER = "#ff4f70"    # אדום — שגיאה או פעולה הרסנית

# צבעי הילדים — עזים אבל לא צורמים, עם גרסה בהירה לרקע האריח
CHILD_TINT = 0.86     # כמה להלבין צבע ילד/ה כשהוא משמש כרקע

_FAMILY = None
# רק גופנים שמכירים את סימני הכיווניות (ראו ``rtl`` למטה). גופנים מ-Google
# כמו Assistant או Rubik יפים, אבל חסרים בהם הסימנים האלה: Tk מצייר את
# הסימן בגופן חלופי, השורה נשברת לכמה חלקים, והעברית שוב מתהפכת.
_CANDIDATES = (
    "Segoe UI Variable Text", "Segoe UI", "Arial", "Noto Sans Hebrew",
    "DejaVu Sans", "Helvetica",
)


# ------------------------------------------------------------- עזרי צבע
def _rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def _hex(rgb: tuple[float, float, float]) -> str:
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def mix(color: str, other: str, amount: float) -> str:
    """מערבב שני צבעים. ``amount``=0 מחזיר את הראשון, 1 את השני."""
    a, b = _rgb(color), _rgb(other)
    return _hex(tuple(a[i] + (b[i] - a[i]) * amount for i in range(3)))


def tint(color: str, amount: float = CHILD_TINT) -> str:
    """גרסה בהירה של הצבע — לרקעים רכים."""
    return mix(color, "#ffffff", amount)


def shade(color: str, amount: float = 0.12) -> str:
    """גרסה כהה מעט — למצב ריחוף ולחיצה."""
    return mix(color, "#000000", amount)


def readable_on(color: str) -> str:
    """טקסט לבן או כהה, לפי בהירות הרקע."""
    r, g, b = _rgb(color)
    return TEXT if (r * 299 + g * 587 + b * 114) / 1000 > 165 else "#ffffff"


# ------------------------------------------------------------------ גופנים
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


def _surface(widget: tk.Misc) -> str:
    """צבע הרקע של ההורה — כדי שפינות מעוגלות ייראו שקופות."""
    try:
        return str(widget["bg"])
    except tk.TclError:
        return BG


# ------------------------------------------------------- מלבן בעל פינות עגולות
def round_rect(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float,
               radius: float, **options):
    """מצייר מלבן מעוגל על קנבס.

    Tk לא מכיר צורה כזאת, אז מציירים פוליגון מוחלק: הנקודות יושבות בפינות
    ובקצות הקשתות, ו-``smooth`` מעגל אותן. זה החלק היחיד בקובץ שקובע איך
    נראית כל פינה במערכת.
    """
    radius = max(0, min(radius, (x2 - x1) / 2, (y2 - y1) / 2))
    points = [
        x1 + radius, y1, x2 - radius, y1, x2, y1, x2, y1 + radius,
        x2, y2 - radius, x2, y2, x2 - radius, y2, x1 + radius, y2,
        x1, y2, x1, y2 - radius, x1, y1 + radius, x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, splinesteps=24, **options)


# ------------------------------------------------------------------ כפתורים
class RoundedButton(tk.Canvas):
    """כפתור גלולה מצויר, עם ריחוף ולחיצה.

    מבחוץ הוא מתנהג ככפתור Tk רגיל: ``configure(text=…, fg=…, bg=…)``,
    ``cget("text")`` ו-``pack`` עובדים, ולחיצת עכבר אמיתית מפעילה אותו.
    """

    def __init__(self, parent, text="", command=None, *, bg=PANEL2, fg=TEXT,
                 size=12, weight="normal", padx=18, pady=10, width=0,
                 active=None, radius=None):
        super().__init__(parent, bg=_surface(parent), highlightthickness=0, bd=0,
                         cursor="hand2", takefocus=0)
        self._state = {"text": text, "bg": bg, "fg": fg, "active": active}
        self._command = command
        self._font = font(size, weight, parent)
        self._pad = (padx, pady)
        self._min_width = width
        self._radius = radius
        self._hover = False
        self._pressed = False
        self._enabled = True
        self._shape = None
        self._text = None
        self._render()

        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)

    # ------------------------------------------------------------ מראה
    def _fill(self) -> str:
        base = self._state["bg"]
        if not self._enabled:
            return mix(base, BG, 0.55)
        if self._pressed:
            return shade(base, 0.18)
        if self._hover:
            return self._state["active"] or shade(base, 0.08)
        return base

    def _render(self) -> None:
        metrics = tkfont.Font(font=self._font)
        text = rtl(self._state["text"])
        text_w = metrics.measure(text)
        text_h = metrics.metrics("linespace")
        padx, pady = self._pad
        width = max(text_w + padx * 2, self._min_width * 10 if self._min_width else 0)
        height = text_h + pady * 2
        radius = self._radius if self._radius is not None else height / 2
        super().configure(width=width, height=height)
        self.delete("all")
        self._shape = round_rect(self, 0, 0, width, height, radius,
                                 fill=self._fill(), outline="")
        self._text = self.create_text(width / 2, height / 2, text=text,
                                      fill=self._state["fg"], font=self._font)

    def _repaint(self) -> None:
        if self._shape is not None:
            self.itemconfigure(self._shape, fill=self._fill())
            self.itemconfigure(self._text, fill=self._state["fg"])

    # ------------------------------------------------------------ אירועים
    def _on_enter(self, _event=None) -> None:
        self._hover = True
        self._repaint()

    def _on_leave(self, _event=None) -> None:
        self._hover = False
        self._pressed = False
        self._repaint()

    def _on_press(self, _event=None) -> None:
        if not self._enabled:
            return
        self._pressed = True
        self._repaint()

    def _on_release(self, event=None) -> None:
        was_pressed, self._pressed = self._pressed, False
        self._repaint()
        if not (was_pressed and self._enabled and self._command):
            return
        if event is not None and not (0 <= event.x <= self.winfo_width()
                                      and 0 <= event.y <= self.winfo_height()):
            return          # הסמן יצא מהכפתור לפני השחרור — לא לחיצה
        self._command()

    def invoke(self):
        if self._enabled and self._command:
            return self._command()
        return None

    # ---------------------------------------------- תאימות ל-API של Tk
    _OWN = ("text", "bg", "fg", "active", "background", "foreground", "state", "command")

    def configure(self, cnf=None, **kwargs):      # noqa: D401
        if not hasattr(self, "_state"):
            return super().configure(cnf, **kwargs)
        if isinstance(cnf, dict):
            kwargs.update(cnf)
            cnf = None
        mine = {k: kwargs.pop(k) for k in list(kwargs) if k in self._OWN}
        if "command" in mine:
            self._command = mine.pop("command")
        if "state" in mine:
            self._enabled = str(mine.pop("state")) != "disabled"
        for key, alias in (("background", "bg"), ("foreground", "fg")):
            if key in mine:
                mine[alias] = mine.pop(key)
        redraw = "text" in mine
        self._state.update(mine)
        result = super().configure(cnf, **kwargs) if (cnf or kwargs) else None
        if redraw:
            self._render()
        elif mine:
            self._repaint()
        return result

    config = configure

    def cget(self, key):
        if hasattr(self, "_state"):
            if key in ("text", "fg", "bg"):
                return self._state["fg" if key == "fg" else key]
            if key == "foreground":
                return self._state["fg"]
            if key == "background":
                return self._state["bg"]
            if key == "state":
                return "normal" if self._enabled else "disabled"
        return super().cget(key)

    def __getitem__(self, key):
        return self.cget(key)


def button(parent, text, command, *, bg=PANEL2, fg=None, size=12, weight="bold",
           padx=18, pady=10, width=0, active=None, radius=None):
    """כפתור גלולה בסגנון המערכת. הטקסט מקבל צבע קריא אוטומטית."""
    return RoundedButton(
        parent, text=text, command=command, bg=bg,
        fg=fg if fg is not None else readable_on(bg),
        size=size, weight=weight, padx=padx, pady=pady, width=width,
        active=active, radius=radius,
    )


# -------------------------------------------------------------- כרטיסים
class Card(tk.Canvas):
    """כרטיס לבן עם פינות עגולות. התוכן נכנס ל-``card.body``."""

    def __init__(self, parent, *, fill=PANEL, outline=LINE, radius=20,
                 padx=18, pady=15, surface=None, border=1):
        super().__init__(parent, bg=surface or _surface(parent),
                         highlightthickness=0, bd=0, takefocus=0)
        self._fill, self._outline, self._radius = fill, outline, radius
        self._border = border
        self._padx, self._pady = padx, pady
        self._shape = None
        self.body = tk.Frame(self, bg=fill)
        self._item = self.create_window(padx, pady, window=self.body, anchor="nw")
        self.body.bind("<Configure>", self._on_body)
        self.bind("<Configure>", self._on_self)
        self._sync()

    def _sync(self) -> None:
        self.update_idletasks()
        self._fit(self.body.winfo_reqwidth(), self.body.winfo_reqheight())

    def _on_body(self, event) -> None:
        self._fit(event.width, event.height)

    def _fit(self, _body_width: int, body_height: int) -> None:
        """גודל הכרטיס נגזר מהתוכן. מנהל פריסה שמותח אותו פשוט דורס את זה.

        הרוחב המבוקש נמדד תמיד מהתוכן ולא מהרוחב שנכפה על הגוף, אחרת הכרטיס
        ננעל: מתיחה חד-פעמית הופכת לרוחב המבוקש, הרוחב המבוקש מחזיר מתיחה,
        והכרטיס נשאר רחב לנצח גם כשהתוכן התכווץ.
        """
        width = self.body.winfo_reqwidth() + self._padx * 2
        height = body_height + self._pady * 2
        super().configure(width=width, height=height)
        self._draw(max(width, self.winfo_width()), height)

    def _on_self(self, event) -> None:
        """מותח את התוכן רק כשמנהל הפריסה נתן לכרטיס יותר רוחב מהדרוש.

        כפיית רוחב תמיד יוצרת לולאה: התוכן מקבל את רוחב הקנבס, הקנבס מקבל
        את רוחב התוכן, ושניהם מתכנסים לרצועה צרה. ``width=0`` מחזיר את
        הווידג'ט לרוחב הטבעי שלו.
        """
        inner = event.width - self._padx * 2
        natural = self.body.winfo_reqwidth()
        self.itemconfigure(self._item, width=inner if inner > natural else 0)
        self._draw(event.width, event.height)

    def _draw(self, width: int, height: int) -> None:
        if width <= 2 or height <= 2:
            return
        if self._shape is not None:
            self.delete(self._shape)
        inset = max(1, self._border)
        self._shape = round_rect(self, inset, inset, width - inset, height - inset,
                                 self._radius, fill=self._fill,
                                 outline=self._outline or "", width=self._border)
        self.tag_lower(self._shape)

    def outline(self, color: str | None, width: int | None = None) -> None:
        """משנה את המסגרת — לריחוף מעל אריח או להדגשת כרטיס."""
        self._outline = color or ""
        if width is not None:
            self._border = width
        self._draw(self.winfo_width(), self.winfo_height())


def card(parent, **kwargs) -> Card:
    return Card(parent, **kwargs)


# ---------------------------------------------------------- כיווניות טקסט
# Tk ב-Windows מצייר כל שורה כאילו היא באנגלית (משמאל לימין): המילים
# העבריות עצמן יוצאות נכון, אבל נקודה בסוף משפט קופצת לצד הלא נכון, מספר
# בתחילת שורה עובר לסוף, ומילה באנגלית באמצע משפט מחליפה מקום עם השכנות
# שלה. עטיפת כל שורה בסימני כיווניות בלתי נראים (RLE…PDF) אומרת למנוע
# הטקסט של Windows שזו שורה מימין לשמאל — וכל הבעיות האלה נעלמות יחד.
_RLE, _PDF = "\u202b", "\u202c"
_HEBREW = re.compile("[\u0590-\u05ff]")

# ריצה אחת של אותיות/ספרות לטיניות (שנשארת משמאל לימין), או תו בודד
_TOKEN = re.compile(r"[+\-\u2212]?[A-Za-z0-9]+(?:[:.,/'\-+][A-Za-z0-9]+)*|.", re.S)
# תווים שצריכים להתהפך כשהשורה מתהפכת
_MIRROR = {"(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{",
           "<": ">", ">": "<", "«": "»", "»": "«"}

_PROBE_WORD = "אבגד"
_reorder = False      # האם *אנחנו* צריכים להפוך את הסדר
_probed = False


def detect_direction(widget) -> bool:
    """שואל את Tk שבמחשב הזה אם הוא מסדר עברית בעצמו.

    מצייר מילה עברית ובודק איזו אות יצאה בקצה השמאלי. אם זו האות הראשונה,
    Tk מצייר לפי סדר ההקלדה ולא לפי כיוון הכתיבה — ואז אנחנו מספקים לו את
    הטקסט כשהוא כבר מסודר ויזואלית. מחזיר ``True`` אם נדרש סידור מצדנו.
    """
    global _reorder, _probed
    if _probed:
        return _reorder
    _probed = True
    canvas = None
    try:
        canvas = tk.Canvas(widget, width=240, height=60, highlightthickness=0)
        item = canvas.create_text(10, 30, text=_PROBE_WORD, anchor="w",
                                  font=font(14, root=widget))
        widget.update_idletasks()
        box = canvas.bbox(item)
        if box:
            x0, y0, x1, y1 = box
            middle = (y0 + y1) // 2
            leftmost = canvas.index(item, f"@{x0 + 3},{middle}")
            rightmost = canvas.index(item, f"@{x1 - 3},{middle}")
            # עברית מסודרת: האות האחרונה לוגית יושבת בקצה השמאלי
            _reorder = leftmost <= rightmost
    except Exception:
        _reorder = False
    finally:
        if canvas is not None:
            try:
                canvas.destroy()
            except Exception:
                pass
    return _reorder


def reorder_mode() -> bool:
    return _reorder


def set_reorder_mode(value: bool) -> None:
    """קביעה ידנית (בדיקות, או דריסה מההגדרות)."""
    global _reorder, _probed
    _reorder, _probed = bool(value), True


def visual(line: str) -> str:
    """שורה לוגית → סדר ויזואלי, בשביל מנוע טקסט שמצייר משמאל לימין.

    היפוך פשוט של המחרוזת היה הופך גם מספרים ומילים באנגלית ("12:34" →
    "43:21"), ולכן ריצות לטיניות נשמרות כיחידה אחת, וסוגריים מתהפכים.
    """
    tokens = [m.group() for m in _TOKEN.finditer(line)]
    tokens.reverse()
    return "".join(_MIRROR.get(t, t) if len(t) == 1 else t for t in tokens)


def rtl(text):
    """מכין טקסט עברי לתצוגה — בשיטה שמתאימה למנוע הטקסט שבמחשב הזה."""
    if not isinstance(text, str) or not _HEBREW.search(text):
        return text
    lines = text.replace(_RLE, "").replace(_PDF, "").split("\n")
    if _reorder:
        return "\n".join(visual(line) for line in lines)
    return "\n".join(_RLE + line + _PDF if line else line for line in lines)


def plain(text):
    """הטקסט כפי שהקוד (והבדיקות) רואים אותו — בלי סימנים ובסדר לוגי."""
    if not isinstance(text, str):
        return text
    text = text.replace(_RLE, "").replace(_PDF, "")
    if _reorder and _HEBREW.search(text):
        # ``visual`` הוא היפוך של עצמו: הפעלה שנייה מחזירה לסדר הלוגי
        return "\n".join(visual(line) for line in text.split("\n"))
    return text


class _RtlText:
    """מוסיף ל-Label/Radiobutton/Checkbutton את עטיפת הכיווניות, בשקיפות.

    ``configure(text=…)`` עוטף, ``cget("text")`` מחזיר את הטקסט המקורי.
    """

    def __init__(self, master=None, cnf=None, **kwargs):
        if "text" in kwargs:
            kwargs["text"] = rtl(kwargs["text"])
        super().__init__(master, cnf or {}, **kwargs)

    def configure(self, cnf=None, **kwargs):
        if isinstance(cnf, dict) and "text" in cnf:
            cnf = dict(cnf, text=rtl(cnf["text"]))
        if "text" in kwargs:
            kwargs["text"] = rtl(kwargs["text"])
        return super().configure(cnf, **kwargs)

    config = configure

    def cget(self, key):
        value = super().cget(key)
        return plain(str(value)) if key == "text" else value

    def __getitem__(self, key):
        return self.cget(key)

    def __setitem__(self, key, value):
        self.configure({key: value})


class RtlLabel(_RtlText, tk.Label):
    pass


class RtlRadiobutton(_RtlText, tk.Radiobutton):
    pass


class RtlCheckbutton(_RtlText, tk.Checkbutton):
    pass


# ------------------------------------------------------- תוויות ושדות קלט
def label(parent, text="", *, size=12, weight="normal", fg=TEXT, bg=None, **kwargs):
    return RtlLabel(
        parent, text=text, fg=fg, bg=bg if bg is not None else _surface(parent),
        font=font(size, weight, parent), **kwargs,
    )


def rtl_preview(parent, widget, **pack_options):
    """תצוגה מקדימה של טקסט עברי שמקלידים בשדה.

    בשדה עריכה אי אפשר לסדר את הטקסט ויזואלית: הסמן, המחיקה והסימון עובדים
    לפי הסדר הלוגי, וסידור היה מזיז אותם למקום הלא נכון. לכן השדה נשאר כמו
    שהוא, ומתחתיו מופיעה שורה שמראה איך הטקסט ייראה בפועל.

    מחזיר ``None`` כשאין צורך — כלומר כש-Tk כאן מסדר עברית בעצמו.
    """
    if not _reorder:
        return None

    preview = label(parent, "", size=10, fg=MUTED)
    preview.pack(**({"anchor": "e", "pady": (2, 0)} | pack_options))

    def read() -> str:
        try:
            if isinstance(widget, tk.Text):
                return widget.get("1.0", "end-1c")
            return widget.get()
        except tk.TclError:
            return ""

    def refresh(_event=None) -> None:
        value = read()
        if not _HEBREW.search(value):
            preview.configure(text="")
            return
        lines = [ln for ln in value.split("\n") if ln.strip()]
        preview.configure(text="כך זה ייראה:  " + "  ·  ".join(lines))

    for sequence in ("<KeyRelease>", "<<Paste>>", "<FocusOut>"):
        widget.bind(sequence, refresh, add="+")
    refresh()
    return preview


def entry(parent, *, show=None, width=18, size=14, justify="right"):
    """שדה קלט רך. Tk לא מעגל שדות, אז הרכות באה מהמילוי ומהריווח."""
    field = tk.Entry(
        parent, show=show, width=width, font=font(size, "normal", parent), justify=justify,
        bg=PANEL2, fg=TEXT, insertbackground=ACCENT, relief="flat", bd=0,
        highlightthickness=2, highlightbackground=PANEL2, highlightcolor=ACCENT,
        disabledbackground=mix(PANEL2, BG, 0.5), disabledforeground=MUTED,
    )
    return field


def choice(parent, text: str, value, variable, command=None, *, bg=PANEL, size=12):
    """כפתור בחירה (רדיו) בסגנון בהיר ואחיד."""
    return RtlRadiobutton(
        parent, text=text, value=value, variable=variable, command=command,
        bg=bg, fg=TEXT, selectcolor=PANEL, activebackground=bg, activeforeground=ACCENT,
        font=font(size, "normal", parent), bd=0, highlightthickness=0, anchor="e",
        cursor="hand2",
    )


def toggle(parent, text: str, variable, command=None, *, bg=PANEL, size=12):
    """תיבת סימון בסגנון בהיר ואחיד."""
    return RtlCheckbutton(
        parent, text=text, variable=variable, command=command,
        bg=bg, fg=TEXT, selectcolor=PANEL, activebackground=bg, activeforeground=ACCENT,
        font=font(size, "normal", parent), bd=0, highlightthickness=0, anchor="e",
        cursor="hand2",
    )


# ------------------------------------------------------------ טבעת התקדמות
MIN_RING_DEGREES = 6.0   # פחות מזה לא נראה על המסך


def ring(canvas: tk.Canvas, x: int, y: int, radius: int, fraction: float, color: str,
         width: int = 12, track: str = None) -> None:
    """טבעת התקדמות: ``fraction`` הוא החלק שנותר (0..1).

    טבעת מלאה מצוירת כעיגול ולא כקשת: על Windows קשת בהיקף ~360° מחשבת שתי
    נקודות קצה שמתעגלות לאותו פיקסל, והתוצאה על המסך היא רסיס במקום מעגל —
    כלומר ילד/ה שעוד לא השתמשו בכלום נראו כאילו נגמר להם הזמן. בדיוק הפוך.
    """
    canvas.delete("ring")
    box = (x - radius, y - radius, x + radius, y + radius)
    canvas.create_oval(*box, outline=track or tint(color, 0.82), width=width, tags="ring")
    fraction = max(0.0, min(1.0, fraction))
    if fraction >= 0.999:
        canvas.create_oval(*box, outline=color, width=width, tags="ring")
    elif fraction > 0:
        # שארית זעירה עדיין מקבלת קשת שאפשר לראות
        degrees = max(MIN_RING_DEGREES, 359.0 * fraction)
        canvas.create_arc(
            *box, start=90, extent=-degrees, style=tk.ARC,
            outline=color, width=width, tags="ring",
        )


# ------------------------------------------------------------------ חלונות
def dress(win: tk.Toplevel | tk.Tk, *, bg=PANEL) -> None:
    """מראה אחיד לחלונות: רקע בהיר ובלי מסגרת עבה."""
    win.configure(bg=bg)
    try:
        win.attributes("-topmost", True)
    except tk.TclError:
        pass


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
