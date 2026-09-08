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
    app = KidTimeApp(windowed=True, store=store, root=clean_root)
    app.start()
    pump(app)
    store.set_pin("1234")
    store.add_child("נועם")
    app._setup_finished()
    pump(app)
    assert app.setup_mode is False
    assert app.lock.visible is True


def test_configured_computer_locks_immediately(app):
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
