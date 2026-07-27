from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import TypedDict, cast

import pytest
import uvicorn
from langgraph.graph import END, START, StateGraph

import langfeather
from langfeather_server.app import create_app


class StudentState(TypedDict, total=False):
    question: str
    draft: str
    answer: str


def draft_answer(state: StudentState) -> StudentState:
    return {"draft": f"초안: {state['question']}"}


def finalize_answer(state: StudentState) -> StudentState:
    return {"answer": f"완성: {state['draft']}"}


def _get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return cast(dict[str, object], json.loads(response.read()))


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[tuple[str, Path]]:
    database_path = tmp_path / "langfeather-integration.db"
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

    socket = server.servers[0].sockets[0]
    port = int(socket.getsockname()[1])
    try:
        yield f"http://127.0.0.1:{port}", database_path
    finally:
        langfeather.shutdown(timeout=2)
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            pytest.fail("Uvicorn did not stop after the integration test")


def test_langgraph_sdk_api_sqlite_round_trip(
    live_server: tuple[str, Path],
) -> None:
    endpoint, database_path = live_server
    builder = StateGraph(StudentState)
    builder.add_node("draft_answer", draft_answer)
    builder.add_node("finalize_answer", finalize_answer)
    builder.add_edge(START, "draft_answer")
    builder.add_edge("draft_answer", "finalize_answer")
    builder.add_edge("finalize_answer", END)
    graph = langfeather.wrap_runnable(
        builder.compile(),
        name="quickstart",
    )
    langfeather.configure(
        endpoint=endpoint,
        request_timeout=2,
        retry_count=0,
    )

    result = graph.invoke(
        {"question": "LangGraph 노드가 왜 두 번 실행됐지?"},
        {"configurable": {"thread_id": "quickstart-session-01"}},
    )

    assert result == {
        "question": "LangGraph 노드가 왜 두 번 실행됐지?",
        "draft": "초안: LangGraph 노드가 왜 두 번 실행됐지?",
        "answer": "완성: 초안: LangGraph 노드가 왜 두 번 실행됐지?",
    }
    assert langfeather.flush(timeout=5)

    trace_list = _get_json(f"{endpoint}/api/v1/traces")
    items = cast(list[dict[str, object]], trace_list["items"])
    assert len(items) == 1
    assert items[0]["name"] == "quickstart"
    assert items[0]["status"] == "completed"
    assert items[0]["session_id"] == "quickstart-session-01"

    trace_id = cast(str, items[0]["trace_id"])
    detail = _get_json(f"{endpoint}/api/v1/traces/{trace_id}")
    observations = cast(list[dict[str, object]], detail["observations"])
    roots = [
        observation
        for observation in observations
        if observation["parent_observation_id"] is None
    ]
    assert len(roots) == 1
    root = roots[0]
    assert {"draft_answer", "finalize_answer"}.issubset(
        {cast(str, observation["name"]) for observation in observations}
    )
    assert all(observation["trace_id"] == trace_id for observation in observations)
    assert all(
        observation["parent_observation_id"] == root["observation_id"]
        for observation in observations
        if observation is not root
    )
    assert len({observation["sequence"] for observation in observations}) == len(
        observations
    )
    assert all(observation["status"] == "completed" for observation in observations)
    assert detail["feedback"] == []
    assert all(
        "input" not in observation and "output" not in observation
        for observation in observations
    )

    draft_observation = next(
        observation
        for observation in observations
        if observation["name"] == "draft_answer"
    )
    payload = _get_json(
        f"{endpoint}/api/v1/observations/"
        f"{draft_observation['observation_id']}"
    )
    assert payload["input"] == {
        "question": "LangGraph 노드가 왜 두 번 실행됐지?"
    }
    assert payload["output"] == {
        "draft": "초안: LangGraph 노드가 왜 두 번 실행됐지?"
    }

    with sqlite3.connect(database_path) as connection:
        stored_trace = connection.execute(
            "SELECT name, status FROM traces WHERE trace_id = ?",
            (trace_id,),
        ).fetchone()
        stored_observation_count = connection.execute(
            "SELECT COUNT(*) FROM observations WHERE trace_id = ?",
            (trace_id,),
        ).fetchone()
    assert stored_trace == ("quickstart", "completed")
    assert stored_observation_count == (len(observations),)
