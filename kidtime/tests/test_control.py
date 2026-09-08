"""בדיקות לערוץ השליטה המקומי (מופע יחיד ופקודת עצירה) — ללא Tk."""
from __future__ import annotations

import os
import socket
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kidtime.control import SingleInstance, send_stop  # noqa: E402

@pytest.fixture()
def guard():
    """פורט 0 = פורט חופשי כלשהו, כדי שהבדיקות לא יתנגשו במה שרץ במכונה."""
    instance = SingleInstance(0)
    assert instance.acquired
    yield instance
    instance.release()


def test_first_instance_wins_and_second_is_refused(guard):
    assert guard.acquired is True
    second = SingleInstance(guard.port)
    try:
        assert second.acquired is False
    finally:
        second.release()


def test_released_port_can_be_taken_again(guard):
    port = guard.port
    guard.release()
    again = SingleInstance(port)
    try:
        assert again.acquired is True
    finally:
        again.release()


def test_poll_returns_none_when_nobody_called(guard):
    assert guard.poll_command() is None


def test_stop_command_arrives_with_its_pin(guard):
    with socket.create_connection(("127.0.0.1", guard.port), timeout=3) as conn:
        conn.sendall(b"stop 1234\n")
        received = guard.poll_command()
        assert received is not None
        connection, message = received
        assert message == "stop 1234"
        connection.close()


def test_send_stop_reports_when_nothing_is_running(guard):
    port = guard.port
    guard.release()
    assert send_stop("1234", port=port) == "not-running"
