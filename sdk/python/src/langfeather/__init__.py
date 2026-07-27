"""LangFeather Python SDK."""

from __future__ import annotations

from ._asgi import wrap_asgi
from ._observe import (
    Span,
    TraceContext,
    current_context,
    observe,
    span,
    use_context,
)
from ._runnable import RunnableWrapper, wrap_runnable
from ._transport import configure_transport, flush_transport, shutdown_transport

__version__ = "0.1.0"

__all__ = [
    "RunnableWrapper",
    "Span",
    "TraceContext",
    "__version__",
    "configure",
    "current_context",
    "flush",
    "observe",
    "shutdown",
    "span",
    "use_context",
    "wrap_asgi",
    "wrap_runnable",
]


def configure(
    endpoint: str | None = None,
    *,
    queue_capacity: int = 256,
    batch_size: int = 20,
    request_timeout: float = 0.5,
    retry_count: int = 1,
    retry_backoff: float = 0.05,
    shutdown_timeout: float = 2.0,
) -> None:
    """Configure the lazy global delivery client.

    ``endpoint`` is a server base URL. When omitted, LangFeather reads
    ``LANGFEATHER_ENDPOINT`` and then falls back to
    ``http://127.0.0.1:4319``.
    """
    configure_transport(
        endpoint,
        queue_capacity=queue_capacity,
        batch_size=batch_size,
        request_timeout=request_timeout,
        retry_count=retry_count,
        retry_backoff=retry_backoff,
        shutdown_timeout=shutdown_timeout,
    )


def flush(timeout: float | None = None) -> bool:
    """Wait until all currently accepted trace envelopes are handled."""
    return flush_transport(timeout)


def shutdown(timeout: float | None = None) -> bool:
    """Stop the lazy sender after a bounded flush until the next configure."""
    return shutdown_transport(timeout)
