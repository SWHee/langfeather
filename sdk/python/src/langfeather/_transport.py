from __future__ import annotations

import atexit
import http.client
import json
import logging
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlparse

from ._builder import Envelope

logger = logging.getLogger("langfeather")

DEFAULT_ENDPOINT = "http://127.0.0.1:4319"
ENDPOINT_ENV = "LANGFEATHER_ENDPOINT"


@dataclass(frozen=True, slots=True)
class TransportSettings:
    endpoint: str
    queue_capacity: int = 256
    batch_size: int = 20
    request_timeout: float = 0.5
    retry_count: int = 1
    retry_backoff: float = 0.05
    shutdown_timeout: float = 2.0

    @classmethod
    def create(
        cls,
        *,
        endpoint: str | None = None,
        queue_capacity: int = 256,
        batch_size: int = 20,
        request_timeout: float = 0.5,
        retry_count: int = 1,
        retry_backoff: float = 0.05,
        shutdown_timeout: float = 2.0,
    ) -> TransportSettings:
        resolved_endpoint = endpoint
        if resolved_endpoint is None:
            resolved_endpoint = os.environ.get(ENDPOINT_ENV, DEFAULT_ENDPOINT)
        normalized_endpoint = resolved_endpoint.rstrip("/")
        parsed = urlparse(normalized_endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("endpoint must be an absolute HTTP(S) URL")
        if queue_capacity < 1:
            raise ValueError("queue_capacity must be at least 1")
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1")
        if request_timeout <= 0:
            raise ValueError("request_timeout must be positive")
        if retry_count < 0:
            raise ValueError("retry_count must be non-negative")
        if retry_backoff < 0:
            raise ValueError("retry_backoff must be non-negative")
        if shutdown_timeout < 0:
            raise ValueError("shutdown_timeout must be non-negative")
        return cls(
            endpoint=normalized_endpoint,
            queue_capacity=queue_capacity,
            batch_size=batch_size,
            request_timeout=request_timeout,
            retry_count=retry_count,
            retry_backoff=retry_backoff,
            shutdown_timeout=shutdown_timeout,
        )

    @property
    def ingest_url(self) -> str:
        return f"{self.endpoint}/api/v1/traces/batch"


@dataclass(frozen=True, slots=True)
class _QueuedEnvelope:
    sequence: int
    envelope: Envelope


class TransportClient:
    """Bounded, best-effort background HTTP transport."""

    def __init__(self, settings: TransportSettings) -> None:
        self._settings = settings
        self._queue: queue.Queue[_QueuedEnvelope] = queue.Queue(
            maxsize=settings.queue_capacity
        )
        self._state = threading.Condition()
        self._accepted_sequence = 0
        self._pending_sequences: set[int] = set()
        self._accepting = True
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name="langfeather-sender",
            daemon=True,
        )
        self._thread.start()

    def enqueue(self, envelope: Envelope) -> bool:
        dropped = False
        with self._state:
            if not self._accepting:
                return False
            item = _QueuedEnvelope(
                sequence=self._accepted_sequence + 1,
                envelope=envelope,
            )
            try:
                self._queue.put_nowait(item)
            except queue.Full:
                try:
                    discarded = self._queue.get_nowait()
                except queue.Empty:
                    pass
                else:
                    self._queue.task_done()
                    self._pending_sequences.discard(discarded.sequence)
                    dropped = True
                try:
                    self._queue.put_nowait(item)
                except queue.Full:
                    return False
            self._accepted_sequence = item.sequence
            self._pending_sequences.add(item.sequence)
            self._state.notify_all()
        if dropped:
            logger.warning(
                "LangFeather delivery queue was full; discarded the oldest trace"
            )
        return True

    def flush(self, timeout: float | None = None) -> bool:
        return self._flush_through(
            self._snapshot_target(),
            timeout=timeout,
        )

    def _snapshot_target(self) -> int:
        with self._state:
            return self._accepted_sequence

    def _flush_through(
        self,
        target_sequence: int,
        *,
        timeout: float | None = None,
    ) -> bool:
        resolved_timeout = (
            self._settings.shutdown_timeout if timeout is None else timeout
        )
        if resolved_timeout < 0:
            raise ValueError("timeout must be non-negative")
        deadline = time.monotonic() + resolved_timeout
        with self._state:
            while any(
                sequence <= target_sequence for sequence in self._pending_sequences
            ):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._state.wait(timeout=remaining)
        return True

    def shutdown(self, timeout: float | None = None) -> bool:
        resolved_timeout = (
            self._settings.shutdown_timeout if timeout is None else timeout
        )
        if resolved_timeout < 0:
            raise ValueError("timeout must be non-negative")
        deadline = time.monotonic() + resolved_timeout
        with self._state:
            self._accepting = False
        flushed = self.flush(timeout=max(0.0, deadline - time.monotonic()))
        self._stop.set()
        self._thread.join(timeout=max(0.0, deadline - time.monotonic()))
        stopped = not self._thread.is_alive()
        if not flushed or not stopped:
            logger.warning(
                "LangFeather sender shutdown timed out; pending traces may be lost"
            )
        return flushed and stopped

    def _run(self) -> None:
        while not self._stop.is_set() or self._has_pending():
            try:
                first = self._queue.get(timeout=0.05)
            except queue.Empty:
                continue
            batch = [first]
            while len(batch) < self._settings.batch_size:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            try:
                self._deliver(batch)
            except BaseException:
                logger.warning(
                    "LangFeather background delivery failed unexpectedly",
                    exc_info=True,
                )
            finally:
                for _item in batch:
                    self._queue.task_done()
                with self._state:
                    for item in batch:
                        self._pending_sequences.discard(item.sequence)
                    self._state.notify_all()

    def _has_pending(self) -> bool:
        with self._state:
            return bool(self._pending_sequences)

    def _deliver(self, batch: list[_QueuedEnvelope]) -> None:
        body = json.dumps(
            {"items": [item.envelope for item in batch]},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        request = urllib.request.Request(
            self._settings.ingest_url,
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        attempts = self._settings.retry_count + 1
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(
                    request,
                    timeout=self._settings.request_timeout,
                ) as response:
                    response_body = response.read()
                self._warn_for_rejected_items(response_body)
                return
            except urllib.error.HTTPError as error:
                is_transient = error.code in {408, 429} or 500 <= error.code <= 599
                if not is_transient:
                    logger.warning(
                        "LangFeather collector rejected a batch with HTTP %s",
                        error.code,
                    )
                    return
                last_error: BaseException = error
            except (
                urllib.error.URLError,
                TimeoutError,
                OSError,
                http.client.HTTPException,
            ) as error:
                last_error = error
            if attempt + 1 < attempts:
                self._stop.wait(self._settings.retry_backoff * (attempt + 1))
        logger.warning(
            "LangFeather could not deliver %s trace envelope(s): %s",
            len(batch),
            last_error,
        )

    @staticmethod
    def _warn_for_rejected_items(response_body: bytes) -> None:
        try:
            response = json.loads(response_body)
            results = response.get("results", [])
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            logger.warning("LangFeather collector returned an invalid JSON response")
            return
        rejected = [
            item
            for item in results
            if isinstance(item, dict) and item.get("status") == "rejected"
        ]
        if rejected:
            logger.warning(
                "LangFeather collector rejected %s trace envelope(s)",
                len(rejected),
            )


_global_lock = threading.Lock()
_settings: TransportSettings | None = None
_client: TransportClient | None = None
_global_accepting = True
_global_generation = 0


@dataclass(eq=False, slots=True)
class _RetiringClient:
    client: TransportClient
    shutdown_lock: threading.Lock = field(default_factory=threading.Lock)
    completed: bool = False


_retiring_clients: dict[int, _RetiringClient] = {}


def configure_transport(
    endpoint: str | None = None,
    *,
    queue_capacity: int = 256,
    batch_size: int = 20,
    request_timeout: float = 0.5,
    retry_count: int = 1,
    retry_backoff: float = 0.05,
    shutdown_timeout: float = 2.0,
) -> None:
    global _client, _global_accepting, _global_generation, _settings
    new_settings = TransportSettings.create(
        endpoint=endpoint,
        queue_capacity=queue_capacity,
        batch_size=batch_size,
        request_timeout=request_timeout,
        retry_count=retry_count,
        retry_backoff=retry_backoff,
        shutdown_timeout=shutdown_timeout,
    )
    with _global_lock:
        _prune_retiring_locked()
        old_client = _client
        _client = None
        _settings = new_settings
        _global_accepting = True
        _global_generation += 1
        retiring = None if old_client is None else _start_retiring_locked(old_client)
    if retiring is not None:
        deadline = time.monotonic() + retiring.client._settings.shutdown_timeout
        _shutdown_retiring(retiring, deadline)


def enqueue_envelope(envelope: Envelope) -> None:
    try:
        client, generation = _get_client_snapshot()
        if client is None or client.enqueue(envelope):
            return
        retry_client = _retry_client_after_lifecycle_change(
            previous_client=client,
            previous_generation=generation,
        )
        if retry_client is not None:
            retry_client.enqueue(envelope)
    except BaseException:
        logger.warning("LangFeather could not enqueue a trace", exc_info=True)


def flush_transport(timeout: float | None = None) -> bool:
    deadline = _global_deadline(timeout)
    with _global_lock:
        _prune_retiring_locked()
        client_targets = [
            (client, client._snapshot_target())
            for client in (
                _client,
                *(retiring.client for retiring in _retiring_clients.values()),
            )
            if client is not None
        ]
    flushed = True
    for client, target_sequence in client_targets:
        result = client._flush_through(
            target_sequence,
            timeout=max(0.0, deadline - time.monotonic()),
        )
        flushed = result and flushed
    return flushed


def shutdown_transport(timeout: float | None = None) -> bool:
    global _client, _global_accepting, _global_generation
    deadline = _global_deadline(timeout)
    with _global_lock:
        _prune_retiring_locked()
        client = _client
        _client = None
        _global_accepting = False
        _global_generation += 1
        if client is not None:
            _start_retiring_locked(client)
        retiring = list(_retiring_clients.values())
    stopped = True
    for item in retiring:
        result = _shutdown_retiring(item, deadline)
        stopped = result and stopped
    return stopped


def _get_client() -> TransportClient | None:
    client, _generation = _get_client_snapshot()
    return client


def _get_client_snapshot() -> tuple[TransportClient | None, int]:
    global _client, _settings
    with _global_lock:
        _prune_retiring_locked()
        if not _global_accepting:
            return None, _global_generation
        if _client is None:
            if _settings is None:
                _settings = TransportSettings.create()
            _client = TransportClient(_settings)
        return _client, _global_generation


def _retry_client_after_lifecycle_change(
    *,
    previous_client: TransportClient,
    previous_generation: int,
) -> TransportClient | None:
    global _client, _settings
    with _global_lock:
        _prune_retiring_locked()
        if not _global_accepting:
            return None
        if _global_generation == previous_generation and _client is previous_client:
            return None
        if _client is None:
            if _settings is None:
                _settings = TransportSettings.create()
            _client = TransportClient(_settings)
        if _client is previous_client:
            return None
        return _client


def _global_deadline(timeout: float | None) -> float:
    with _global_lock:
        resolved_timeout = (
            (_settings.shutdown_timeout if _settings is not None else 2.0)
            if timeout is None
            else timeout
        )
    if resolved_timeout < 0:
        raise ValueError("timeout must be non-negative")
    return time.monotonic() + resolved_timeout


def _start_retiring_locked(client: TransportClient) -> _RetiringClient:
    key = id(client)
    retiring = _retiring_clients.get(key)
    if retiring is None:
        retiring = _RetiringClient(client=client)
        _retiring_clients[key] = retiring
    return retiring


def _prune_retiring_locked() -> None:
    finished = [
        key
        for key, retiring in _retiring_clients.items()
        if retiring.completed or not retiring.client._thread.is_alive()
    ]
    for key in finished:
        del _retiring_clients[key]


def _shutdown_retiring(
    retiring: _RetiringClient,
    deadline: float,
) -> bool:
    remaining = max(0.0, deadline - time.monotonic())
    if not retiring.shutdown_lock.acquire(timeout=remaining):
        return False
    try:
        if retiring.completed:
            return True
        stopped = retiring.client.shutdown(
            timeout=max(0.0, deadline - time.monotonic())
        )
        if not stopped:
            return False
        retiring.completed = True
        with _global_lock:
            current = _retiring_clients.get(id(retiring.client))
            if current is retiring:
                del _retiring_clients[id(retiring.client)]
        return True
    finally:
        retiring.shutdown_lock.release()


atexit.register(shutdown_transport)
