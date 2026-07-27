from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic_ns


def utc_now() -> datetime:
    """Return a timezone-aware UTC wall-clock timestamp."""
    return datetime.now(timezone.utc)


@dataclass(frozen=True, slots=True)
class MonotonicTimer:
    """Measure durations without depending on wall-clock adjustments."""

    _started_ns: int

    @classmethod
    def start(cls) -> MonotonicTimer:
        return cls(_started_ns=monotonic_ns())

    def elapsed_us(self) -> int:
        return max(0, (monotonic_ns() - self._started_ns) // 1_000)

