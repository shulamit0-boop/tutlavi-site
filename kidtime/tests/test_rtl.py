"""בדיקות לסידור העברית לתצוגה.

ל-Tk אין תמיכה אחידה בטקסט דו-כיווני: במחשבים מסוימים הוא מסדר עברית לבד,
ובאחרים הוא מצייר את האותיות לפי סדר ההקלדה משמאל לימין — ואז כל העברית
מוצגת הפוכה. ``theme`` בודק מה קורה בפועל ומסדר בעצמו רק כשצריך.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest.importorskip("tkinter")

from kidtime import theme  # noqa: E402


@pytest.fixture()
def reordering():
    """מדמה מחשב שבו Tk לא מסדר עברית, ומחזיר את המצב הקודם בסוף."""
    previous = theme.reorder_mode()
    theme.set_reorder_mode(True)
    yield
    theme.set_reorder_mode(previous)


@pytest.fixture()
def native():
    """מדמה מחשב שבו Tk מסדר עברית בעצמו."""
    previous = theme.reorder_mode()
    theme.set_reorder_mode(False)
    yield
    theme.set_reorder_mode(previous)


# ----------------------------------------------------------------- visual()
def test_hebrew_is_reversed_for_a_left_to_right_engine():
    assert theme.visual("פאנל הורים") == "םירוה לנאפ"


def test_numbers_keep_their_own_direction():
    # היפוך תמים היה הופך את השעון ל-"43:21"
    assert theme.visual("נותרו 12:34") == "12:34 ורתונ"


def test_latin_words_stay_readable():
    assert theme.visual("KidTime מותקן") == "ןקתומ KidTime"


def test_a_signed_number_stays_with_its_sign():
    for text in ("+5", "+30", "−5"):
        assert theme.visual(text) == text


def test_brackets_are_mirrored():
    assert theme.visual("הורים (1)") == "(1) םירוה"


def test_reordering_is_its_own_inverse():
    for text in ("מי משתמש/ת במחשב?", "נותרו 12:34", "הזמן של היום",
                 "מכסה ריקה = המכסה הכללית", "KidTime 1.2.1 מותקן"):
        assert theme.visual(theme.visual(text)) == text


# -------------------------------------------------------------- rtl/plain
def test_rtl_reorders_when_tk_does_not(reordering):
    assert theme.rtl("פאנל הורים") == "םירוה לנאפ"


def test_plain_gives_the_code_back_the_logical_text(reordering):
    for text in ("פאנל הורים", "נותרו 12:34", "הורים (1)"):
        assert theme.plain(theme.rtl(text)) == text


def test_rtl_uses_direction_marks_when_tk_reorders_by_itself(native):
    wrapped = theme.rtl("פאנל הורים")
    assert wrapped == "‫פאנל הורים‬"
    assert theme.plain(wrapped) == "פאנל הורים"


def test_text_without_hebrew_is_never_touched(reordering):
    for text in ("KidTime 1.2.1", "20:00", "+5"):
        assert theme.rtl(text) == text


def test_each_line_is_handled_on_its_own(reordering):
    assert theme.rtl("שורה ראשונה\nשורה שנייה") == "הנושאר הרוש\nהיינש הרוש"


def test_non_strings_pass_through(reordering):
    for value in (None, 7, 1.5):
        assert theme.rtl(value) is value
        assert theme.plain(value) is value


# ------------------------------------------------------------------- probe
def test_the_probe_answers_with_a_boolean():
    import tkinter as tk

    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        pytest.skip("אין תצוגה גרפית")
    root = tk.Tk()
    root.withdraw()
    try:
        theme._probed = False          # לאלץ בדיקה אמיתית
        assert isinstance(theme.detect_direction(root), bool)
    finally:
        root.destroy()
