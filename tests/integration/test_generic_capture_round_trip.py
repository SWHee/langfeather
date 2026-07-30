from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
import uvicorn
from pydantic import BaseModel

import langfeather
from langfeather_server.app import create_app


def _get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return cast(dict[str, object], json.loads(response.read()))


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[str]:
    database_path = tmp_path / "langfeather-generic-integration.db"
    application = create_app(database_url=f"sqlite:///{database_path}")
    config = uvicorn.Config(
        application,
        host="127.0.0.1",
        port=0,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        pytest.fail("Uvicorn did not start for the integration test")

    port = int(server.servers[0].sockets[0].getsockname()[1])
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        langfeather.shutdown(timeout=2)
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            pytest.fail("Uvicorn did not stop after the integration test")


class StudentInput(BaseModel):
    question: str
    attempts: int


@dataclass(slots=True)
class StudentOutput:
    answer: str


def _callbacks(config: dict[str, Any]) -> list[Any]:
    callbacks = config["callbacks"]
    assert isinstance(callbacks, list)
    return callbacks


class _CallbackVisibleChild:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        del kwargs
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "format_answer"},
                value,
                run_id=run_id,
                name="format_answer",
            )
            callback.on_chain_end(f"답변: {value}", run_id=run_id)
        return f"답변: {value}"


def test_generic_capture_sdk_api_sqlite_round_trip(live_server: str) -> None:
    child = langfeather.wrap_runnable(_CallbackVisibleChild())

    @langfeather.observe(name="student-generic", session_id="phase3-session")
    def answer(payload: StudentInput) -> StudentOutput:
        with langfeather.span(
            "prepare_question",
            input={"attempts": payload.attempts},
        ) as current_span:
            prepared = payload.question.strip()
            current_span.set_output(prepared)
        return StudentOutput(answer=child.invoke(prepared))

    langfeather.configure(
        endpoint=live_server,
        request_timeout=2,
        retry_count=0,
    )
    result = answer(StudentInput(question="  왜 실패했지?  ", attempts=2))

    assert result == StudentOutput(answer="답변: 왜 실패했지?")
    assert langfeather.flush(timeout=5)

    trace_list = _get_json(f"{live_server}/api/v1/traces")
    items = cast(list[dict[str, object]], trace_list["items"])
    assert len(items) == 1
    assert items[0]["name"] == "student-generic"
    assert items[0]["status"] == "completed"
    assert items[0]["session_id"] == "phase3-session"

    trace_id = cast(str, items[0]["trace_id"])
    detail = _get_json(f"{live_server}/api/v1/traces/{trace_id}")
    observations = cast(list[dict[str, object]], detail["observations"])
    assert [item["name"] for item in observations] == [
        "student-generic",
        "prepare_question",
        "format_answer",
    ]
    root, span_observation, runnable_observation = observations
    assert root["parent_observation_id"] is None
    assert span_observation["parent_observation_id"] == root["observation_id"]
    assert runnable_observation["parent_observation_id"] == root["observation_id"]

    root_payload = _get_json(
        f"{live_server}/api/v1/observations/{root['observation_id']}"
    )
    root_input = cast(dict[str, object], root_payload["input"])
    args = cast(list[dict[str, object]], root_input["args"])
    input_type = args[0]["__type__"]
    assert isinstance(input_type, str)
    assert input_type.endswith(".StudentInput")
    assert cast(dict[str, object], args[0]["fields"]) == {
        "question": "  왜 실패했지?  ",
        "attempts": 2,
    }
    root_output = cast(dict[str, object], root_payload["output"])
    output_type = root_output["__type__"]
    assert isinstance(output_type, str)
    assert output_type.endswith(".StudentOutput")
    assert cast(dict[str, object], root_output["fields"]) == {
        "answer": "답변: 왜 실패했지?"
    }

    started_at = cast(str, items[0]["started_at"])
    started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    dashboard = _get_json(
        f"{live_server}/api/v1/dashboard?"
        f"from={(started - timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')}&"
        f"to={(started + timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')}&"
        "timezone=UTC&query=student-generic&session_id=phase3-session"
    )
    totals = cast(dict[str, object], dashboard["totals"])
    assert totals["trace_count"] == 1
    assert totals["error"] == {"failed": 0, "total": 1, "rate": 0.0}
    buckets = cast(list[dict[str, object]], dashboard["buckets"])
    assert sum(
        cast(dict[str, int], bucket["requests"])["completed"] for bucket in buckets
    ) == 1
