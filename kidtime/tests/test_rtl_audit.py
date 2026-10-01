"""ביקורת כיווניות: כל טקסט עברי שמגיע ל-Tk חייב לעבור דרך ``theme.rtl``.

הבדיקה פותחת כל מסך במערכת, עוברת על כל הווידג'טים והפריטים בקנבס, ומשווה
את מה ש-Tk באמת מחזיק מול מה ש-``rtl`` היה מייצר. ווידג'ט שעוקף את המנגנון
נשאר עם טקסט בסדר לוגי — וכאן זה ייפול.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

tk = pytest.importorskip("tkinter")
if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
    pytest.skip("אין תצוגה גרפית", allow_module_level=True)

from kidtime import theme  # noqa: E402
from kidtime.app import KidTimeApp  # noqa: E402
from kidtime.grace import GraceWindow  # noqa: E402
from kidtime.lockscreen import RequestDialog  # noqa: E402
from kidtime.parent import ChangePin, Confirm, Notice, ParentPanel, PinDialog  # noqa: E402
from kidtime.setup_wizard import SetupWizard  # noqa: E402
from kidtime.store import Store  # noqa: E402

HEBREW = theme._HEBREW
# שדות קלט מוחרגים: הטקסט בהם נערך על ידי המשתמש/ת, וסידור ויזואלי שלו
# היה שובר את מיקום הסמן ואת המחיקה. ראו ``rtl_preview``.
INPUT_WIDGETS = (tk.Entry, tk.Text, tk.Spinbox)


@pytest.fixture(scope="module")
def root():
    r = tk.Tk()
    r.withdraw()
    yield r
    r.destroy()


@pytest.fixture()
def app(tmp_path, root):
    previous = theme.reorder_mode()
    theme.set_reorder_mode(True)          # מדמה מחשב שבו Tk לא מסדר
    store = Store(tmp_path / "state.json", backup=None)
    store.set_pin("1234")
    store.add_child("נועם")
    store.add_child("יעל")
    store.save()
    instance = KidTimeApp(windowed=True, store=store, root=root)
    yield instance
    theme.set_reorder_mode(previous)
    for widget in list(root.winfo_children()):
        try:
            widget.destroy()
        except tk.TclError:
            pass


def pump(app, times: int = 3) -> None:
    for _ in range(times):
        app.root.update_idletasks()
        app.root.update()


def _raw(widget) -> str | None:
    try:
        return str(widget.tk.call(str(widget), "cget", "-text"))
    except tk.TclError:
        return None


def offenders(widget, found=None, path="") -> list[tuple[str, str]]:
    """מחזיר (נתיב, טקסט) לכל מקום שבו עברית הגיעה ל-Tk בלי סידור."""
    found = [] if found is None else found
    here = f"{path}/{widget.winfo_class()}"

    if isinstance(widget, tk.Canvas):
        for item in widget.find_all():
            if widget.type(item) != "text":
                continue
            text = str(widget.itemcget(item, "text"))
            if HEBREW.search(text) and theme.rtl(theme.plain(text)) != text:
                found.append((f"{here}[canvas item {item}]", text))
    elif not isinstance(widget, INPUT_WIDGETS):
        text = _raw(widget)
        if text and HEBREW.search(text):
            logical = widget.cget("text") if hasattr(widget, "cget") else text
            if theme.rtl(logical) != text:
                found.append((here, text))

    for index, child in enumerate(widget.winfo_children()):
        offenders(child, found, f"{here}[{index}]")
    return found


def check(app, label: str) -> None:
    pump(app)
    bad = []
    for window in app.root.winfo_children():
        bad += offenders(window)
    assert not bad, f"עברית לא מסודרת ב{label}:\n" + "\n".join(
        f"  {where}: {text!r}" for where, text in bad)


# ------------------------------------------------------------------ המסכים
def test_lock_screen(app):
    app.enter_locked()
    check(app, "מסך הנעילה")


def test_lock_screen_with_a_child_out_of_time(app):
    kid = app.store.children[0]
    app.store.add_usage(kid["id"], app.store.quota_seconds(kid["id"]))
    app.enter_locked()
    app.lock.tick()
    check(app, "מסך נעילה עם ילד/ה שנגמר לו הזמן")


def test_lock_screen_message(app):
    app.enter_locked()
    app.lock.message("הזמן של נועם להיום נגמר. אפשר לבקש תוספת מההורים.")
    check(app, "הודעה במסך הנעילה")


def test_session_hud(app):
    app.start_session(app.store.children[0]["id"])
    app.hud.update_session("נועם", 754, False)
    check(app, "הפס הצף בזמן שימוש")


def test_session_hud_paused(app):
    app.start_session(app.store.children[0]["id"])
    app.hud.update_session("נועם", 61, True)
    check(app, "הפס הצף במצב מושהה")


def test_disabled_hud(app):
    app.store.disable_for(60)
    app._tick_once()
    app.hud.update_disabled("21:30")
    check(app, "הפס הצף בהשבתה")


def test_grace_window(app):
    app.enter_grace(45)
    app.grace.tick()
    check(app, "חלון הבטיחות")


def test_setup_wizard(app):
    SetupWizard(app, lambda: None)
    check(app, "אשף ההגדרה")


def test_pin_dialog(app):
    app.enter_locked()
    PinDialog(app, lambda: None)
    check(app, "דיאלוג קוד ההורים")


def test_request_dialog(app):
    app.enter_locked()
    RequestDialog(app, app.store.children[0]["id"])
    check(app, "דיאלוג בקשת זמן")


def test_notice_window(app):
    app.enter_locked()
    Notice(app, "נדרש שחזור", app.DAMAGED_HELP)
    check(app, "חלון ההודעה")


def test_confirm_window(app):
    app.enter_locked()
    Confirm(app, "למחוק את נועם?", "היסטוריית השימוש תישאר.", lambda: None)
    check(app, "חלון האישור")


def test_change_pin_window(app):
    app.enter_locked()
    ChangePin(app)
    check(app, "חלון שינוי הקוד")


def test_toast(app):
    app.enter_locked()
    app.toast("שלום נועם! נותרו 20:00", theme.OK, 9)
    check(app, "הודעה מוקפצת")


@pytest.mark.parametrize("tab", ["requests", "time", "disable", "children", "settings"])
def test_parent_panel_tabs(app, tab):
    kid = app.store.children[0]
    app.store.create_request(kid["id"], 10, "רוצה לסיים משחק")
    app.store.disable_for(30)
    panel = ParentPanel(app)
    panel.open_tab(tab)
    check(app, f"פאנל ההורים — לשונית {tab}")
    panel.close()


def test_parent_panel_history_and_status(app):
    kid = app.store.children[0]
    request = app.store.create_request(kid["id"], 10, "בבקשה")
    app.store.decide_request(request["id"], True)
    panel = ParentPanel(app)
    panel.open_tab("requests")
    panel.say("אושרו 10 דקות לנועם.")
    check(app, "היסטוריית בקשות והודעת סטטוס")
    panel.close()


# ------------------------------------------------- שהביקורת באמת יודעת ליפול
def test_the_audit_catches_a_widget_that_skips_rtl(app):
    """בלי זה, ביקורת שעוברת תמיד לא מוכיחה כלום."""
    app.enter_locked()
    pump(app)
    bypass = tk.Label(app.lock.win, text="טקסט שעוקף את הסידור")
    bypass.pack()
    pump(app)
    try:
        found = offenders(app.lock.win)
        assert found, "הביקורת לא תפסה ווידג'ט שעוקף את rtl"
        assert any("טקסט" in text for _where, text in found)
    finally:
        bypass.destroy()


def test_the_audit_ignores_text_that_has_no_hebrew(app):
    app.enter_locked()
    pump(app)
    latin = tk.Label(app.lock.win, text="KidTime 1.3.0")
    latin.pack()
    pump(app)
    try:
        assert offenders(app.lock.win) == []
    finally:
        latin.destroy()


# ------------------------------------------- תצוגה מקדימה לשדות הקלדה
# ‎<KeyRelease>‎ סינתטי לא נמסר בסביבה הזו (Tk מנתב אירועי מקלדת דרך
# הפוקוס של מנהל החלונות). ‎<FocusOut>‎ קשור לאותה פונקציית רענון בדיוק,
# ולכן הוא מפעיל את אותו מסלול קוד.
REFRESH = "<FocusOut>"


def _text_of(widget) -> str:
    return str(widget.tk.call(str(widget), "cget", "-text"))


def test_preview_shows_the_visual_form_while_typing(app):
    host = tk.Toplevel(app.root)          # חלון ממופה — אחרת אין אירועים
    host.geometry("300x150+0+0")
    field = theme.entry(host)
    field.pack()
    preview = theme.rtl_preview(host, field)
    assert preview is not None
    pump(app)
    field.insert(0, "נועם")
    field.event_generate(REFRESH)
    pump(app)
    shown = _text_of(preview)
    assert "נועם" not in shown                      # מוצג בסדר ויזואלי
    assert theme.plain(shown).endswith("נועם")      # ומתאר את מה שהוקלד
    host.destroy()


def test_preview_stays_empty_for_latin_text(app):
    host = tk.Toplevel(app.root)
    host.geometry("300x150+0+0")
    field = theme.entry(host)
    field.pack()
    preview = theme.rtl_preview(host, field)
    pump(app)
    field.insert(0, "KidTime")
    field.event_generate(REFRESH)
    pump(app)
    assert _text_of(preview) == ""
    host.destroy()


def test_preview_handles_the_multi_line_names_box(app):
    host = tk.Toplevel(app.root)
    host.geometry("300x200+0+0")
    box = tk.Text(host, height=3)
    box.pack()
    preview = theme.rtl_preview(host, box)
    pump(app)
    box.insert("1.0", "נועם\nיעל\n")
    box.event_generate(REFRESH)
    pump(app)
    logical = theme.plain(_text_of(preview))
    assert "נועם" in logical and "יעל" in logical
    host.destroy()


def test_no_preview_where_tk_reorders_by_itself(app):
    theme.set_reorder_mode(False)
    field = theme.entry(app.root)
    assert theme.rtl_preview(app.root, field) is None
    field.destroy()


def test_the_wizard_offers_a_preview_for_the_names_box(app):
    wizard = SetupWizard(app, lambda: None)
    pump(app)
    wizard.names.insert("1.0", "נועם\n")
    wizard.names.event_generate(REFRESH)
    pump(app)
    previews = []

    def walk(widget):
        for child in widget.winfo_children():
            text = _text_of(child) if child.winfo_class() == "Label" else ""
            if text and "נועם" in theme.plain(text):
                previews.append(theme.plain(text))
            walk(child)

    walk(wizard.win)
    assert previews, "אין תצוגה מקדימה לשמות שהוקלדו"
