from __future__ import annotations

import copy
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from langfeather_server.app import create_app
from langfeather_server.database import Database


def make_envelope(
    *,
    trace_id: str = "tr_api_01",
    root_id: str = "obs_api_root",
    child_id: str = "obs_api_child",
    started_at: str = "2026-07-25T12:00:00.000000Z",
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "trace": {
            "trace_id": trace_id,
            "name": "student-graph",
            "started_at": started_at,
            "ended_at": "2026-07-25T12:00:01.500000Z",
            "duration_us": 1_500_000,
            "status": "completed",
            "input": {"question": "왜 이 노드를 다시 실행했나요?"},
            "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
            "error": None,
            "session_id": "thread-7",
            "tags": ["quickstart"],
            "metadata": {"source": "test"},
        },
        "observations": [
            {
                "observation_id": root_id,
                "trace_id": trace_id,
                "parent_observation_id": None,
                "sequence": 0,
                "name": "student-graph",
                "kind": "runnable",
                "started_at": started_at,
                "ended_at": "2026-07-25T12:00:01.500000Z",
                "duration_us": 1_500_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"question": "왜 이 노드를 다시 실행했나요?"},
                "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
                "error": None,
                "model": None,
                "usage": None,
                "metadata": {"langgraph_step": 0},
            },
            {
                "observation_id": child_id,
                "trace_id": trace_id,
                "parent_observation_id": root_id,
                "sequence": 1,
                "name": "answer",
                "kind": "chain",
                "started_at": "2026-07-25T12:00:00.100000Z",
                "ended_at": "2026-07-25T12:00:01.400000Z",
                "duration_us": 1_300_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"attempt": 2},
                "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
                "error": None,
                "model": None,
                "usage": {
                    "input_tokens": 11,
                    "output_tokens": 8,
                    "total_tokens": 19,
                    "provider": "test",
                    "raw": {},
                },
                "metadata": {"langgraph_node": "answer", "langgraph_step": 1},
            },
        ],
    }


@pytest.fixture
def api(
    tmp_path: Path,
) -> Iterator[tuple[TestClient, Path]]:
    database_path = tmp_path / "langfeather.db"
    application = create_app(database_url=f"sqlite:///{database_path}")
    with TestClient(application, base_url="http://localhost") as client:
        yield client, database_path


def test_health_reports_applied_migration(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "server_version": "0.2.0",
        "supported_schema_versions": [1],
        "database_migration_version": "0004_datasets_experiments",
    }


def test_batch_2xx_is_visible_from_a_new_database_connection(
    api: tuple[TestClient, Path],
) -> None:
    client, database_path = api

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [make_envelope()]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "trace_id": "tr_api_01",
                "status": "stored",
                "error": None,
            }
        ]
    }
    with sqlite3.connect(database_path) as connection:
        stored_name = connection.execute(
            "SELECT name FROM traces WHERE trace_id = ?",
            ("tr_api_01",),
        ).fetchone()
        observation_count = connection.execute(
            "SELECT COUNT(*) FROM observations WHERE trace_id = ?",
            ("tr_api_01",),
        ).fetchone()
    assert stored_name == ("student-graph",)
    assert observation_count == (2,)


def test_duplicate_trace_is_success_and_does_not_overwrite(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    original = make_envelope()
    changed = copy.deepcopy(original)
    changed["trace"]["name"] = "overwritten-name"
    changed["observations"][1]["output"] = {"answer": "overwritten"}

    first = client.post("/api/v1/traces/batch", json={"items": [original]})
    duplicate = client.post("/api/v1/traces/batch", json={"items": [changed]})

    assert first.json()["results"][0]["status"] == "stored"
    assert duplicate.status_code == 200
    assert duplicate.json()["results"][0]["status"] == "duplicate"
    trace = client.get("/api/v1/traces/tr_api_01").json()
    payload = client.get("/api/v1/observations/obs_api_child").json()
    assert trace["name"] == "student-graph"
    assert payload["output"] == {"answer": "조건부 edge가 loop를 만들었습니다."}


def test_invalid_envelope_does_not_poison_valid_batch_item(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    rejected = make_envelope(trace_id="tr_bad")
    rejected["schema_version"] = 2
    accepted = make_envelope(
        trace_id="tr_good",
        root_id="obs_good_root",
        child_id="obs_good_child",
    )

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [rejected, accepted]},
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["trace_id"] == "tr_bad"
    assert results[0]["status"] == "rejected"
    assert results[0]["error"]["code"] == "validation_error"
    assert results[1] == {
        "trace_id": "tr_good",
        "status": "stored",
        "error": None,
    }
    assert client.get("/api/v1/traces/tr_bad").status_code == 404
    assert client.get("/api/v1/traces/tr_good").status_code == 200


def test_observation_id_collision_rejects_only_new_trace(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    first = make_envelope()
    collision = make_envelope(
        trace_id="tr_collision",
        root_id="obs_collision_root",
        child_id="obs_api_child",
    )
    assert (
        client.post("/api/v1/traces/batch", json={"items": [first]}).json()["results"][
            0
        ]["status"]
        == "stored"
    )

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [collision]},
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["trace_id"] == "tr_collision"
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "validation_error"
    assert client.get("/api/v1/traces/tr_collision").status_code == 404


def test_list_is_latest_first_and_excludes_full_payload(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    older = make_envelope()
    newer = make_envelope(
        trace_id="tr_api_02",
        root_id="obs_api_02_root",
        child_id="obs_api_02_child",
        started_at="2026-07-25T13:00:00.000000Z",
    )
    newer["trace"]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    newer["observations"][0]["ended_at"] = "2026-07-25T13:00:01.500000Z"

    stored = client.post(
        "/api/v1/traces/batch",
        json={"items": [older, newer]},
    )
    response = client.get("/api/v1/traces")

    assert [item["status"] for item in stored.json()["results"]] == [
        "stored",
        "stored",
    ]
    assert response.status_code == 200
    body = response.json()
    assert [item["trace_id"] for item in body["items"]] == [
        "tr_api_02",
        "tr_api_01",
    ]
    assert body["next_cursor"] is None
    assert "input_preview" in body["items"][0]
    assert {"input", "output", "error", "metadata"}.isdisjoint(body["items"][0])


def test_list_filters_and_uses_an_exclusive_opaque_cursor(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    oldest = make_envelope(
        trace_id="tr_api_01",
        root_id="obs_api_01_root",
        child_id="obs_api_01_child",
        started_at="2026-07-25T12:00:00.000000Z",
    )
    oldest["trace"]["tags"] = ["policy"]
    oldest["trace"]["session_id"] = "session-filter"
    matching = make_envelope(
        trace_id="tr_api_02",
        root_id="obs_api_02_root",
        child_id="obs_api_02_child",
        started_at="2026-07-25T13:00:00.000000Z",
    )
    matching["trace"]["tags"] = ["policy", "review"]
    matching["trace"]["session_id"] = "session-filter"
    matching["trace"]["name"] = "policy-search"
    matching["observations"][0]["name"] = "policy-search"
    matching["trace"]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    matching["observations"][0]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    newest = make_envelope(
        trace_id="tr_api_03",
        root_id="obs_api_03_root",
        child_id="obs_api_03_child",
        started_at="2026-07-25T14:00:00.000000Z",
    )
    newest["trace"]["tags"] = ["other"]
    newest["trace"]["session_id"] = "session-filter"
    newest["trace"]["ended_at"] = "2026-07-25T14:00:01.500000Z"
    newest["observations"][0]["ended_at"] = "2026-07-25T14:00:01.500000Z"

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [oldest, matching, newest]},
    )
    assert [item["status"] for item in response.json()["results"]] == [
        "stored",
        "stored",
        "stored",
    ]

    first_page = client.get("/api/v1/traces?limit=1")
    assert first_page.status_code == 200
    first_body = first_page.json()
    assert [item["trace_id"] for item in first_body["items"]] == ["tr_api_03"]
    assert isinstance(first_body["next_cursor"], str)

    second_page = client.get(
        "/api/v1/traces",
        params={"limit": 1, "cursor": first_body["next_cursor"]},
    )
    assert second_page.status_code == 200
    assert [item["trace_id"] for item in second_page.json()["items"]] == ["tr_api_02"]

    filtered = client.get(
        "/api/v1/traces",
        params={
            "tag": "review",
            "session_id": "session-filter",
            "query": "policy-search",
            "from": "2026-07-25T12:30:00Z",
            "to": "2026-07-25T13:30:00Z",
        },
    )
    assert filtered.status_code == 200
    assert [item["trace_id"] for item in filtered.json()["items"]] == ["tr_api_02"]

    session_traces = client.get("/api/v1/sessions/session-filter/traces")
    assert [item["trace_id"] for item in session_traces.json()["items"]] == [
        "tr_api_03",
        "tr_api_02",
        "tr_api_01",
    ]
    middle = client.get("/api/v1/traces/tr_api_02").json()
    assert middle["previous_trace_id"] == "tr_api_01"
    assert middle["next_trace_id"] == "tr_api_03"

    invalid_cursor = client.get("/api/v1/traces?cursor=not-a-cursor")
    assert invalid_cursor.status_code == 400


def test_trace_detail_and_observation_payload_are_separate(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    stored = client.post(
        "/api/v1/traces/batch",
        json={"items": [make_envelope()]},
    )
    assert stored.json()["results"][0]["status"] == "stored"

    trace_response = client.get("/api/v1/traces/tr_api_01")
    observation_response = client.get("/api/v1/observations/obs_api_child")

    assert trace_response.status_code == 200
    trace = trace_response.json()
    assert {"input", "output", "error", "metadata"}.isdisjoint(trace)
    assert len(trace["observations"]) == 2
    assert trace["annotations"] == []
    assert trace["memo"] is None
    assert {"input", "output", "error", "usage", "metadata"}.isdisjoint(
        trace["observations"][1]
    )
    assert trace["observations"][1]["dispatch_count"] == 0
    assert trace["observations"][1]["dispatch_source_observation_id"] is None

    assert observation_response.status_code == 200
    observation = observation_response.json()
    assert observation["input"] == {"attempt": 2}
    assert observation["output"] == {"answer": "조건부 edge가 loop를 만들었습니다."}
    assert observation["error"] is None
    assert observation["usage"]["total_tokens"] == 19
    assert observation["metadata"] == {
        "langgraph_node": "answer",
        "langgraph_step": 1,
    }


def test_trace_detail_exposes_explicit_dispatch_evidence(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    envelope = make_envelope()
    root, child = envelope["observations"]
    root["metadata"]["langfeather_dispatches"] = [{"target": "answer", "index": 0}]
    child["metadata"]["langfeather_dispatch_source_observation_id"] = root[
        "observation_id"
    ]

    response = client.post("/api/v1/traces/batch", json={"items": [envelope]})

    assert response.status_code == 200
    detail = client.get("/api/v1/traces/tr_api_01").json()
    summaries = {item["observation_id"]: item for item in detail["observations"]}
    assert summaries["obs_api_root"]["dispatch_count"] == 1
    assert summaries["obs_api_child"]["dispatch_source_observation_id"] == (
        "obs_api_root"
    )


def test_delete_trace_removes_observations_annotations_and_memo(
    api: tuple[TestClient, Path],
) -> None:
    client, database_path = api
    assert (
        client.post(
            "/api/v1/traces/batch", json={"items": [make_envelope()]}
        ).status_code
        == 200
    )
    score = client.post(
        "/api/v1/scores",
        json={
            "name": "Success",
            "data_type": "boolean",
            "boolean_true_label": "Success",
            "boolean_false_label": "Failure",
        },
    ).json()
    assert (
        client.put(
            f"/api/v1/traces/tr_api_01/annotations/{score['score_config_id']}",
            json={"value": True},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/traces/tr_api_01/memo",
            json={"content": "delete me"},
        ).status_code
        == 200
    )

    deleted = client.delete(
        "/api/v1/traces/tr_api_01",
        headers={"content-type": "application/json"},
    )

    assert deleted.status_code == 204
    assert client.get("/api/v1/traces/tr_api_01").status_code == 404
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM observations").fetchone() == (
            0,
        )
        assert connection.execute("SELECT COUNT(*) FROM annotations").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM trace_memos").fetchone() == (0,)


def test_batch_requires_json_and_rejects_malformed_request_shape(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api

    wrong_content_type = client.post(
        "/api/v1/traces/batch",
        content="{}",
        headers={"content-type": "text/plain"},
    )
    invalid_shape = client.post(
        "/api/v1/traces/batch",
        json={"items": "not-a-list"},
    )

    assert wrong_content_type.status_code == 415
    assert invalid_shape.status_code == 422


def test_sqlite_safety_pragmas_are_enabled(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    application = cast(FastAPI, client.app)
    database = cast(Database, application.state.database)

    with database.engine.connect() as connection:
        journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar()
        synchronous = connection.exec_driver_sql("PRAGMA synchronous").scalar()
        foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
        busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar()

    assert journal_mode == "wal"
    assert synchronous == 2
    assert foreign_keys == 1
    assert busy_timeout == 5_000
