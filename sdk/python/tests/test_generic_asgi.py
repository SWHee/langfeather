from __future__ import annotations

import asyncio
import traceback
from typing import Any

import pytest

import langfeather._observe as observe_module
from langfeather._asgi import wrap_asgi
from langfeather._observe import observe
from langfeather._runnable import wrap_runnable

Scope = dict[str, Any]
Message = dict[str, Any]


@pytest.fixture
def captured_envelopes(
    monkeypatch: pytest.MonkeyPatch,
) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(observe_module, "enqueue_envelope", captured.append)
    return captured


def http_scope() -> Scope:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "http",
        "method": "POST",
        "root_path": "",
        "path": "/students",
        "raw_path": b"/students",
        "query_string": b"lesson=3",
        "headers": [
            (b"cookie", b"session=secret"),
            (b"authorization", b"Bearer secret"),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("127.0.0.1", 8000),
    }


def test_asgi_normal_response_records_http_root_without_headers(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    received_messages = [{"type": "http.request", "body": b"question"}]
    sent_messages: list[Message] = []

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        expected_message = received_messages[0]
        assert await receive() == expected_message
        await send(
            {
                "type": "http.response.start",
                "status": 201,
                "headers": [(b"set-cookie", b"secret=1")],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b"hello ",
                "more_body": True,
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b"student",
                "more_body": False,
            }
        )

    async def receive() -> Message:
        return received_messages.pop(0)

    async def send(message: Message) -> None:
        sent_messages.append(message)

    asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert [message["type"] for message in sent_messages] == [
        "http.response.start",
        "http.response.body",
        "http.response.body",
    ]
    envelope = captured_envelopes[0]
    assert envelope["trace"]["status"] == "completed"
    root = envelope["observations"][0]
    assert root["name"] == "POST /students"
    assert root["kind"] == "http"
    assert "headers" not in root["input"]
    assert root["input"]["query_string"]["__type__"] == "builtins.bytes"
    assert root["output"]["status_code"] == 201
    assert root["output"]["body"]["__type__"] == "builtins.bytes"
    assert "headers" not in root["output"]


def test_asgi_exception_is_preserved_and_recorded_failed(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    original = RuntimeError("student ASGI app failed")

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        raise original

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        raise AssertionError(f"unexpected message: {message}")

    with pytest.raises(RuntimeError) as caught:
        asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert caught.value is original
    envelope = captured_envelopes[0]
    assert envelope["trace"]["status"] == "failed"
    root = envelope["observations"][0]
    assert root["error"]["message"] == "student ASGI app failed"
    assert root["output"] == {
        "status_code": None,
        "body": {
            "__type__": "builtins.bytes",
            "encoding": "base64",
            "value": "",
        },
    }


def test_asgi_stream_disconnect_message_is_unchanged_and_records_cancelled(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    disconnect = {"type": "http.disconnect", "reason": "student closed tab"}
    observed_message: list[Message] = []

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send(
            {
                "type": "http.response.body",
                "body": b"partial",
                "more_body": True,
            }
        )
        observed_message.append(await receive())

    async def receive() -> Message:
        return disconnect

    async def send(message: Message) -> None:
        return None

    asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert observed_message == [disconnect]
    envelope = captured_envelopes[0]
    assert envelope["trace"]["status"] == "cancelled"
    root = envelope["observations"][0]
    assert root["status"] == "cancelled"
    assert root["output"] == {
        "status_code": 200,
        "body": {
            "__type__": "builtins.bytes",
            "encoding": "base64",
            "value": "cGFydGlhbA==",
        },
    }
    assert envelope["trace"]["output"] == root["output"]


def test_asgi_disconnect_stays_cancelled_when_app_raises_original_exception(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    disconnect = {"type": "http.disconnect", "reason": "student closed tab"}
    original = RuntimeError("framework surfaced disconnect")

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        assert await receive() is disconnect
        raise original

    async def receive() -> Message:
        return disconnect

    async def send(message: Message) -> None:
        raise AssertionError(f"unexpected message: {message}")

    with pytest.raises(RuntimeError) as caught:
        asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert caught.value is original
    assert traceback.extract_tb(caught.value.__traceback__)[-1].name == "app"
    envelope = captured_envelopes[0]
    assert envelope["trace"]["status"] == "cancelled"
    root = envelope["observations"][0]
    assert root["status"] == "cancelled"
    assert root["output"] == {
        "status_code": None,
        "body": {
            "__type__": "builtins.bytes",
            "encoding": "base64",
            "value": "",
        },
    }


def test_asgi_root_contains_nested_observe_without_duplicate_envelope(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    @observe
    async def build_response() -> bytes:
        return b"ok"

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        body = await build_response()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        return None

    asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert len(captured_envelopes) == 1
    root, child = captured_envelopes[0]["observations"]
    assert root["kind"] == "http"
    assert child["name"] == "build_response"
    assert child["parent_observation_id"] == root["observation_id"]


def test_http_request_starts_a_new_root_even_with_an_ambient_context(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    async def app(scope: Scope, receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        return None

    wrapped = wrap_asgi(app)

    @observe(name="ambient_task")
    async def ambient_task() -> None:
        await wrapped(http_scope(), receive, send)

    asyncio.run(ambient_task())

    assert len(captured_envelopes) == 2
    by_name = {envelope["trace"]["name"]: envelope for envelope in captured_envelopes}
    http_envelope = by_name["POST /students"]
    ambient_envelope = by_name["ambient_task"]
    assert len(http_envelope["observations"]) == 1
    assert http_envelope["observations"][0]["parent_observation_id"] is None
    assert len(ambient_envelope["observations"]) == 1


def test_asgi_root_is_reused_by_a_nested_runnable(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    class CallbackRunnable:
        async def ainvoke(
            self,
            value: str,
            config: dict[str, Any] | None = None,
            **kwargs: object,
        ) -> str:
            assert config is not None
            callbacks = config["callbacks"]
            for callback in callbacks:
                callback.on_chain_start(
                    {"name": "student_graph"},
                    value,
                    run_id="runnable-root",
                    name="student_graph",
                )
                callback.on_chain_end("answer", run_id="runnable-root")
            return "answer"

    graph = wrap_runnable(CallbackRunnable())

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        assert await graph.ainvoke("question") == "answer"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"answer"})

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        return None

    asyncio.run(wrap_asgi(app)(http_scope(), receive, send))

    assert len(captured_envelopes) == 1
    root, runnable = captured_envelopes[0]["observations"]
    assert root["kind"] == "http"
    assert runnable["name"] == "student_graph"
    assert runnable["parent_observation_id"] == root["observation_id"]


def test_broken_asgi_diagnostic_objects_do_not_change_messages_or_app_result(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    class BrokenScope(dict[str, Any]):
        def __getitem__(self, key: str) -> Any:
            if key == "query_string":
                raise RuntimeError("scope inspection failed")
            return super().__getitem__(key)

    class BrokenMessage(dict[str, Any]):
        def get(self, key: str, default: Any = None) -> Any:
            raise RuntimeError("message inspection failed")

    scope = BrokenScope(http_scope())
    received = BrokenMessage({"type": "http.request", "body": b"unchanged"})
    response = BrokenMessage({"type": "http.response.body", "body": b"unchanged"})
    messages_seen_by_app: list[Message] = []
    messages_seen_by_server: list[Message] = []

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        message = await receive()
        assert message is received
        messages_seen_by_app.append(message)
        await send(response)

    async def receive() -> Message:
        return received

    async def send(message: Message) -> None:
        assert message is response
        messages_seen_by_server.append(message)

    asyncio.run(wrap_asgi(app)(scope, receive, send))

    assert messages_seen_by_app == [received]
    assert messages_seen_by_server == [response]
    assert captured_envelopes[0]["trace"]["status"] == "completed"


def test_non_http_asgi_scope_passes_through_without_trace(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    calls: list[str] = []

    async def app(scope: Scope, receive: Any, send: Any) -> None:
        calls.append(scope["type"])

    async def receive() -> Message:
        return {"type": "lifespan.startup"}

    async def send(message: Message) -> None:
        return None

    asyncio.run(wrap_asgi(app)({"type": "lifespan"}, receive, send))

    assert calls == ["lifespan"]
    assert captured_envelopes == []
