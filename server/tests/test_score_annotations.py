from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from langfeather_server.app import create_app


def make_envelope(trace_id: str = "tr_annotation_01") -> dict[str, Any]:
    return {
        "schema_version": 1,
        "trace": {
            "trace_id": trace_id,
            "name": "annotation-target",
            "started_at": "2026-07-28T10:00:00.000000Z",
            "ended_at": "2026-07-28T10:00:01.000000Z",
            "duration_us": 1_000_000,
            "status": "completed",
            "input": {"question": "Was this successful?"},
            "output": {"answer": "Maybe"},
            "error": None,
            "session_id": "annotation-session",
            "tags": ["review"],
            "metadata": {},
        },
        "observations": [
            {
                "observation_id": f"obs_{trace_id}",
                "trace_id": trace_id,
                "parent_observation_id": None,
                "sequence": 0,
                "name": "annotation-target",
                "kind": "runnable",
                "started_at": "2026-07-28T10:00:00.000000Z",
                "ended_at": "2026-07-28T10:00:01.000000Z",
                "duration_us": 1_000_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"question": "Was this successful?"},
                "output": {"answer": "Maybe"},
                "error": None,
                "model": None,
                "usage": None,
                "metadata": {},
            }
        ],
    }


@pytest.fixture
def api(tmp_path: Path) -> Iterator[TestClient]:
    application = create_app(database_url=f"sqlite:///{tmp_path / 'annotations.db'}")
    with TestClient(application, base_url="http://localhost") as client:
        response = client.post(
            "/api/v1/traces/batch",
            json={"items": [make_envelope()]},
        )
        assert response.status_code == 200
        yield client


def create_multiple_score(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/api/v1/scores",
        json={
            "name": "Failure Type",
            "description": "Observed failure categories",
            "data_type": "categorical",
            "categorical_selection_mode": "multiple",
            "options": [
                {"label": "Retrieval"},
                {"label": "Hallucination"},
            ],
        },
    )
    assert response.status_code == 201
    return cast(dict[str, Any], response.json())


def test_scores_start_empty_and_support_all_mvp_types(api: TestClient) -> None:
    assert api.get("/api/v1/scores").json() == {"items": []}

    boolean_score = api.post(
        "/api/v1/scores",
        json={
            "name": "Success",
            "description": None,
            "data_type": "boolean",
            "boolean_true_label": "Success",
            "boolean_false_label": "Failure",
        },
    )
    number_score = api.post(
        "/api/v1/scores",
        json={
            "name": "Quality",
            "description": None,
            "data_type": "number",
            "number_min": 0,
            "number_max": 1,
        },
    )
    categorical_score = create_multiple_score(api)

    assert boolean_score.status_code == 201
    assert number_score.status_code == 201
    assert categorical_score["categorical_selection_mode"] == "multiple"
    assert [item["label"] for item in categorical_score["options"]] == [
        "Retrieval",
        "Hallucination",
    ]
    assert len(api.get("/api/v1/scores").json()["items"]) == 3


def test_trace_annotations_distinguish_missing_from_empty_and_store_memo(
    api: TestClient,
) -> None:
    score = create_multiple_score(api)
    score_id = score["score_config_id"]

    before = api.get("/api/v1/traces/tr_annotation_01")
    assert before.json()["annotations"] == []
    assert before.json()["memo"] is None

    annotation = api.put(
        f"/api/v1/traces/tr_annotation_01/annotations/{score_id}",
        json={"value": []},
    )
    memo = api.put(
        "/api/v1/traces/tr_annotation_01/memo",
        json={"content": "No listed category applies."},
    )

    assert annotation.status_code == 200
    assert annotation.json()["value"] == []
    assert memo.status_code == 200
    detail = api.get("/api/v1/traces/tr_annotation_01").json()
    assert detail["annotations"][0]["score_config_id"] == score_id
    assert detail["annotations"][0]["value"] == []
    assert detail["memo"]["content"] == "No listed category applies."


def test_queue_has_fixed_scores_and_explicit_completion_state(
    api: TestClient,
) -> None:
    score = create_multiple_score(api)
    score_id = score["score_config_id"]
    queue = api.post(
        "/api/v1/annotation-queues",
        json={
            "name": "Failure review",
            "description": None,
            "score_config_ids": [score_id],
            "trace_ids": ["tr_annotation_01"],
        },
    )

    assert queue.status_code == 201
    queue_body = queue.json()
    queue_id = queue_body["annotation_queue_id"]
    item = queue_body["items"][0]
    item_id = item["annotation_queue_item_id"]
    assert queue_body["score_config_ids"] == [score_id]
    assert item["status"] == "pending"
    premature_edit = api.post(
        f"/api/v1/annotation-queues/{queue_id}/items/{item_id}/edit",
        json={},
    )
    assert premature_edit.status_code == 409

    completed = api.post(
        f"/api/v1/annotation-queues/{queue_id}/items/{item_id}/complete",
        json={
            "annotations": [{"score_config_id": score_id, "value": []}],
            "memo": "Reviewed with no matching failure type.",
        },
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None
    duplicate_completion = api.post(
        f"/api/v1/annotation-queues/{queue_id}/items/{item_id}/complete",
        json={"annotations": []},
    )
    assert duplicate_completion.status_code == 409

    editing = api.post(
        f"/api/v1/annotation-queues/{queue_id}/items/{item_id}/edit",
        json={},
    )
    assert editing.status_code == 200
    assert editing.json()["status"] == "pending"
    assert editing.json()["completed_at"] is None
    detail = api.get("/api/v1/traces/tr_annotation_01").json()
    assert detail["annotations"][0]["value"] == []
    assert detail["memo"]["content"] == "Reviewed with no matching failure type."


def test_queue_completion_does_not_require_score_values(api: TestClient) -> None:
    score = create_multiple_score(api)
    queue = api.post(
        "/api/v1/annotation-queues",
        json={
            "name": "Optional scoring",
            "description": None,
            "score_config_ids": [score["score_config_id"]],
            "trace_ids": ["tr_annotation_01"],
        },
    ).json()
    item = queue["items"][0]

    completed = api.post(
        (
            f"/api/v1/annotation-queues/{queue['annotation_queue_id']}"
            f"/items/{item['annotation_queue_item_id']}/complete"
        ),
        json={},
    )

    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"


def test_used_score_is_structurally_immutable_and_archivable(
    api: TestClient,
) -> None:
    score = create_multiple_score(api)
    score_id = score["score_config_id"]
    option_id = score["options"][0]["score_option_id"]
    assert (
        api.put(
            f"/api/v1/traces/tr_annotation_01/annotations/{score_id}",
            json={"value": [option_id]},
        ).status_code
        == 200
    )

    structural_change = api.patch(
        f"/api/v1/scores/{score_id}",
        json={"categorical_selection_mode": "single"},
    )
    renamed = api.patch(
        f"/api/v1/scores/{score_id}",
        json={"name": "Failure Category"},
    )
    archived = api.post(f"/api/v1/scores/{score_id}/archive", json={})

    assert structural_change.status_code == 409
    assert renamed.status_code == 200
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    detail = api.get("/api/v1/traces/tr_annotation_01").json()
    assert detail["score_configs"][0]["score_config_id"] == score_id
    assert detail["score_configs"][0]["archived_at"] is not None


def test_queue_membership_can_be_edited_manually(api: TestClient) -> None:
    score = create_multiple_score(api)
    second_score = api.post(
        "/api/v1/scores",
        json={
            "name": "Success",
            "data_type": "boolean",
            "boolean_true_label": "Success",
            "boolean_false_label": "Failure",
        },
    ).json()
    assert (
        api.post(
            "/api/v1/traces/batch",
            json={"items": [make_envelope("tr_annotation_02")]},
        ).status_code
        == 200
    )
    queue = api.post(
        "/api/v1/annotation-queues",
        json={
            "name": "Editable queue",
            "score_config_ids": [score["score_config_id"]],
            "trace_ids": ["tr_annotation_01"],
        },
    ).json()
    queue_id = queue["annotation_queue_id"]

    locked_score = api.patch(
        f"/api/v1/scores/{score['score_config_id']}",
        json={"categorical_selection_mode": "single"},
    )
    delete_used_score = api.delete(
        f"/api/v1/scores/{score['score_config_id']}",
        headers={"content-type": "application/json"},
    )
    assert locked_score.status_code == 409
    assert delete_used_score.status_code == 409
    assert (
        api.get(f"/api/v1/scores/{score['score_config_id']}").json()["is_used"]
        is True
    )

    patched = api.patch(
        f"/api/v1/annotation-queues/{queue_id}",
        json={
            "score_config_ids": [
                score["score_config_id"],
                second_score["score_config_id"],
            ]
        },
    )
    added = api.post(
        f"/api/v1/annotation-queues/{queue_id}/items",
        json={"trace_ids": ["tr_annotation_02"]},
    )
    second_item = next(
        item for item in added.json()["items"] if item["trace_id"] == "tr_annotation_02"
    )
    removed = api.delete(
        (
            f"/api/v1/annotation-queues/{queue_id}/items/"
            f"{second_item['annotation_queue_item_id']}"
        ),
        headers={"content-type": "application/json"},
    )

    assert patched.status_code == 200
    assert patched.json()["score_config_ids"] == [
        score["score_config_id"],
        second_score["score_config_id"],
    ]
    assert added.status_code == 200
    assert len(added.json()["items"]) == 2
    assert removed.status_code == 204
    remaining = api.get(f"/api/v1/annotation-queues/{queue_id}").json()["items"]
    assert [item["trace_id"] for item in remaining] == ["tr_annotation_01"]


def test_queue_delete_preserves_trace_data_and_trace_delete_cleans_membership(
    api: TestClient,
) -> None:
    score = create_multiple_score(api)
    score_id = score["score_config_id"]
    assert (
        api.put(
            f"/api/v1/traces/tr_annotation_01/annotations/{score_id}",
            json={"value": []},
        ).status_code
        == 200
    )
    assert (
        api.put(
            "/api/v1/traces/tr_annotation_01/memo",
            json={"content": "Keep this after queue deletion."},
        ).status_code
        == 200
    )
    queue = api.post(
        "/api/v1/annotation-queues",
        json={
            "name": "Disposable queue",
            "description": None,
            "score_config_ids": [score_id],
            "trace_ids": ["tr_annotation_01"],
        },
    ).json()

    deleted_queue = api.delete(
        f"/api/v1/annotation-queues/{queue['annotation_queue_id']}",
        headers={"content-type": "application/json"},
    )
    assert deleted_queue.status_code == 204
    detail = api.get("/api/v1/traces/tr_annotation_01").json()
    assert detail["annotations"][0]["value"] == []
    assert detail["memo"]["content"] == "Keep this after queue deletion."

    deleted_trace = api.delete(
        "/api/v1/traces/tr_annotation_01",
        headers={"content-type": "application/json"},
    )
    assert deleted_trace.status_code == 204
    assert api.get("/api/v1/annotation-queues").json() == {"items": []}
