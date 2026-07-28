from __future__ import annotations

from uuid import uuid4


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def new_trace_id() -> str:
    """Return an opaque client-generated trace ID."""
    return _new_id("tr")


def new_observation_id() -> str:
    """Return an opaque client-generated observation ID."""
    return _new_id("obs")
