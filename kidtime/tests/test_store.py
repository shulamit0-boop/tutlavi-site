"""בדיקות ללוגיקת הזמן — בלי Tk וללא תלות במערכת ההפעלה."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kidtime.store import Store  # noqa: E402


@pytest.fixture()
def store(tmp_path):
    return Store(tmp_path / "state.json")


def test_new_child_gets_default_quota(store):
    kid = store.add_child("נועם")
    assert store.quota_seconds(kid["id"]) == 20 * 60
    assert store.remaining_seconds(kid["id"]) == 20 * 60


def test_per_child_quota_overrides_default(store):
    kid = store.add_child("יעל", daily_minutes=45)
    assert store.quota_seconds(kid["id"]) == 45 * 60
    store.set_child_quota(kid["id"], None)
    assert store.quota_seconds(kid["id"]) == 20 * 60


def test_usage_reduces_remaining_and_floors_at_zero(store):
    kid = store.add_child("נועם")
    store.add_usage(kid["id"], 19 * 60)
    assert store.remaining_seconds(kid["id"]) == 60
    store.add_usage(kid["id"], 300)
    assert store.remaining_seconds(kid["id"]) == 0


def test_children_have_separate_quotas(store):
    first = store.add_child("א")
    second = store.add_child("ב")
    store.add_usage(first["id"], 20 * 60)
    assert store.remaining_seconds(first["id"]) == 0
    assert store.remaining_seconds(second["id"]) == 20 * 60


def test_quota_resets_on_a_new_day(store):
    kid = store.add_child("נועם")
    monday = datetime(2026, 9, 7, 17, 0)
    store.add_usage(kid["id"], 20 * 60, monday)
    assert store.remaining_seconds(kid["id"], monday) == 0
    tuesday = monday + timedelta(days=1)
    assert store.remaining_seconds(kid["id"], tuesday) == 20 * 60


def test_day_starts_at_reset_hour_not_midnight(store):
    kid = store.add_child("נועם")
    late = datetime(2026, 9, 7, 23, 30)
    store.add_usage(kid["id"], 20 * 60, late)
    # 02:00 עדיין נחשב אותו יום — לא מכסה חדשה
    assert store.remaining_seconds(kid["id"], datetime(2026, 9, 8, 2, 0)) == 0
    # 04:00 זה כבר יום חדש
    assert store.remaining_seconds(kid["id"], datetime(2026, 9, 8, 4, 1)) == 20 * 60


def test_setting_the_clock_back_does_not_grant_a_fresh_quota(store):
    kid = store.add_child("נועם")
    today = datetime(2026, 9, 8, 12, 0)
    store.add_usage(kid["id"], 20 * 60, today)
    yesterday = today - timedelta(days=3)
    assert store.remaining_seconds(kid["id"], yesterday) == 0
    assert store.data["clock_warning"] is True


def test_bonus_minutes_extend_today_only(store):
    kid = store.add_child("נועם")
    now = datetime(2026, 9, 8, 12, 0)
    store.add_usage(kid["id"], 20 * 60, now)
    store.grant_minutes(kid["id"], 10, now)
    assert store.remaining_seconds(kid["id"], now) == 10 * 60
    tomorrow = now + timedelta(days=1)
    assert store.remaining_seconds(kid["id"], tomorrow) == 20 * 60


def test_reset_today_clears_usage_and_bonus(store):
    kid = store.add_child("נועם")
    store.add_usage(kid["id"], 600)
    store.grant_minutes(kid["id"], 30)
    store.reset_today(kid["id"])
    assert store.remaining_seconds(kid["id"]) == 20 * 60


def test_approved_request_adds_the_minutes(store):
    kid = store.add_child("נועם")
    store.add_usage(kid["id"], 20 * 60)
    request = store.create_request(kid["id"], 15, "רוצה לסיים משחק")
    assert len(store.pending_requests()) == 1
    assert store.decide_request(request["id"], True) is True
    assert store.remaining_seconds(kid["id"]) == 15 * 60
    assert store.pending_requests() == []


def test_parent_can_approve_fewer_minutes_than_requested(store):
    kid = store.add_child("נועם")
    request = store.create_request(kid["id"], 30)
    store.decide_request(request["id"], True, minutes=5)
    assert store.remaining_seconds(kid["id"]) == 25 * 60
    assert store.request(request["id"])["granted_minutes"] == 5


def test_denied_request_grants_nothing_and_cannot_be_decided_twice(store):
    kid = store.add_child("נועם")
    request = store.create_request(kid["id"], 10)
    store.decide_request(request["id"], False)
    assert store.remaining_seconds(kid["id"]) == 20 * 60
    assert store.decide_request(request["id"], True) is False


def test_request_minutes_are_capped(store):
    kid = store.add_child("נועם")
    store.set_cfg("max_request_minutes", 20)
    assert store.create_request(kid["id"], 999)["minutes"] == 20


def test_disable_window_expires_by_itself(store):
    now = datetime(2026, 9, 8, 12, 0)
    store.disable_for(60, now)
    assert store.is_disabled(now + timedelta(minutes=30)) is True
    assert store.is_disabled(now + timedelta(minutes=61)) is False
    assert store.data["disabled_until"] is None


def test_enable_now_ends_the_disable_window(store):
    store.disable_for(120)
    store.enable_now()
    assert store.is_disabled() is False


def test_pin_is_hashed_and_verified(store):
    store.set_pin("1234")
    assert "1234" not in store.path.read_text(encoding="utf-8") if store.path.exists() else True
    assert store.check_pin("1234") is True
    assert store.check_pin("9999") is False


def test_pin_locks_out_after_repeated_failures(store):
    store.set_pin("1234")
    now = datetime(2026, 9, 8, 12, 0)
    for _ in range(int(store.cfg("pin_max_failures"))):
        assert store.check_pin("0000", now) is False
    assert store.pin_locked_for(now) > 0
    assert store.check_pin("1234", now) is False           # נכון, אבל נעול
    later = now + timedelta(minutes=int(store.cfg("pin_lock_minutes")) + 1)
    assert store.pin_locked_for(later) == 0
    assert store.check_pin("1234", later) is True


def test_pin_shorter_than_four_digits_is_rejected(store):
    with pytest.raises(ValueError):
        store.set_pin("12")


def test_state_survives_a_save_and_reload(store, tmp_path):
    kid = store.add_child("נועם")
    store.add_usage(kid["id"], 300)
    store.set_pin("4321")
    store.save()
    reloaded = Store(tmp_path / "state.json")
    assert [k["name"] for k in reloaded.children] == ["נועם"]
    assert reloaded.used_seconds(kid["id"]) == 300
    assert reloaded.check_pin("4321") is True


def test_corrupt_state_file_is_set_aside_not_crashed(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{ לא JSON", encoding="utf-8")
    store = Store(path)
    assert store.children == []
    assert (tmp_path / "state.corrupt.json").exists()


def test_history_is_pruned_on_save(store, tmp_path):
    store.set_cfg("keep_history_days", 3)
    kid = store.add_child("נועם")
    for day in range(10):
        store.add_usage(kid["id"], 60, datetime(2026, 1, 1) + timedelta(days=day))
    store.save()
    assert len(store.data["usage"]) == 3


def test_removing_a_child_drops_their_requests(store):
    kid = store.add_child("נועם")
    store.create_request(kid["id"], 10)
    store.remove_child(kid["id"])
    assert store.children == []
    assert store.pending_requests() == []


def test_boot_grace_is_given_once_per_boot(store):
    boot = 1_700_000_000.0
    assert store.claim_boot_grace(boot) is True      # הדלקה חדשה
    assert store.claim_boot_grace(boot) is False     # אותה הדלקה — לא שוב
    assert store.claim_boot_grace(boot + 30) is False  # סחיפה קטנה בשעון
    assert store.claim_boot_grace(boot + 5000) is True  # הדלקה אחרת


def test_boot_grace_is_given_when_boot_time_is_unknown(store):
    assert store.claim_boot_grace(0) is True
    assert store.claim_boot_grace(0) is True


# ------------------------------------------ עמידות מול מחיקה וחבלה בקבצים
def test_deleting_the_state_file_restores_from_the_backup(tmp_path):
    backup = tmp_path / "shared" / "state.backup.json"
    store = Store(tmp_path / "state.json", backup=backup)
    store.set_pin("1234")
    kid = store.add_child("נועם")
    store.save()
    assert backup.exists()

    (tmp_path / "state.json").unlink()          # ילד/ה מוחקים את קובץ המצב
    recovered = Store(tmp_path / "state.json", backup=backup)
    assert recovered.restored_from_backup is True
    assert recovered.check_pin("1234") is True
    assert [k["name"] for k in recovered.children] == ["נועם"]
    assert recovered.child(kid["id"]) is not None


def test_a_corrupt_state_file_also_falls_back_to_the_backup(tmp_path):
    backup = tmp_path / "shared" / "state.backup.json"
    store = Store(tmp_path / "state.json", backup=backup)
    store.set_pin("1234")
    store.add_child("יעל")
    store.save()

    (tmp_path / "state.json").write_text("{ זבל", encoding="utf-8")
    recovered = Store(tmp_path / "state.json", backup=backup)
    assert recovered.restored_from_backup is True
    assert recovered.check_pin("1234") is True


def test_the_marker_survives_deleting_only_the_state_file(tmp_path):
    """בלי גיבוי כלל — הסימן לבדו מונע חזרה למצב "מחשב חדש"."""
    store = Store(tmp_path / "state.json", backup=None)
    store.set_pin("1234")
    store.save()
    assert (tmp_path / "installed").exists()

    (tmp_path / "state.json").unlink()
    fresh = Store(tmp_path / "state.json", backup=None)
    assert fresh.was_configured is True          # לא "מחשב חדש"
    assert fresh.has_pin is False                # ואין ממה לשחזר — נעילה


def test_a_truly_fresh_computer_is_not_marked_as_configured(tmp_path):
    store = Store(tmp_path / "state.json", backup=None)
    assert store.was_configured is False
    assert store.restored_from_backup is False


def test_saving_works_when_atomic_replace_is_denied(tmp_path, monkeypatch):
    """תיקייה מוקשחת שוללת הרשאת מחיקה, ואז ``os.replace`` נכשל."""
    store = Store(tmp_path / "state.json", backup=tmp_path / "b.json")
    store.set_pin("1234")
    store.add_child("נועם")
    store.save()

    monkeypatch.setattr(os, "replace",
                        lambda *a, **k: (_ for _ in ()).throw(PermissionError()))
    store.grant_minutes(store.children[0]["id"], 10)
    store.save()                                  # לא אמור לזרוק
    monkeypatch.undo()
    again = Store(tmp_path / "state.json", backup=tmp_path / "b.json")
    assert again.bonus_seconds(again.children[0]["id"]) == 600


def test_a_read_only_backup_does_not_break_saving(tmp_path):
    backup = tmp_path / "shared" / "state.backup.json"
    backup.parent.mkdir(parents=True)
    backup.write_text("{}", encoding="utf-8")
    backup.chmod(0o444)
    backup.parent.chmod(0o555)                    # אין הרשאת כתיבה לתיקייה
    try:
        store = Store(tmp_path / "state.json", backup=backup)
        store.set_pin("1234")
        store.save()                              # הגיבוי נכשל בשקט
        assert (tmp_path / "state.json").exists()
    finally:
        backup.parent.chmod(0o755)
        backup.chmod(0o644)


def test_a_denied_replace_is_not_retried_and_leaves_no_litter(tmp_path, monkeypatch):
    """תיקייה שאוסרת מחיקה: ניסיון חוזר היה מייצר קובץ זמני בכל שמירה."""
    store = Store(tmp_path / "state.json", backup=None)
    store.set_pin("1234")
    store.save()

    calls = []

    def denied(*args, **kwargs):
        calls.append(args)
        raise PermissionError()

    monkeypatch.setattr(os, "replace", denied)
    for _ in range(5):
        store.set_cfg("daily_minutes", 21)
        store.save()
    assert len(calls) == 1                       # ניסיון אחד בלבד
    monkeypatch.undo()
    assert not list(tmp_path.glob(".state-*"))   # בלי קבצים זמניים שנשארו
    assert Store(tmp_path / "state.json", backup=None).cfg("daily_minutes") == 21
