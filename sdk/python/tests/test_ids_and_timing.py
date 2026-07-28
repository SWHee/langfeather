from __future__ import annotations

from datetime import timezone

from langfeather._ids import new_observation_id, new_trace_id
from langfeather._timing import MonotonicTimer, utc_now


def test_ids_have_stable_prefixes_and_are_unique() -> None:
    assert new_trace_id().startswith("tr_")
    assert new_observation_id().startswith("obs_")
    assert new_trace_id() != new_trace_id()


def test_utc_now_is_timezone_aware_utc() -> None:
    value = utc_now()

    assert value.tzinfo == timezone.utc


def test_monotonic_timer_reports_non_negative_microseconds() -> None:
    timer = MonotonicTimer.start()

    assert timer.elapsed_us() >= 0
