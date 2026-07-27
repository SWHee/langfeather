from __future__ import annotations

import json
import threading
import traceback
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar, cast

import pytest

import langfeather


class _RecordingHandler(BaseHTTPRequestHandler):
    requests: ClassVar[list[dict[str, Any]]] = []
    requests_lock: ClassVar[threading.Lock] = threading.Lock()

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        body = cast(
            dict[str, Any],
            json.loads(self.rfile.read(content_length)),
        )
        with self.requests_lock:
            self.requests.append(body)
        response = json.dumps(
            {
                "results": [
                    {
                        "trace_id": item["trace"]["trace_id"],
                        "status": "stored",
                        "error": None,
                    }
                    for item in body["items"]
                ]
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


@dataclass(slots=True)
class _Collector:
    endpoint: str
    server: ThreadingHTTPServer
    thread: threading.Thread
    stopped: bool = False

    def stop(self) -> None:
        if self.stopped:
            return
        self.stopped = True
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if self.thread.is_alive():
            raise RuntimeError("test collector did not stop")


@pytest.fixture
def stoppable_collector() -> Iterator[_Collector]:
    _RecordingHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingHandler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="langfeather-test-collector",
        daemon=True,
    )
    thread.start()
    collector = _Collector(
        endpoint=f"http://127.0.0.1:{server.server_port}",
        server=server,
        thread=thread,
    )
    try:
        yield collector
    finally:
        langfeather.shutdown(timeout=1)
        collector.stop()


class _SyncRunnable:
    def __init__(self, result: dict[str, str]) -> None:
        self.result = result

    def invoke(
        self,
        value: str,
        config: object = None,
        **kwargs: object,
    ) -> dict[str, str]:
        del value, config, kwargs
        return self.result


class _StreamRunnable:
    def __init__(self, chunks: tuple[str, ...]) -> None:
        self.chunks = chunks

    def stream(
        self,
        value: str,
        config: object = None,
        **kwargs: object,
    ) -> Iterator[str]:
        del value, config, kwargs
        yield from self.chunks


class _ApplicationFailure(RuntimeError):
    pass


def _raise_application_failure(error: _ApplicationFailure) -> None:
    raise error


class _FailingRunnable:
    def __init__(self) -> None:
        self.last_error: _ApplicationFailure | None = None

    def invoke(
        self,
        value: str,
        config: object = None,
        **kwargs: object,
    ) -> None:
        del value, config, kwargs
        error = _ApplicationFailure("student application failed")
        self.last_error = error
        _raise_application_failure(error)


@dataclass(frozen=True, slots=True)
class _Behavior:
    sync_result: dict[str, str]
    stream_chunks: tuple[str, ...]
    caught_error: _ApplicationFailure
    original_error: _ApplicationFailure
    traceback_tail: tuple[str, str, int]


def _exercise_application(
    sync_graph: Any,
    stream_graph: Any,
    failing_graph: Any,
    failing_runnable: _FailingRunnable,
) -> _Behavior:
    sync_result = cast(dict[str, str], sync_graph.invoke("question"))
    stream_chunks = tuple(cast(Iterator[str], stream_graph.stream("question")))

    with pytest.raises(_ApplicationFailure) as caught:
        failing_graph.invoke("question")
    original_error = failing_runnable.last_error
    assert original_error is not None
    frames = traceback.extract_tb(caught.value.__traceback__)
    assert frames
    tail = frames[-1]
    assert tail.lineno is not None
    return _Behavior(
        sync_result=sync_result,
        stream_chunks=stream_chunks,
        caught_error=caught.value,
        original_error=original_error,
        traceback_tail=(Path(tail.filename).name, tail.name, tail.lineno),
    )


def test_collector_outage_does_not_change_application_behavior(
    stoppable_collector: _Collector,
    caplog: pytest.LogCaptureFixture,
) -> None:
    expected_result = {"answer": "관측 상태와 무관한 답변"}
    expected_chunks = ("첫 번째 ", "두 번째 ", "마지막")
    sync_graph = langfeather.wrap_runnable(_SyncRunnable(expected_result))
    stream_graph = langfeather.wrap_runnable(_StreamRunnable(expected_chunks))
    failing_runnable = _FailingRunnable()
    failing_graph = langfeather.wrap_runnable(failing_runnable)

    langfeather.configure(
        endpoint=stoppable_collector.endpoint,
        request_timeout=0.1,
        retry_count=0,
        retry_backoff=0,
        shutdown_timeout=1,
    )
    reachable = _exercise_application(
        sync_graph,
        stream_graph,
        failing_graph,
        failing_runnable,
    )
    assert langfeather.flush(timeout=2)
    assert langfeather.shutdown(timeout=1)
    delivered_count = sum(
        len(cast(list[object], request["items"]))
        for request in _RecordingHandler.requests
    )
    assert delivered_count == 3

    stoppable_collector.stop()
    caplog.clear()
    langfeather.configure(
        endpoint=stoppable_collector.endpoint,
        request_timeout=0.05,
        retry_count=0,
        retry_backoff=0,
        shutdown_timeout=1,
    )
    unreachable = _exercise_application(
        sync_graph,
        stream_graph,
        failing_graph,
        failing_runnable,
    )
    assert langfeather.flush(timeout=2)
    assert langfeather.shutdown(timeout=1)

    assert reachable.sync_result is expected_result
    assert unreachable.sync_result is expected_result
    assert reachable.stream_chunks == expected_chunks
    assert unreachable.stream_chunks == expected_chunks
    assert reachable.caught_error is reachable.original_error
    assert unreachable.caught_error is unreachable.original_error
    assert type(reachable.caught_error) is type(unreachable.caught_error)
    assert str(reachable.caught_error) == str(unreachable.caught_error)
    assert reachable.traceback_tail == unreachable.traceback_tail
    assert reachable.traceback_tail[:2] == (
        "test_sdk_failure_isolation.py",
        "_raise_application_failure",
    )
    assert "could not deliver" in caplog.text
