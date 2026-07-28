from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from uuid import uuid4

import pytest

import langfeather


class _RecordingHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []
    received = threading.Condition()

    def do_POST(self) -> None:
        content_length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(content_length))
        with self.received:
            self.requests.append(body)
            self.received.notify_all()
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
        return


@pytest.fixture
def collector() -> Iterator[tuple[str, list[dict[str, Any]]]]:
    _RecordingHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        yield endpoint, _RecordingHandler.requests
    finally:
        langfeather.shutdown(timeout=2)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _callbacks(config: dict[str, Any]) -> list[Any]:
    callbacks = config["callbacks"]
    assert isinstance(callbacks, list)
    return callbacks


class _SequentialRunnable:
    def invoke(
        self,
        value: dict[str, str],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> dict[str, str]:
        assert config is not None
        root_run_id = uuid4()
        child_run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "student_graph"},
                value,
                run_id=root_run_id,
                name="student_graph",
                metadata={"langgraph_step": 0},
            )
            callback.on_chain_start(
                {"name": "draft_answer"},
                value,
                run_id=child_run_id,
                parent_run_id=root_run_id,
                name="draft_answer",
                metadata={"langgraph_node": "draft_answer", "langgraph_step": 1},
            )
            callback.on_chain_end(
                {"draft": "hello"},
                run_id=child_run_id,
                parent_run_id=root_run_id,
            )
            callback.on_chain_end(
                {"answer": "hello"},
                run_id=root_run_id,
            )
        return {"answer": "hello"}

    async def ainvoke(
        self,
        value: dict[str, str],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> dict[str, str]:
        await asyncio.sleep(0)
        return self.invoke(value, config, **kwargs)


class _FailingRunnable:
    def __init__(self, error: RuntimeError) -> None:
        self.error = error

    def invoke(
        self,
        value: dict[str, str],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> None:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "failing_graph"},
                value,
                run_id=run_id,
                name="failing_graph",
            )
            callback.on_chain_error(self.error, run_id=run_id)
        raise self.error


class _CancelledRunnable:
    def __init__(self, error: asyncio.CancelledError) -> None:
        self.error = error

    async def ainvoke(
        self,
        value: dict[str, str],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> None:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "cancelled_graph"},
                value,
                run_id=run_id,
                name="cancelled_graph",
            )
            callback.on_chain_error(self.error, run_id=run_id)
        raise self.error


class _ExistingCallback:
    def __init__(self) -> None:
        self.events: list[str] = []

    def on_chain_start(self, *args: object, **kwargs: object) -> None:
        self.events.append("start")

    def on_chain_end(self, *args: object, **kwargs: object) -> None:
        self.events.append("end")


class _BrokenString:
    def __str__(self) -> str:
        raise RuntimeError("session conversion failed")


class _BrokenNameRunnable(_SequentialRunnable):
    @property
    def get_name(self) -> object:
        raise RuntimeError("name lookup failed")


class _NestedChildRunnable:
    def invoke(
        self,
        value: dict[str, Any],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> dict[str, str]:
        assert config is not None
        run_id = uuid4()
        parent_run_id = value["parent_run_id"]
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "nested_child"},
                {"question": value["question"]},
                run_id=run_id,
                parent_run_id=parent_run_id,
                name="nested_child",
            )
            callback.on_chain_end(
                {"draft": "nested"},
                run_id=run_id,
                parent_run_id=parent_run_id,
            )
        return {"draft": "nested"}


class _NestedOuterRunnable:
    def __init__(self) -> None:
        self.inner = langfeather.wrap_runnable(_NestedChildRunnable())

    def invoke(
        self,
        value: dict[str, str],
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> dict[str, str]:
        assert config is not None
        root_run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "nested_outer"},
                value,
                run_id=root_run_id,
                name="nested_outer",
            )
        child_result = self.inner.invoke(
            {
                "question": value["question"],
                "parent_run_id": root_run_id,
            },
            config,
        )
        result = {"answer": child_result["draft"]}
        for callback in _callbacks(config):
            callback.on_chain_end(result, run_id=root_run_id)
        return result


def test_wrap_runnable_emits_callback_root_and_nested_run(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = graph.invoke(
        {"question": "hello"},
        {"configurable": {"thread_id": "student-session"}},
    )

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    envelope = requests[0]["items"][0]
    assert envelope["schema_version"] == 1
    assert envelope["trace"]["name"] == "student_graph"
    assert envelope["trace"]["session_id"] == "student-session"
    assert envelope["trace"]["input"] == {"question": "hello"}
    assert envelope["trace"]["output"] == {"answer": "hello"}
    assert len(envelope["observations"]) == 2

    root, child = envelope["observations"]
    assert root["name"] == "student_graph"
    assert root["parent_observation_id"] is None
    assert child["name"] == "draft_answer"
    assert child["parent_observation_id"] == root["observation_id"]
    assert child["metadata"]["langgraph_node"] == "draft_answer"


def test_wrap_runnable_preserves_original_exception(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    original = RuntimeError("student graph failed")
    graph = langfeather.wrap_runnable(_FailingRunnable(original))

    with pytest.raises(RuntimeError) as caught:
        graph.invoke({"question": "hello"})

    assert caught.value is original
    assert langfeather.flush(timeout=2)
    envelope = requests[0]["items"][0]
    assert envelope["trace"]["status"] == "failed"
    assert envelope["observations"][0]["status"] == "failed"
    assert envelope["trace"]["error"]["message"] == "student graph failed"


def test_wrap_runnable_supports_async_invoke(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = asyncio.run(
        graph.ainvoke(
            {"question": "hello"},
            {"configurable": {"thread_id": "async-student-session"}},
        )
    )

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    envelope = requests[0]["items"][0]
    assert envelope["trace"]["session_id"] == "async-student-session"
    assert len(envelope["observations"]) == 2


def test_session_extraction_failure_does_not_block_runnable(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = graph.invoke(
        {"question": "hello"},
        {"configurable": {"thread_id": _BrokenString()}},
    )

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    assert requests[0]["items"][0]["trace"]["session_id"] is None


def test_explicit_session_metadata_precedes_langgraph_thread_id(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = graph.invoke(
        {"question": "hello"},
        {
            "metadata": {"session_id": "explicit-session"},
            "configurable": {"thread_id": "langgraph-thread"},
        },
    )

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    assert (
        requests[0]["items"][0]["trace"]["session_id"]
        == "explicit-session"
    )


def test_explicit_langfeather_trace_id_is_preserved(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = graph.invoke(
        {"question": "feedback can find this trace"},
        {"metadata": {"langfeather_trace_id": "rag-feedback-trace"}},
    )

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    assert requests[0]["items"][0]["trace"]["trace_id"] == "rag-feedback-trace"


def test_name_lookup_failure_does_not_block_runnable(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_BrokenNameRunnable())

    result = graph.invoke({"question": "hello"})

    assert result == {"answer": "hello"}
    assert langfeather.flush(timeout=2)
    assert requests[0]["items"][0]["trace"]["name"] == "student_graph"


def test_async_cancellation_is_preserved_and_recorded(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    original = asyncio.CancelledError("student cancelled")
    graph = langfeather.wrap_runnable(_CancelledRunnable(original))

    async def scenario() -> None:
        with pytest.raises(asyncio.CancelledError) as caught:
            await graph.ainvoke({"question": "hello"})
        assert caught.value is original

    asyncio.run(scenario())
    assert langfeather.flush(timeout=2)
    envelope = requests[0]["items"][0]
    assert envelope["trace"]["status"] == "cancelled"
    assert envelope["observations"][0]["status"] == "cancelled"


def test_configure_uses_environment_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    monkeypatch.setenv("LANGFEATHER_ENDPOINT", endpoint)
    langfeather.configure()

    langfeather.wrap_runnable(_SequentialRunnable()).invoke({"question": "hello"})

    assert langfeather.flush(timeout=2)
    assert requests


def test_existing_callbacks_are_preserved(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, _ = collector
    langfeather.configure(endpoint=endpoint)
    existing = _ExistingCallback()
    graph = langfeather.wrap_runnable(_SequentialRunnable())

    result = graph.invoke({"question": "hello"}, {"callbacks": [existing]})

    assert result == {"answer": "hello"}
    assert existing.events == ["start", "start", "end", "end"]
    assert langfeather.flush(timeout=2)


def test_nested_wrapper_reuses_active_trace_without_duplicate_envelope(
    collector: tuple[str, list[dict[str, Any]]],
) -> None:
    endpoint, requests = collector
    langfeather.configure(endpoint=endpoint)
    graph = langfeather.wrap_runnable(_NestedOuterRunnable())

    assert graph.invoke({"question": "hello"}) == {"answer": "nested"}
    assert langfeather.flush(timeout=2)

    assert len(requests) == 1
    assert len(requests[0]["items"]) == 1
    envelope = requests[0]["items"][0]
    assert [item["name"] for item in envelope["observations"]] == [
        "nested_outer",
        "nested_child",
    ]
    root, child = envelope["observations"]
    assert root["parent_observation_id"] is None
    assert child["parent_observation_id"] == root["observation_id"]
