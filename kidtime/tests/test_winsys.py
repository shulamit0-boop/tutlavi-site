"""בדיקות לחוקי חסימת המקשים (הלוגיקה מופרדת מה-hook עצמו)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kidtime.winsys import (  # noqa: E402
    VK_ESCAPE, VK_F4, VK_LWIN, VK_RWIN, VK_TAB, KeyBlocker, idle_seconds,
)

block = KeyBlocker.should_block


def test_windows_key_is_blocked():
    assert block(VK_LWIN, False, False, False)
    assert block(VK_RWIN, False, False, False)


def test_alt_tab_and_alt_f4_are_blocked():
    assert block(VK_TAB, True, False, False)
    assert block(VK_F4, True, False, False)


def test_ctrl_esc_and_ctrl_shift_esc_are_blocked():
    assert block(VK_ESCAPE, False, True, False)
    assert block(VK_ESCAPE, False, True, True)


def test_plain_keys_pass_through():
    assert not block(VK_TAB, False, False, False)
    assert not block(VK_ESCAPE, False, False, False)
    assert not block(VK_F4, False, False, False)
    assert not block(ord("A"), True, True, True)


def test_idle_seconds_is_safe_off_windows():
    assert idle_seconds() >= 0
