"""בדיקת עשן לממשק: פותחת כל מסך ומוודאת שאין שגיאות Tk.

מדלגת אוטומטית כשאין tkinter או אין תצוגה (למשל ב-CI ללא X).
"""
from __future__ import annotations

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

tk = pytest.importorskip("tkinter")
if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
    pytest.skip("אין תצוגה גרפית", allow_module_level=True)

from kidtime.app import KidTimeApp  # noqa: E402
from kidtime.control import SingleInstance, send_stop  # noqa: E402
from kidtime.lockscreen import RequestDialog  # noqa: E402
from kidtime.parent import ChangePin, Confirm, ParentPanel, PinDialog  # noqa: E402
from kidtime.setup_wizard import SetupWizard  # noqa: E402
from kidtime.store import Store  # noqa: E402


@pytest.fixture(scope="session")
def tk_root():
    """שורש Tk אחד לכל הריצה — כמה מפרשי Tk בתהליך אחד מתנגשים."""
    root = tk.Tk()
    root.withdraw()
    yield root
    root.destroy()


@pytest.fixture()
def clean_root(tk_root):
    yield tk_root
    for widget in list(tk_root.winfo_children()):
        try:
            widget.destroy()
        except tk.TclError:
            pass


@pytest.fixture()
def app(tmp_path, clean_root):
    store = Store(tmp_path / "state.json")
    store.set_pin("1234")
    store.add_child("נועם")
    store.add_child("יעל")
    store.save()
    return KidTimeApp(windowed=True, store=store, root=clean_root)


def pump(app, times: int = 3) -> None:
    for _ in range(times):
        app.root.update_idletasks()
        app.root.update()


def test_lock_screen_renders_a_tile_per_child(app):
    app.enter_locked()
    pump(app)
    assert len(app.lock._tiles) == 2
    assert app.lock.visible is True


def test_session_hides_the_lock_screen_and_shows_the_hud(app):
    child_id = app.store.children[0]["id"]
    app.enter_locked()
    app.start_session(child_id)
    pump(app)
    assert app.mode == "session"
    assert app.lock.visible is False
    assert app.hud.visible is True


def test_session_ends_and_returns_to_the_lock_screen_when_time_runs_out(app):
    kid = app.store.children[0]
    app.enter_locked()
    app.start_session(kid["id"])
    app.store.add_usage(kid["id"], app.store.quota_seconds(kid["id"]))
    app._tick_once()
    pump(app)
    assert app.session is None
    assert app.mode == "locked"
    assert app.lock.visible is True


def test_ticking_a_session_charges_the_child(app):
    kid = app.store.children[0]
    app.start_session(kid["id"])
    app.session["mono"] -= 3          # כאילו עברו 3 שניות
    app._tick_once()
    assert app.store.used_seconds(kid["id"]) >= 3


def test_child_with_no_time_left_cannot_start_a_session(app):
    kid = app.store.children[0]
    app.store.add_usage(kid["id"], app.store.quota_seconds(kid["id"]))
    app.enter_locked()
    app.lock._pick(kid["id"])         # פותח בקשה במקום להתחיל
    pump(app)
    assert app.session is None
    assert app.modal_open is True


def test_request_dialog_creates_a_pending_request(app):
    kid = app.store.children[1]
    dialog = RequestDialog(app, kid["id"])
    pump(app)
    dialog.minutes_var.set(15)
    dialog.reason.insert(0, "שיעורי בית")
    dialog.submit()
    pump(app)
    pending = app.store.pending_requests()
    assert len(pending) == 1
    assert pending[0]["child_id"] == kid["id"]
    assert pending[0]["minutes"] == 15
    assert app.modal_open is False


def test_disabled_mode_replaces_the_lock_screen(app):
    app.store.disable_for(30)
    app._tick_once()
    pump(app)
    assert app.mode == "disabled"
    assert app.lock.visible is False
    assert app.hud.visible is True


def test_every_parent_tab_renders(app):
    app.store.create_request(app.store.children[0]["id"], 10, "בבקשה")
    panel = ParentPanel(app)
    pump(app)
    for tab in ("requests", "time", "disable", "children", "settings"):
        panel.open_tab(tab)
        pump(app)
        assert panel.current == tab
    panel.close()
    pump(app)


def test_parent_panel_approves_a_request(app):
    kid = app.store.children[0]
    app.store.add_usage(kid["id"], app.store.quota_seconds(kid["id"]))
    request = app.store.create_request(kid["id"], 10)
    panel = ParentPanel(app)
    panel.open_tab("requests")
    pump(app)
    panel._decide(request, True)
    pump(app)
    assert app.store.remaining_seconds(kid["id"]) == 10 * 60
    panel.close()


def test_pin_dialog_rejects_a_wrong_code_and_accepts_the_right_one(app):
    opened = []
    dialog = PinDialog(app, lambda: opened.append(True))
    pump(app)
    dialog.entry.insert(0, "0000")
    dialog.submit()
    pump(app)
    assert opened == []
    dialog.entry.insert(0, "1234")
    dialog.submit()
    pump(app)
    assert opened == [True]


def test_change_pin_flow(app):
    dialog = ChangePin(app)
    pump(app)
    dialog.fields["current"].insert(0, "1234")
    dialog.fields["new"].insert(0, "5678")
    dialog.fields["again"].insert(0, "5678")
    dialog.submit()
    pump(app)
    assert app.store.check_pin("5678") is True


def test_setup_wizard_sets_pin_and_children(tmp_path, clean_root):
    store = Store(tmp_path / "state.json")
    app = KidTimeApp(windowed=True, store=store, root=clean_root)
    done = []
    wizard = SetupWizard(app, lambda: done.append(True))
    pump(app)
    wizard.pin.insert(0, "2468")
    wizard.pin2.insert(0, "2468")
    wizard.names.insert("1.0", "דניאל\nשירה\n")
    wizard.minutes.delete(0, "end")
    wizard.minutes.insert(0, "25")
    wizard.submit()
    pump(app)
    assert done == [True]
    assert [k["name"] for k in store.children] == ["דניאל", "שירה"]
    assert store.cfg("daily_minutes") == 25
    assert store.check_pin("2468") is True


def test_confirm_dialog_runs_its_action(app):
    fired = []
    dialog = Confirm(app, "בדיקה", "גוף", lambda: fired.append(True))
    pump(app)
    dialog._yes()
    pump(app)
    assert fired == [True]


def test_toast_appears_and_can_be_replaced(app):
    app.toast("שלום")
    app.toast("שוב")
    pump(app)
    assert app._toast is not None and app._toast.winfo_exists()


def test_unconfigured_computer_is_not_locked_before_setup(tmp_path, clean_root):
    """הבאג של 8.9.2026: מערכת בלי ילדים נעלה את המחשב מאחורי אשף ההגדרה."""
    store = Store(tmp_path / "state.json")          # בלי קוד הורים ובלי ילדים
    app = KidTimeApp(windowed=True, store=store, root=clean_root)
    app.start()
    pump(app)
    app._tick_once()
    pump(app)
    assert app.setup_mode is True
    assert app.lock.visible is False
    assert app.mode is None


def test_locking_starts_only_after_setup_completes(tmp_path, clean_root):
    store = Store(tmp_path / "state.json")
    store.set_cfg("setup_grace_minutes", 0)   # בלי חלון בטיחות — נעילה מיד
    app = KidTimeApp(windowed=True, store=store, root=clean_root)
    app.start()
    pump(app)
    assert app.lock.visible is False          # בזמן האשף אין נעילה
    store.set_pin("1234")
    store.add_child("נועם")
    app._setup_finished()
    pump(app)
    assert app.setup_mode is False
    assert app.lock.visible is True


def test_configured_computer_locks_immediately(app):
    app.store.set_cfg("grace_seconds", 0)     # בלי חלון בטיחות
    app.start()
    pump(app)
    assert app.setup_mode is False
    assert app.lock.visible is True


def _stop_while_ticking(app, pin: str, port: int) -> str:
    """שולח --stop מתהליך אחר תוך כדי שהמערכת ממשיכה לתקתק.

    ב-``--stop`` האמיתי אלה שני תהליכים נפרדים; בבדיקה צריך חוט כדי שהשולח
    לא יחסום את הלולאה שאמורה לענות לו.
    """
    answer: dict[str, str] = {}
    caller = threading.Thread(target=lambda: answer.update(value=send_stop(pin, port=port)))
    caller.start()
    for _ in range(50):
        if not caller.is_alive():
            break
        app._tick_once()
        pump(app, 1)
        time.sleep(0.02)
    caller.join(timeout=5)
    return answer.get("value", "no-answer")


def test_stop_command_needs_the_right_pin(app):
    app.guard = SingleInstance(0)
    try:
        app.enter_locked()
        pump(app)
        assert _stop_while_ticking(app, "0000", app.guard.port) == "bad-pin"
        assert app._stopping is False
        assert app.lock.visible is True
    finally:
        app.guard.release()


def test_stop_command_shuts_down_with_the_right_pin(app):
    app.guard = SingleInstance(0)
    try:
        app.enter_locked()
        pump(app)
        assert _stop_while_ticking(app, "1234", app.guard.port) == "ok"
        assert app._stopping is True
    finally:
        app.guard.release()


def test_grace_window_opens_before_locking(app):
    app.store.set_cfg("grace_seconds", 5)
    app.start()
    pump(app)
    assert app.mode == "grace"
    assert app.grace.visible is True
    assert app.lock.visible is False


def test_grace_window_locks_when_the_countdown_ends(app):
    app.store.set_cfg("grace_seconds", 2)
    app.start()
    pump(app)
    for _ in range(3):
        app._tick_once()
        pump(app, 1)
    assert app.mode == "locked"
    assert app.grace.visible is False
    assert app.lock.visible is True


def test_grace_is_not_given_twice_for_the_same_boot(app):
    app.store.set_cfg("grace_seconds", 5)
    app.start()
    pump(app)
    assert app.mode == "grace"
    second = KidTimeApp(windowed=True, store=app.store, root=app.root)
    second.start()
    pump(app)
    assert second.mode == "locked"


def test_pausing_the_grace_window_keeps_the_computer_open(app):
    app.store.set_cfg("grace_seconds", 5)
    app.store.set_cfg("setup_grace_minutes", 15)
    app.start()
    pump(app)
    app.grace._apply_pause()          # אחרי אישור קוד ההורים
    pump(app)
    assert app.mode == "disabled"
    assert app.store.is_disabled() is True
    assert app.lock.visible is False


def test_setup_leaves_the_computer_open_instead_of_locking(tmp_path, clean_root):
    store = Store(tmp_path / "state.json")
    app = KidTimeApp(windowed=True, store=store, root=clean_root)
    app.start()
    pump(app)
    store.set_pin("1234")
    store.add_child("נועם")
    app._setup_finished()
    pump(app)
    assert app.mode == "disabled"         # לא ננעל מיד אחרי האשף
    assert store.is_disabled() is True
    assert app.lock.visible is False


def test_adding_a_child_from_the_parent_panel(app):
    panel = ParentPanel(app)
    panel.open_tab("children")
    pump(app)
    panel.new_child_entry.insert(0, "אורי")
    panel.new_child_entry.event_generate("<Return>")   # Enter מוסיף, לא רק הכפתור
    pump(app)
    assert "אורי" in [kid["name"] for kid in app.store.children]
    panel.close()


def test_new_child_appears_on_the_lock_screen_without_a_restart(app):
    """באג: אריח חדש לא הופיע עד שמצב המערכת השתנה."""
    app.enter_locked()
    pump(app)
    before = len(app.lock._tiles)
    app.store.add_child("אורי")
    app.lock.tick()
    pump(app)
    assert len(app.lock._tiles) == before + 1


def test_removing_a_child_clears_the_tile(app):
    app.enter_locked()
    pump(app)
    kid = app.store.children[0]
    app.store.remove_child(kid["id"])
    app.lock.tick()
    pump(app)
    assert kid["id"] not in app.lock._tiles


def test_renaming_a_child_updates_the_tile(app):
    app.enter_locked()
    pump(app)
    kid = app.store.children[0]
    app.store.rename_child(kid["id"], "נועם החדש")
    app.lock.tick()
    pump(app)
    assert app.lock._tiles[kid["id"]]["name"]["text"] == "נועם החדש"


def test_settings_tab_is_taller_than_the_window_and_scrolls(app):
    """הכפתורים בתחתית ההגדרות היו מחוץ לחלון ובלי דרך להגיע אליהם."""
    panel = ParentPanel(app)
    panel.open_tab("settings")
    pump(app)
    panel.win.geometry("820x600")
    pump(app)
    top, bottom = panel.canvas.yview()
    assert (bottom - top) < 1.0          # התוכן באמת ארוך מהחלון
    panel.canvas.yview_moveto(1.0)
    pump(app)
    assert panel.canvas.yview()[1] == 1.0   # אפשר להגיע עד הסוף
    panel.close()


def test_change_pin_button_exists_in_settings(app):
    panel = ParentPanel(app)
    panel.open_tab("settings")
    pump(app)
    labels = []

    def walk(widget):
        for child in widget.winfo_children():
            text = ""
            try:
                text = str(child.cget("text"))
            except tk.TclError:
                pass
            if text:
                labels.append(text)
            walk(child)

    walk(panel.body)
    assert "שינוי קוד הורים" in labels
    assert "כיבוי המערכת" in labels
    panel.close()


def test_changing_the_pin_rejects_a_wrong_current_code(app):
    dialog = ChangePin(app)
    pump(app)
    dialog.fields["current"].insert(0, "9999")
    dialog.fields["new"].insert(0, "5678")
    dialog.fields["again"].insert(0, "5678")
    dialog.submit()
    pump(app)
    assert app.store.check_pin("1234") is True     # הקוד הישן עדיין תקף
    assert app.store.check_pin("5678") is False
    dialog.close()


def test_changing_the_pin_rejects_a_mismatched_confirmation(app):
    dialog = ChangePin(app)
    pump(app)
    dialog.fields["current"].insert(0, "1234")
    dialog.fields["new"].insert(0, "5678")
    dialog.fields["again"].insert(0, "8765")
    dialog.submit()
    pump(app)
    assert app.store.check_pin("1234") is True
    dialog.close()
