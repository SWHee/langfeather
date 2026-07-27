from __future__ import annotations

import http.client
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from email.message import Message
from types import TracebackType
from typing import Any, cast

import pytest

import langfeather
from langfeather import _transport
from langfeather._builder import Envelope
from langfeather._transport import (
    DEFAULT_ENDPOINT,
    TransportClient,
    TransportSettings,
    enqueue_envelope,
)


class _PlainRunnable:
    def invoke(
        self,
        value: str,
        config: object = None,
        **kwargs: object,
    ) -> str:
        return value.upper()


class _Response:
    def __init__(self, body: object) -> None:
        self._body = json.dumps(body).encode()

    def __enter__(self) -> _Response:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    def read(self) -> bytes:
        return self._body


def _trace_envelope(trace_id: str) -> Envelope:
    return {
        "schema_version": 1,
        "trace": {"trace_id": trace_id},
        "observations": [],
    }


def _http_error(request: urllib.request.Request, status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        request.full_url,
        status,
        f"HTTP {status}",
        hdrs=Message(),
        fp=None,
    )


def _request_json(request: urllib.request.Request) -> dict[str, Any]:
    data = request.data
    assert isinstance(data, bytes)
    return cast(dict[str, Any], json.loads(data))


def _client(
    *,
    queue_capacity: int = 256,
    batch_size: int = 20,
    retry_count: int = 1,
    retry_backoff: float = 0,
) -> TransportClient:
    return TransportClient(
        TransportSettings.create(
            endpoint="http://127.0.0.1:4319",
            queue_capacity=queue_capacity,
            batch_size=batch_size,
            retry_count=retry_count,
            retry_backoff=retry_backoff,
            shutdown_timeout=1,
        )
    )


def test_configure_does_not_start_sender_thread() -> None:
    assert langfeather.shutdown(timeout=1)
    langfeather.configure(endpoint="http://127.0.0.1:4319")

    assert not any(
        thread.name == "langfeather-sender" and thread.is_alive()
        for thread in threading.enumerate()
    )


def test_endpoint_configuration_precedence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LANGFEATHER_ENDPOINT", "http://127.0.0.1:9001/")

    assert (
        TransportSettings.create(endpoint="http://127.0.0.1:9002/").endpoint
        == "http://127.0.0.1:9002"
    )
    assert TransportSettings.create().endpoint == "http://127.0.0.1:9001"

    monkeypatch.delenv("LANGFEATHER_ENDPOINT")
    assert TransportSettings.create().endpoint == DEFAULT_ENDPOINT


def test_delivery_is_background_and_flush_is_deterministic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered = threading.Event()
    release = threading.Event()

    def blocking_deliver(
        self: TransportClient,
        batch: list[Envelope],
    ) -> None:
        entered.set()
        assert release.wait(timeout=2)

    monkeypatch.setattr(TransportClient, "_deliver", blocking_deliver)
    langfeather.configure(endpoint="http://127.0.0.1:4319")

    result = langfeather.wrap_runnable(_PlainRunnable()).invoke("hello")

    assert result == "HELLO"
    assert entered.wait(timeout=1)
    assert not langfeather.flush(timeout=0)
    release.set()
    assert langfeather.flush(timeout=1)
    assert langfeather.shutdown(timeout=1)


def test_flush_waits_only_for_items_accepted_before_its_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_request_entered = threading.Event()
    release_first_request = threading.Event()
    second_request_entered = threading.Event()
    release_second_request = threading.Event()
    request_count = 0

    def blocking_urlopen(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal request_count
        del request, timeout
        request_count += 1
        if request_count == 1:
            first_request_entered.set()
            assert release_first_request.wait(timeout=2)
        else:
            second_request_entered.set()
            assert release_second_request.wait(timeout=2)
        return _Response({"results": []})

    monkeypatch.setattr(urllib.request, "urlopen", blocking_urlopen)
    client = _client(batch_size=1)
    flush_waiting = threading.Event()
    original_wait = client._state.wait

    def observed_wait(timeout: float | None = None) -> bool:
        flush_waiting.set()
        return original_wait(timeout)

    monkeypatch.setattr(client._state, "wait", observed_wait)
    flush_result: list[bool] = []
    flush_thread = threading.Thread(
        target=lambda: flush_result.append(client.flush(timeout=1)),
    )
    try:
        assert client.enqueue(_trace_envelope("tr_before_flush"))
        assert first_request_entered.wait(timeout=1)
        flush_thread.start()
        assert flush_waiting.wait(timeout=1)

        assert client.enqueue(_trace_envelope("tr_after_flush"))
        release_first_request.set()
        assert second_request_entered.wait(timeout=1)
        flush_thread.join(timeout=0.2)

        assert not flush_thread.is_alive()
        assert flush_result == [True]
    finally:
        release_first_request.set()
        release_second_request.set()
        flush_thread.join(timeout=1)
        assert client.shutdown(timeout=1)


def test_public_flush_captures_client_and_sequence_at_one_call_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_request_entered = threading.Event()
    release_first_request = threading.Event()
    second_request_entered = threading.Event()
    release_second_request = threading.Event()

    def blocking_deliver(
        self: TransportClient,
        batch: list[_transport._QueuedEnvelope],
    ) -> None:
        del self
        trace_id = batch[0].envelope["trace"]["trace_id"]
        if trace_id == "tr_before_public_flush":
            first_request_entered.set()
            assert release_first_request.wait(timeout=2)
        else:
            second_request_entered.set()
            assert release_second_request.wait(timeout=2)

    monkeypatch.setattr(TransportClient, "_deliver", blocking_deliver)
    assert langfeather.shutdown(timeout=1)
    langfeather.configure(
        endpoint="http://127.0.0.1:4319",
        batch_size=1,
        shutdown_timeout=1,
    )
    enqueue_envelope(_trace_envelope("tr_before_public_flush"))
    assert first_request_entered.wait(timeout=1)
    client = _transport._client
    assert client is not None

    snapshot_captured = threading.Event()
    captured_targets: list[int] = []
    original_flush_through = client._flush_through

    def observed_flush_through(
        target_sequence: int,
        *,
        timeout: float | None = None,
    ) -> bool:
        captured_targets.append(target_sequence)
        snapshot_captured.set()
        return original_flush_through(target_sequence, timeout=timeout)

    monkeypatch.setattr(client, "_flush_through", observed_flush_through)
    flush_result: list[bool] = []
    flush_thread = threading.Thread(
        target=lambda: flush_result.append(_transport.flush_transport(timeout=1))
    )
    flush_thread.start()
    assert snapshot_captured.wait(timeout=1)

    try:
        enqueue_envelope(_trace_envelope("tr_after_public_flush"))
        release_first_request.set()
        assert second_request_entered.wait(timeout=1)
        flush_thread.join(timeout=0.2)

        assert not flush_thread.is_alive()
        assert flush_result == [True]
        assert captured_targets == [1]
    finally:
        release_first_request.set()
        release_second_request.set()
        flush_thread.join(timeout=1)
        assert langfeather.shutdown(timeout=1)


def test_sender_batches_trace_envelopes_in_one_http_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sender_gate = threading.Event()
    original_run = TransportClient._run

    def gated_run(self: TransportClient) -> None:
        assert sender_gate.wait(timeout=2)
        original_run(self)

    requests: list[tuple[str, dict[str, Any], str]] = []

    def fake_urlopen(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        del timeout
        requests.append(
            (
                request.full_url,
                _request_json(request),
                threading.current_thread().name,
            )
        )
        return _Response(
            {
                "results": [
                    {"trace_id": item["trace"]["trace_id"], "status": "stored"}
                    for item in requests[-1][1]["items"]
                ]
            }
        )

    monkeypatch.setattr(TransportClient, "_run", gated_run)
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    client = _client(batch_size=3)
    try:
        assert client.enqueue(_trace_envelope("tr_01"))
        assert client.enqueue(_trace_envelope("tr_02"))
        assert client.enqueue(_trace_envelope("tr_03"))
        sender_gate.set()

        assert client.flush(timeout=1)
        assert requests == [
            (
                "http://127.0.0.1:4319/api/v1/traces/batch",
                {
                    "items": [
                        _trace_envelope("tr_01"),
                        _trace_envelope("tr_02"),
                        _trace_envelope("tr_03"),
                    ]
                },
                "langfeather-sender",
            )
        ]
    finally:
        sender_gate.set()
        assert client.shutdown(timeout=1)


def test_queue_overflow_discards_oldest_waiting_item(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    first_request_entered = threading.Event()
    release_first_request = threading.Event()
    delivered_trace_ids: list[str] = []

    def fake_urlopen(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        del timeout
        body = _request_json(request)
        trace_id = body["items"][0]["trace"]["trace_id"]
        delivered_trace_ids.append(trace_id)
        if trace_id == "tr_in_flight":
            first_request_entered.set()
            assert release_first_request.wait(timeout=2)
        return _Response({"results": [{"trace_id": trace_id, "status": "stored"}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    caplog.set_level(logging.WARNING, logger="langfeather")
    client = _client(queue_capacity=2, batch_size=1)
    try:
        assert client.enqueue(_trace_envelope("tr_in_flight"))
        assert first_request_entered.wait(timeout=1)
        assert client.enqueue(_trace_envelope("tr_oldest"))
        assert client.enqueue(_trace_envelope("tr_kept_01"))
        assert client.enqueue(_trace_envelope("tr_kept_02"))
        release_first_request.set()

        assert client.flush(timeout=1)
        assert delivered_trace_ids == [
            "tr_in_flight",
            "tr_kept_01",
            "tr_kept_02",
        ]
        assert "discarded the oldest trace" in caplog.text
    finally:
        release_first_request.set()
        assert client.shutdown(timeout=1)


def test_stalled_sender_keeps_oldest_drop_bookkeeping_bounded(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    request_entered = threading.Event()
    release_request = threading.Event()

    def blocking_deliver(
        self: TransportClient,
        batch: list[object],
    ) -> None:
        del self, batch
        request_entered.set()
        assert release_request.wait(timeout=2)

    monkeypatch.setattr(TransportClient, "_deliver", blocking_deliver)
    caplog.set_level(logging.CRITICAL, logger="langfeather")
    client = _client(queue_capacity=1, batch_size=1)
    try:
        assert client.enqueue(_trace_envelope("tr_in_flight"))
        assert request_entered.wait(timeout=1)
        for index in range(2_000):
            assert client.enqueue(_trace_envelope(f"tr_overflow_{index}"))

        assert client._queue.qsize() == 1
        assert len(client._pending_sequences) == 2
    finally:
        release_request.set()
        assert client.shutdown(timeout=1)


@pytest.mark.parametrize("status", [408, 429, 500, 503, 599])
def test_transient_http_status_is_retried(
    monkeypatch: pytest.MonkeyPatch,
    status: int,
) -> None:
    attempts = 0

    def fake_urlopen(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal attempts
        del timeout
        attempts += 1
        if attempts == 1:
            raise _http_error(request, status)
        return _Response({"results": [{"trace_id": "tr_retry", "status": "stored"}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    client = _client(retry_count=2)
    try:
        assert client.enqueue(_trace_envelope("tr_retry"))
        assert client.flush(timeout=1)
        assert attempts == 2
    finally:
        assert client.shutdown(timeout=1)


def test_incomplete_response_body_is_retried_as_network_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    class _IncompleteResponse(_Response):
        def read(self) -> bytes:
            raise http.client.IncompleteRead(b"partial", 10)

    def incomplete_then_success(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal attempts
        del request, timeout
        attempts += 1
        if attempts == 1:
            return _IncompleteResponse({})
        return _Response(
            {"results": [{"trace_id": "tr_incomplete", "status": "stored"}]}
        )

    monkeypatch.setattr(urllib.request, "urlopen", incomplete_then_success)
    client = _client(retry_count=1)
    try:
        assert client.enqueue(_trace_envelope("tr_incomplete"))
        assert client.flush(timeout=1)
        assert attempts == 2
    finally:
        assert client.shutdown(timeout=1)


def test_network_error_is_retried_then_warned_without_escaping(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    attempts = 0

    def unavailable_collector(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal attempts
        del request, timeout
        attempts += 1
        raise urllib.error.URLError("collector unavailable")

    monkeypatch.setattr(urllib.request, "urlopen", unavailable_collector)
    caplog.set_level(logging.WARNING, logger="langfeather")
    client = _client(retry_count=1)
    try:
        assert client.enqueue(_trace_envelope("tr_outage"))
        assert client.flush(timeout=1)
        assert attempts == 2
        assert "could not deliver 1 trace envelope(s)" in caplog.text
    finally:
        assert client.shutdown(timeout=1)


@pytest.mark.parametrize("status", [300, 400, 401, 403, 404, 409, 422, 499, 600])
def test_permanent_http_rejection_is_not_retried(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    status: int,
) -> None:
    attempts = 0

    def rejected_request(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal attempts
        del timeout
        attempts += 1
        raise _http_error(request, status)

    monkeypatch.setattr(urllib.request, "urlopen", rejected_request)
    caplog.set_level(logging.WARNING, logger="langfeather")
    client = _client(retry_count=3)
    try:
        assert client.enqueue(_trace_envelope("tr_permanent"))
        assert client.flush(timeout=1)
        assert attempts == 1
        assert f"HTTP {status}" in caplog.text
    finally:
        assert client.shutdown(timeout=1)


def test_item_level_rejection_is_warned_and_not_retried(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    attempts = 0

    def rejected_item(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        nonlocal attempts
        del request, timeout
        attempts += 1
        return _Response(
            {
                "results": [
                    {
                        "trace_id": "tr_item_rejected",
                        "status": "rejected",
                        "error": {"code": "validation_error"},
                    }
                ]
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", rejected_item)
    caplog.set_level(logging.WARNING, logger="langfeather")
    client = _client(retry_count=3)
    try:
        assert client.enqueue(_trace_envelope("tr_item_rejected"))
        assert client.flush(timeout=1)
        assert attempts == 1
        assert "rejected 1 trace envelope(s)" in caplog.text
    finally:
        assert client.shutdown(timeout=1)


def test_global_shutdown_blocks_recreation_and_flush_tracks_retiring_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_entered = threading.Event()
    release_request = threading.Event()

    def blocking_deliver(
        self: TransportClient,
        batch: list[object],
    ) -> None:
        del self, batch
        request_entered.set()
        assert release_request.wait(timeout=2)

    monkeypatch.setattr(TransportClient, "_deliver", blocking_deliver)
    assert langfeather.shutdown(timeout=1)
    langfeather.configure(
        endpoint="http://127.0.0.1:4319",
        shutdown_timeout=1,
    )
    enqueue_envelope(_trace_envelope("tr_retiring"))
    assert request_entered.wait(timeout=1)

    shutdown_result: list[bool] = []
    shutdown_thread = threading.Thread(
        target=lambda: shutdown_result.append(_transport.shutdown_transport(timeout=1))
    )
    shutdown_thread.start()
    deadline = time.monotonic() + 1
    while _transport._client is not None and time.monotonic() < deadline:
        time.sleep(0.001)

    try:
        assert _transport._client is None
        assert not _transport.flush_transport(timeout=0)

        enqueue_envelope(_trace_envelope("tr_must_not_recreate"))
        assert _transport._client is None
    finally:
        release_request.set()
        shutdown_thread.join(timeout=2)

    assert not shutdown_thread.is_alive()
    assert shutdown_result == [True]

    langfeather.configure(endpoint="http://127.0.0.1:4319")
    reopened = _transport._get_client()
    assert reopened is not None
    assert reopened._accepting
    assert langfeather.shutdown(timeout=1)


def test_finished_timed_out_retiring_client_is_pruned_on_reconfigure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_entered = threading.Event()
    release_request = threading.Event()

    def blocking_deliver(
        self: TransportClient,
        batch: list[object],
    ) -> None:
        del self, batch
        request_entered.set()
        assert release_request.wait(timeout=2)

    monkeypatch.setattr(TransportClient, "_deliver", blocking_deliver)
    assert langfeather.shutdown(timeout=1)
    langfeather.configure(
        endpoint="http://127.0.0.1:4319",
        shutdown_timeout=0.01,
    )
    enqueue_envelope(_trace_envelope("tr_timeout_then_finish"))
    assert request_entered.wait(timeout=1)
    retired_client = _transport._client
    assert retired_client is not None

    try:
        langfeather.configure(
            endpoint="http://127.0.0.1:4320",
            shutdown_timeout=0.01,
        )
        assert len(_transport._retiring_clients) == 1
        release_request.set()
        retired_client._thread.join(timeout=1)
        assert not retired_client._thread.is_alive()

        langfeather.configure(endpoint="http://127.0.0.1:4321")

        assert not _transport._retiring_clients
    finally:
        release_request.set()
        assert langfeather.shutdown(timeout=1)


def test_enqueue_retries_once_on_new_generation_after_configure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue_entered = threading.Event()
    release_enqueue = threading.Event()
    delivered_trace_ids: list[str] = []

    def record_delivery(
        self: TransportClient,
        batch: list[_transport._QueuedEnvelope],
    ) -> None:
        del self
        delivered_trace_ids.extend(item.envelope["trace"]["trace_id"] for item in batch)

    monkeypatch.setattr(TransportClient, "_deliver", record_delivery)
    assert langfeather.shutdown(timeout=1)
    langfeather.configure(endpoint="http://127.0.0.1:4319")
    old_client = _transport._get_client()
    assert old_client is not None
    original_enqueue = old_client.enqueue

    def delayed_enqueue(envelope: Envelope) -> bool:
        enqueue_entered.set()
        assert release_enqueue.wait(timeout=2)
        return original_enqueue(envelope)

    monkeypatch.setattr(old_client, "enqueue", delayed_enqueue)
    enqueue_thread = threading.Thread(
        target=lambda: enqueue_envelope(_trace_envelope("tr_generation_retry"))
    )
    enqueue_thread.start()
    assert enqueue_entered.wait(timeout=1)

    try:
        langfeather.configure(endpoint="http://127.0.0.1:4320")
        release_enqueue.set()
        enqueue_thread.join(timeout=1)
        assert not enqueue_thread.is_alive()
        assert langfeather.flush(timeout=1)

        assert delivered_trace_ids == ["tr_generation_retry"]
        assert _transport._client is not old_client
    finally:
        release_enqueue.set()
        enqueue_thread.join(timeout=1)
        assert langfeather.shutdown(timeout=1)


def test_shutdown_flush_timeout_is_bounded_and_warned(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    request_entered = threading.Event()
    release_request = threading.Event()

    def blocking_urlopen(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        del request, timeout
        request_entered.set()
        assert release_request.wait(timeout=2)
        return _Response({"results": [{"trace_id": "tr_shutdown", "status": "stored"}]})

    monkeypatch.setattr(urllib.request, "urlopen", blocking_urlopen)
    caplog.set_level(logging.WARNING, logger="langfeather")
    client = _client()
    try:
        assert client.enqueue(_trace_envelope("tr_shutdown"))
        assert request_entered.wait(timeout=1)
        started_at = time.monotonic()

        assert not client.shutdown(timeout=0.01)

        assert time.monotonic() - started_at < 0.2
        assert "shutdown timed out" in caplog.text
        assert not client.enqueue(_trace_envelope("tr_too_late"))
    finally:
        release_request.set()
        assert client.shutdown(timeout=1)


def test_public_enqueue_helper_isolates_sender_failures(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class _BrokenClient:
        def enqueue(self, envelope: Envelope) -> bool:
            del envelope
            raise RuntimeError("trace enqueue failed")

    def broken_client() -> tuple[_BrokenClient, int]:
        return _BrokenClient(), 0

    monkeypatch.setattr(_transport, "_get_client_snapshot", broken_client)
    caplog.set_level(logging.WARNING, logger="langfeather")

    enqueue_envelope(_trace_envelope("tr_isolated"))

    assert "could not enqueue a trace" in caplog.text


def test_collector_outage_does_not_change_wrapped_application_result(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def unavailable_collector(
        request: urllib.request.Request,
        *,
        timeout: float,
    ) -> _Response:
        del request, timeout
        raise urllib.error.URLError("collector unavailable")

    monkeypatch.setattr(urllib.request, "urlopen", unavailable_collector)
    caplog.set_level(logging.WARNING, logger="langfeather")
    langfeather.configure(
        endpoint="http://127.0.0.1:4319",
        retry_count=0,
        retry_backoff=0,
    )
    try:
        result = langfeather.wrap_runnable(_PlainRunnable()).invoke("student app")

        assert result == "STUDENT APP"
        assert langfeather.flush(timeout=1)
        assert "collector unavailable" in caplog.text
    finally:
        assert langfeather.shutdown(timeout=1)
