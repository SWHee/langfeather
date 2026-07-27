from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import time
import urllib.request
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import pytest
import uvicorn
from examples.langgraph_runtime_fidelity.fixtures import (
    build_cancelled_stream_graph,
    build_conditional_graph,
    build_failed_root_graph,
    build_fallback_graph,
    build_loop_graph,
    build_nested_runnable_graph,
    build_parallel_graph,
    build_sequential_graph,
    build_stream_graph,
    build_streaming_llm_graph,
)
from langchain_core.messages import AIMessageChunk, HumanMessage

import langfeather
from langfeather_server.app import create_app


@dataclass(frozen=True, slots=True)
class RuntimeServer:
    endpoint: str
    database_path: Path


@dataclass(frozen=True, slots=True)
class StoredTrace:
    summary: dict[str, Any]
    detail: dict[str, Any]
    observations: list[dict[str, Any]]

    @property
    def root(self) -> dict[str, Any]:
        roots = [
            observation
            for observation in self.observations
            if observation["parent_observation_id"] is None
        ]
        assert len(roots) == 1
        return roots[0]


def _get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=2) as response:
        value = json.loads(response.read())
    assert isinstance(value, dict)
    return cast(dict[str, Any], value)


@pytest.fixture(scope="module")
def runtime_server(
    tmp_path_factory: pytest.TempPathFactory,
) -> Iterator[RuntimeServer]:
    database_path = tmp_path_factory.mktemp("runtime-fidelity") / "langfeather.db"
    application = create_app(database_url=f"sqlite:///{database_path}")
    config = uvicorn.Config(
        application,
        host="127.0.0.1",
        port=0,
        workers=1,
        log_level="warning",
        access_log=False,
    )
    assert config.workers == 1
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        pytest.fail("single-worker Uvicorn did not start")

    socket = server.servers[0].sockets[0]
    port = int(socket.getsockname()[1])
    endpoint = f"http://127.0.0.1:{port}"
    langfeather.configure(
        endpoint=endpoint,
        request_timeout=2,
        retry_count=0,
    )
    try:
        yield RuntimeServer(endpoint=endpoint, database_path=database_path)
    finally:
        langfeather.shutdown(timeout=3)
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            pytest.fail("single-worker Uvicorn did not stop")


def _load_trace(endpoint: str, name: str) -> StoredTrace:
    trace_list = _get_json(f"{endpoint}/api/v1/traces?limit=50")
    items = cast(list[dict[str, Any]], trace_list["items"])
    matches = [item for item in items if item["name"] == name]
    assert len(matches) == 1
    summary = matches[0]
    detail = _get_json(
        f"{endpoint}/api/v1/traces/{summary['trace_id']}",
    )
    observations = cast(list[dict[str, Any]], detail["observations"])
    stored = StoredTrace(
        summary=summary,
        detail=detail,
        observations=observations,
    )
    _assert_observation_contract(stored)
    return stored


def _assert_observation_contract(trace: StoredTrace) -> None:
    observation_ids = {
        cast(str, observation["observation_id"])
        for observation in trace.observations
    }
    sequences = [
        cast(int, observation["sequence"]) for observation in trace.observations
    ]
    assert len(observation_ids) == len(trace.observations)
    assert len(set(sequences)) == len(sequences)
    assert sequences == sorted(sequences)
    for observation in trace.observations:
        parent_id = observation["parent_observation_id"]
        assert parent_id is None or parent_id in observation_ids
        assert _timestamp(observation["started_at"]) <= _timestamp(
            observation["ended_at"]
        )


def _timestamp(value: object) -> datetime:
    assert isinstance(value, str)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _named(trace: StoredTrace, name: str) -> list[dict[str, Any]]:
    return [
        observation
        for observation in trace.observations
        if observation["name"] == name
    ]


def _payload(endpoint: str, observation: dict[str, Any]) -> dict[str, Any]:
    return _get_json(
        f"{endpoint}/api/v1/observations/{observation['observation_id']}"
    )


def _assert_sqlite_trace(
    database_path: Path,
    trace: StoredTrace,
    *,
    status: str,
) -> None:
    with sqlite3.connect(database_path) as connection:
        row = connection.execute(
            """
            SELECT status, observation_count
            FROM traces
            WHERE trace_id = ?
            """,
            (trace.summary["trace_id"],),
        ).fetchone()
    assert row == (status, len(trace.observations))


def test_sequential_graph_round_trip_preserves_node_payloads(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_sequential_graph(),
        name="runtime-sequential",
    )

    result = graph.invoke(
        {"question": "실제 순서를 보여줘"},
        {"configurable": {"thread_id": "runtime-sequential-session"}},
    )

    assert result["answer"] == "완성: 초안: 실제 순서를 보여줘"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-sequential")
    assert trace.summary["status"] == "completed"
    assert trace.summary["session_id"] == "runtime-sequential-session"
    assert [item["name"] for item in trace.observations] == [
        "LangGraph",
        "draft_answer",
        "finalize_answer",
    ]
    assert all(
        item["parent_observation_id"] == trace.root["observation_id"]
        for item in trace.observations[1:]
    )

    draft_payload = _payload(
        runtime_server.endpoint,
        _named(trace, "draft_answer")[0],
    )
    assert draft_payload["input"] == {"question": "실제 순서를 보여줘"}
    assert draft_payload["output"] == {"draft": "초안: 실제 순서를 보여줘"}
    _assert_sqlite_trace(
        runtime_server.database_path,
        trace,
        status="completed",
    )


def test_parallel_sibling_intervals_overlap_without_inferred_data_edges(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_parallel_graph(),
        name="runtime-parallel",
    )

    result = graph.invoke({"question": "두 갈래로 찾아줘"})

    assert result["left_context"] == "왼쪽 자료: 두 갈래로 찾아줘"
    assert result["right_context"] == "오른쪽 자료: 두 갈래로 찾아줘"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-parallel")
    left = _named(trace, "parallel_left")[0]
    right = _named(trace, "parallel_right")[0]
    merge = _named(trace, "merge_parallel")[0]

    assert _timestamp(left["started_at"]) < _timestamp(right["ended_at"])
    assert _timestamp(right["started_at"]) < _timestamp(left["ended_at"])
    assert left["parent_observation_id"] == trace.root["observation_id"]
    assert right["parent_observation_id"] == trace.root["observation_id"]
    assert merge["parent_observation_id"] == trace.root["observation_id"]
    assert merge["parent_observation_id"] not in {
        left["observation_id"],
        right["observation_id"],
    }


def test_conditional_graph_records_only_the_selected_branch(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_conditional_graph(),
        name="runtime-conditional",
    )

    result = graph.invoke(
        {"question": "자세히 알려줘", "route": "long"},
    )

    assert result["answer"] == "긴 답: 자세히 알려줘 / 근거 포함"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-conditional")
    names = {cast(str, item["name"]) for item in trace.observations}
    assert "long_answer" in names
    assert "short_answer" not in names
    route = _named(trace, "_route_after_choice")[0]
    choose = _named(trace, "choose_route")[0]
    assert route["parent_observation_id"] == choose["observation_id"]


def test_loop_creates_distinct_observations_for_repeated_node_name(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_loop_graph(),
        name="runtime-loop",
    )

    result = graph.invoke(
        {"question": "반복을 보여줘", "attempts": 0},
    )

    assert result["attempts"] == 3
    assert result["answer"] == "세 번째 시도에 성공: 반복을 보여줘"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-loop")
    attempts = _named(trace, "retry_node")
    route_checks = _named(trace, "_continue_retry")
    assert len(attempts) == 3
    assert len(route_checks) == 3
    assert len({item["observation_id"] for item in attempts}) == 3
    assert len({item["sequence"] for item in attempts}) == 3
    assert all(item["status"] == "completed" for item in attempts)


def test_nested_runnable_lambda_uses_runtime_parent_chain(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_nested_runnable_graph(),
        name="runtime-nested",
    )

    result = graph.invoke({"question": "중첩 구조를 보여줘"})

    assert result["answer"] == "중첩 결과: 정리: 중첩 구조를 보여줘"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-nested")
    pipeline = _named(trace, "nested_pipeline")[0]
    nested_runs = _named(trace, "RunnableLambda")
    assert len(nested_runs) == 2
    prepare, finalize = nested_runs
    assert pipeline["parent_observation_id"] == trace.root["observation_id"]
    assert prepare["parent_observation_id"] == pipeline["observation_id"]
    assert finalize["parent_observation_id"] == pipeline["observation_id"]
    assert prepare["kind"] == "runnable"
    assert finalize["kind"] == "runnable"
    assert prepare["sequence"] < finalize["sequence"]


def test_failed_root_preserves_exception_and_persists_failed_trace(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_failed_root_graph(),
        name="runtime-failed-root",
    )

    with pytest.raises(RuntimeError, match="root failure: 실패를 보여줘"):
        graph.invoke({"question": "실패를 보여줘"})

    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-failed-root")
    explode = _named(trace, "explode")[0]
    assert trace.summary["status"] == "failed"
    assert trace.root["status"] == "failed"
    assert explode["status"] == "failed"
    error = _payload(runtime_server.endpoint, explode)["error"]
    assert error["message"] == "root failure: 실패를 보여줘"
    _assert_sqlite_trace(runtime_server.database_path, trace, status="failed")


def test_failed_child_and_successful_fallback_keep_root_completed(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_fallback_graph(),
        name="runtime-fallback",
    )

    result = graph.invoke({"question": "복구해줘"})

    assert result["recovered"] is True
    assert result["answer"] == "fallback answer: 복구해줘"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-fallback")
    fragile = _named(trace, "fragile_child")[0]
    fallback = _named(trace, "fallback_child")[0]
    fallback_parent = _named(trace, "RunnableWithFallbacks")[0]
    assert trace.summary["status"] == "completed"
    assert trace.root["status"] == "completed"
    assert fragile["status"] == "failed"
    assert fallback["status"] == "completed"
    assert fragile["parent_observation_id"] == fallback_parent["observation_id"]
    assert fallback["parent_observation_id"] == fallback_parent["observation_id"]
    error = _payload(runtime_server.endpoint, fragile)["error"]
    assert error["message"] == "primary failed: 복구해줘"


def test_sync_stream_preserves_chunks_and_persists_terminal_trace(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_stream_graph(),
        name="runtime-stream",
    )

    chunks = list(
        graph.stream(
            {"question": "stream을 보여줘"},
            stream_mode="updates",
        )
    )

    assert chunks == [
        {"draft_answer": {"draft": "초안: stream을 보여줘"}},
        {
            "finalize_answer": {
                "answer": "완성: 초안: stream을 보여줘",
            }
        },
    ]
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-stream")
    assert trace.summary["status"] == "completed"
    assert trace.root["status"] == "completed"
    root_payload = _payload(runtime_server.endpoint, trace.root)
    assert root_payload["input"] == {"question": "stream을 보여줘"}
    assert root_payload["output"] is not None


def test_streaming_llm_preserves_chunk_and_records_ttft(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_streaming_llm_graph(),
        name="runtime-streaming-llm",
    )

    chunks = list(
        graph.stream(
            {"messages": [HumanMessage(content="두 글자로 답해줘")]},
            stream_mode="updates",
        )
    )

    assert len(chunks) == 1
    model_chunks = chunks[0]["streaming_llm"]["messages"]
    assert len(model_chunks) == 1
    assert isinstance(model_chunks[0], AIMessageChunk)
    assert model_chunks[0].content == "깃털"
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-streaming-llm")
    llm_observations = [
        observation
        for observation in trace.observations
        if observation["kind"] == "llm"
    ]
    assert len(llm_observations) == 1
    llm = llm_observations[0]
    assert llm["name"] == "FakeListChatModel"
    assert isinstance(llm["time_to_first_token_us"], int)
    assert llm["time_to_first_token_us"] >= 0
    streaming_node = _named(trace, "streaming_llm")[0]
    assert llm["parent_observation_id"] == streaming_node["observation_id"]


async def _cancel_after_first_chunk(graph: Any) -> list[dict[str, Any]]:
    first_chunk = asyncio.Event()
    chunks: list[dict[str, Any]] = []

    async def consume() -> None:
        stream: AsyncIterator[dict[str, Any]] = graph.astream(
            {"question": "취소를 보여줘"},
            stream_mode="updates",
        )
        async for chunk in stream:
            chunks.append(chunk)
            first_chunk.set()

    task = asyncio.create_task(consume())
    await asyncio.wait_for(first_chunk.wait(), timeout=2)
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    return chunks


def test_cancelled_async_stream_persists_cancelled_terminal_trace(
    runtime_server: RuntimeServer,
) -> None:
    graph = langfeather.wrap_runnable(
        build_cancelled_stream_graph(),
        name="runtime-cancelled-stream",
    )

    chunks = asyncio.run(_cancel_after_first_chunk(graph))

    assert chunks == [
        {"first_async_step": {"first": "첫 chunk: 취소를 보여줘"}},
    ]
    assert langfeather.flush(timeout=5)
    trace = _load_trace(runtime_server.endpoint, "runtime-cancelled-stream")
    assert trace.summary["status"] == "cancelled"
    assert trace.root["status"] == "cancelled"
    assert _named(trace, "first_async_step")[0]["status"] == "completed"
    slow = _named(trace, "slow_async_step")
    assert not slow or slow[0]["status"] == "cancelled"
    _assert_sqlite_trace(
        runtime_server.database_path,
        trace,
        status="cancelled",
    )
