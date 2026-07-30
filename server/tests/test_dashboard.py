from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from langfeather_server.app import create_app


def make_envelope(
    *,
    trace_id: str,
    started_at: str,
    duration_us: int,
    status: str = "completed",
    name: str = "keep-dashboard",
    tags: list[str] | None = None,
    session_id: str | None = "session-keep",
    user_id: str | None = "user-keep",
    release: str | None = "release-keep",
    environment: str | None = "local-keep",
    observations: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    ended_at = started_at.replace("00.000000Z", "01.000000Z")
    root_id = f"obs_{trace_id}_root"
    items: list[dict[str, Any]] = [
        {
            "observation_id": root_id,
            "trace_id": trace_id,
            "parent_observation_id": None,
            "sequence": 0,
            "name": name,
            "kind": "runnable",
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_us": duration_us,
            "time_to_first_token_us": None,
            "status": status,
            "input": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
            "output": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
            "error": None,
            "model": None,
            "usage": None,
            "metadata": {},
        }
    ]
    for sequence, (kind, observation_name) in enumerate(observations or [], start=1):
        items.append(
            {
                "observation_id": f"obs_{trace_id}_{sequence}",
                "trace_id": trace_id,
                "parent_observation_id": root_id,
                "sequence": sequence,
                "name": observation_name,
                "kind": kind,
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_us": 1,
                "time_to_first_token_us": None,
                "status": status,
                "input": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
                "output": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
                "error": None,
                "model": None,
                "usage": None,
                "metadata": {},
            }
        )
    return {
        "schema_version": 1,
        "trace": {
            "trace_id": trace_id,
            "name": name,
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_us": duration_us,
            "status": status,
            "input": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
            "output": {"payload": "DASHBOARD_PAYLOAD_MUST_NOT_LEAK"},
            "error": None,
            "session_id": session_id,
            "user_id": user_id,
            "release": release,
            "environment": environment,
            "tags": tags or ["keep-tag"],
            "metadata": {},
        },
        "observations": items,
    }


@pytest.fixture
def api(tmp_path: Path) -> Iterator[TestClient]:
    application = create_app(database_url=f"sqlite:///{tmp_path / 'dashboard.db'}")
    with TestClient(application, base_url="http://localhost") as client:
        yield client


def _store(client: TestClient, *items: dict[str, Any]) -> None:
    response = client.post("/api/v1/traces/batch", json={"items": list(items)})
    assert response.status_code == 200
    assert [item["status"] for item in response.json()["results"]] == ["stored"] * len(
        items
    )


def test_dashboard_aggregates_terminal_traces_with_empty_buckets(
    api: TestClient,
) -> None:
    _store(
        api,
        make_envelope(
            trace_id="tr_dashboard_completed",
            started_at="2026-07-25T00:00:00.000000Z",
            duration_us=100,
            observations=[("llm", "model"), ("tool", "search")],
        ),
        make_envelope(
            trace_id="tr_dashboard_failed",
            started_at="2026-07-25T01:00:00.000000Z",
            duration_us=200,
            status="failed",
            observations=[("tool", "calculator"), ("tool", "calculator")],
        ),
        make_envelope(
            trace_id="tr_dashboard_cancelled",
            started_at="2026-07-25T03:00:00.000000Z",
            duration_us=300,
            status="cancelled",
        ),
    )

    response = api.get(
        "/api/v1/dashboard",
        params={
            "from": "2026-07-25T00:00:00Z",
            "to": "2026-07-25T04:00:00Z",
            "timezone": "UTC",
            "bucket": "hour",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["from"] == "2026-07-25T00:00:00.000000Z"
    assert body["to"] == "2026-07-25T04:00:00.000000Z"
    assert body["bucket"] == "hour"
    assert body["totals"] == {
        "trace_count": 3,
        "latency_us": {"p50": 200, "p95": 300, "p99": 300},
        "error": {"failed": 1, "total": 3, "rate": 0.333333},
        "llm_calls": 1,
        "tool_calls": 3,
    }
    assert body["available_tools"] == [
        {"name": "calculator", "count": 2},
        {"name": "search", "count": 1},
    ]
    assert [bucket["requests"] for bucket in body["buckets"]] == [
        {"completed": 1, "failed": 0, "cancelled": 0},
        {"completed": 0, "failed": 1, "cancelled": 0},
        {"completed": 0, "failed": 0, "cancelled": 0},
        {"completed": 0, "failed": 0, "cancelled": 1},
    ]
    assert body["buckets"][2]["latency_us"] == {
        "p50": None,
        "p95": None,
        "p99": None,
    }
    assert body["buckets"][2]["error"] == {
        "failed": 0,
        "total": 0,
        "rate": None,
    }
    assert body["buckets"][0]["llm_calls"] == 1
    assert body["buckets"][0]["tool_calls"] == {
        "search": 1,
        "calculator": 0,
        "__others__": 0,
    }
    assert "DASHBOARD_PAYLOAD_MUST_NOT_LEAK" not in response.text


def test_dashboard_applies_every_common_trace_filter_and_selected_tools(
    api: TestClient,
) -> None:
    _store(
        api,
        make_envelope(
            trace_id="tr_dashboard_keep",
            started_at="2026-07-25T00:00:00.000000Z",
            duration_us=100,
            observations=[("llm", "model"), ("tool", "wanted"), ("tool", "other")],
        ),
        make_envelope(
            trace_id="tr_dashboard_skip",
            started_at="2026-07-25T01:00:00.000000Z",
            duration_us=999,
            name="skip-dashboard",
            tags=["skip-tag"],
            session_id="session-skip",
            user_id="user-skip",
            release="release-skip",
            environment="prod-skip",
            observations=[("llm", "model"), ("tool", "wanted")],
        ),
    )

    response = api.get(
        "/api/v1/dashboard",
        params=[
            ("from", "2026-07-25T00:00:00Z"),
            ("to", "2026-07-26T00:00:00Z"),
            ("timezone", "UTC"),
            ("query", "keep-dashboard"),
            ("tag", "keep-tag"),
            ("session_id", "session-keep"),
            ("release", "release-keep"),
            ("environment", "local-keep"),
            ("user_id", "user-keep"),
            ("tool_name", "wanted"),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["trace_count"] == 1
    assert body["totals"]["llm_calls"] == 1
    assert body["totals"]["tool_calls"] == 2
    assert body["available_tools"] == [
        {"name": "other", "count": 1},
        {"name": "wanted", "count": 1},
    ]
    assert body["buckets"][0]["tool_calls"] == {"wanted": 1}


def test_dashboard_feedback_uses_trace_buckets_and_keeps_zero_distinct_from_null(
    api: TestClient,
) -> None:
    _store(
        api,
        make_envelope(
            trace_id="tr_dashboard_feedback_boolean",
            started_at="2026-07-25T00:00:00.000000Z",
            duration_us=10,
        ),
        make_envelope(
            trace_id="tr_dashboard_feedback_number",
            started_at="2026-07-25T01:00:00.000000Z",
            duration_us=10,
        ),
    )
    boolean = api.post(
        "/api/v1/scores",
        json={"name": "Helpful", "data_type": "boolean"},
    ).json()
    number = api.post(
        "/api/v1/scores",
        json={"name": "Quality", "data_type": "number"},
    ).json()
    categorical = api.post(
        "/api/v1/scores",
        json={
            "name": "Issue",
            "data_type": "categorical",
            "categorical_selection_mode": "multiple",
            "options": [{"label": "A"}, {"label": "B"}],
        },
    ).json()
    assert (
        api.put(
            "/api/v1/traces/tr_dashboard_feedback_boolean/annotations/"
            f"{boolean['score_config_id']}",
            json={"value": True},
        ).status_code
        == 200
    )
    assert (
        api.put(
            "/api/v1/traces/tr_dashboard_feedback_number/annotations/"
            f"{number['score_config_id']}",
            json={"value": 4},
        ).status_code
        == 200
    )
    assert (
        api.put(
            "/api/v1/traces/tr_dashboard_feedback_number/annotations/"
            f"{categorical['score_config_id']}",
            json={"value": []},
        ).status_code
        == 200
    )

    response = api.get(
        "/api/v1/dashboard",
        params=[
            ("from", "2026-07-25T00:00:00Z"),
            ("to", "2026-07-25T03:00:00Z"),
            ("timezone", "UTC"),
            ("bucket", "hour"),
            ("score_id", boolean["score_config_id"]),
            ("score_id", number["score_config_id"]),
            ("score_id", categorical["score_config_id"]),
        ],
    )

    assert response.status_code == 200
    first, second, empty = response.json()["buckets"]
    assert first["feedback"] == [
        {
            "score_config_id": boolean["score_config_id"],
            "name": "Helpful",
            "data_type": "boolean",
            "value": 1.0,
            "annotation_count": 1,
            "option_rates": [],
        },
        {
            "score_config_id": number["score_config_id"],
            "name": "Quality",
            "data_type": "number",
            "value": None,
            "annotation_count": 0,
            "option_rates": [],
        },
        {
            "score_config_id": categorical["score_config_id"],
            "name": "Issue",
            "data_type": "categorical",
            "value": None,
            "annotation_count": 0,
            "option_rates": [
                {
                    "score_option_id": categorical["options"][0]["score_option_id"],
                    "label": "A",
                    "rate": None,
                    "selection_count": 0,
                },
                {
                    "score_option_id": categorical["options"][1]["score_option_id"],
                    "label": "B",
                    "rate": None,
                    "selection_count": 0,
                },
            ],
        },
    ]
    assert second["feedback"][1]["value"] == 4.0
    assert second["feedback"][2]["annotation_count"] == 1
    assert [item["rate"] for item in second["feedback"][2]["option_rates"]] == [
        0.0,
        0.0,
    ]
    assert all(item["value"] is None for item in empty["feedback"])


def test_dashboard_validates_range_timezone_bucket_and_score_limit(
    api: TestClient,
) -> None:
    common = {"from": "2026-07-25T00:00:00Z", "to": "2026-07-26T00:00:00Z"}
    assert (
        api.get(
            "/api/v1/dashboard", params={**common, "timezone": "No/Such_Zone"}
        ).status_code
        == 422
    )
    assert (
        api.get(
            "/api/v1/dashboard", params={**common, "timezone": "UTC", "bucket": "year"}
        ).status_code
        == 422
    )
    assert (
        api.get(
            "/api/v1/dashboard",
            params={**common, "from": "2026-07-26T00:00:00Z", "timezone": "UTC"},
        ).status_code
        == 422
    )
    assert (
        api.get(
            "/api/v1/dashboard",
            params=[
                ("from", common["from"]),
                ("to", common["to"]),
                ("timezone", "UTC"),
                *(("score_id", f"score_{index}") for index in range(5)),
            ],
        ).status_code
        == 422
    )


def test_dashboard_builds_timezone_aware_daily_boundaries(api: TestClient) -> None:
    response = api.get(
        "/api/v1/dashboard",
        params={
            "from": "2026-07-23T18:00:00Z",
            "to": "2026-07-25T02:00:00Z",
            "timezone": "Asia/Seoul",
            "bucket": "day",
        },
    )

    assert response.status_code == 200
    assert [item["started_at"] for item in response.json()["buckets"]] == [
        "2026-07-23T15:00:00.000000Z",
        "2026-07-24T15:00:00.000000Z",
    ]


@pytest.mark.parametrize(
    ("to_time", "expected_bucket"),
    [
        ("2026-01-03T00:00:00Z", "hour"),
        ("2026-01-03T00:00:01Z", "day"),
        ("2026-04-01T00:00:00Z", "day"),
        ("2026-04-01T00:00:01Z", "week"),
        ("2028-01-01T00:00:00Z", "week"),
        ("2028-01-01T00:00:01Z", "month"),
    ],
)
def test_dashboard_auto_bucket_uses_documented_thresholds(
    api: TestClient,
    to_time: str,
    expected_bucket: str,
) -> None:
    response = api.get(
        "/api/v1/dashboard",
        params={
            "from": "2026-01-01T00:00:00Z",
            "to": to_time,
            "timezone": "UTC",
        },
    )

    assert response.status_code == 200
    assert response.json()["bucket"] == expected_bucket


def test_dashboard_uses_timezone_boundaries_across_dst_for_every_bucket(
    api: TestClient,
) -> None:
    base = {"from": "2026-03-08T06:30:00Z", "timezone": "America/New_York"}

    hour = api.get(
        "/api/v1/dashboard",
        params={**base, "to": "2026-03-08T09:30:00Z", "bucket": "hour"},
    ).json()
    day = api.get(
        "/api/v1/dashboard",
        params={**base, "to": "2026-03-10T05:00:00Z", "bucket": "day"},
    ).json()
    week = api.get(
        "/api/v1/dashboard",
        params={**base, "to": "2026-03-24T00:00:00Z", "bucket": "week"},
    ).json()
    month = api.get(
        "/api/v1/dashboard",
        params={**base, "to": "2026-05-02T00:00:00Z", "bucket": "month"},
    ).json()

    assert [item["started_at"] for item in hour["buckets"]] == [
        "2026-03-08T06:00:00.000000Z",
        "2026-03-08T07:00:00.000000Z",
        "2026-03-08T08:00:00.000000Z",
        "2026-03-08T09:00:00.000000Z",
    ]
    assert [item["started_at"] for item in day["buckets"]] == [
        "2026-03-08T05:00:00.000000Z",
        "2026-03-09T04:00:00.000000Z",
        "2026-03-10T04:00:00.000000Z",
    ]
    assert [item["started_at"] for item in week["buckets"]] == [
        "2026-03-02T05:00:00.000000Z",
        "2026-03-09T04:00:00.000000Z",
        "2026-03-16T04:00:00.000000Z",
        "2026-03-23T04:00:00.000000Z",
    ]
    assert [item["started_at"] for item in month["buckets"]] == [
        "2026-03-01T05:00:00.000000Z",
        "2026-04-01T04:00:00.000000Z",
        "2026-05-01T04:00:00.000000Z",
    ]


def test_dashboard_keeps_true_top_five_and_nonzero_others(api: TestClient) -> None:
    observations = [
        ("tool", name)
        for name, count in (
            ("tool-1", 6),
            ("tool-2", 5),
            ("tool-3", 4),
            ("tool-4", 3),
            ("tool-5", 2),
            ("tool-6", 1),
        )
        for _ in range(count)
    ]
    _store(
        api,
        make_envelope(
            trace_id="tr_dashboard_top_tools",
            started_at="2026-07-25T00:00:00.000000Z",
            duration_us=10,
            observations=observations,
        ),
    )

    response = api.get(
        "/api/v1/dashboard",
        params={
            "from": "2026-07-25T00:00:00Z",
            "to": "2026-07-25T01:00:00Z",
            "timezone": "UTC",
            "bucket": "hour",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["available_tools"] == [
        {"name": "tool-1", "count": 6},
        {"name": "tool-2", "count": 5},
        {"name": "tool-3", "count": 4},
        {"name": "tool-4", "count": 3},
        {"name": "tool-5", "count": 2},
        {"name": "tool-6", "count": 1},
    ]
    assert body["buckets"][0]["tool_calls"] == {
        "tool-1": 6,
        "tool-2": 5,
        "tool-3": 4,
        "tool-4": 3,
        "tool-5": 2,
        "__others__": 1,
    }

    selected = api.get(
        "/api/v1/dashboard",
        params=[
            ("from", "2026-07-25T00:00:00Z"),
            ("to", "2026-07-25T01:00:00Z"),
            ("timezone", "UTC"),
            ("bucket", "hour"),
            ("tool_name", "tool-6"),
            ("tool_name", "missing-tool"),
        ],
    )
    assert selected.status_code == 200
    assert selected.json()["buckets"][0]["tool_calls"] == {
        "tool-6": 1,
        "missing-tool": 0,
    }


def test_dashboard_categorical_rates_include_single_multiple_and_empty_denominator(
    api: TestClient,
) -> None:
    _store(
        api,
        make_envelope(
            trace_id="tr_dashboard_category_selected",
            started_at="2026-07-25T00:00:00.000000Z",
            duration_us=10,
        ),
        make_envelope(
            trace_id="tr_dashboard_category_empty",
            started_at="2026-07-25T00:30:00.000000Z",
            duration_us=10,
        ),
    )
    single = api.post(
        "/api/v1/scores",
        json={
            "name": "Single category",
            "data_type": "categorical",
            "categorical_selection_mode": "single",
            "options": [{"label": "A"}, {"label": "B"}],
        },
    ).json()
    multiple = api.post(
        "/api/v1/scores",
        json={
            "name": "Multiple category",
            "data_type": "categorical",
            "categorical_selection_mode": "multiple",
            "options": [{"label": "A"}, {"label": "B"}],
        },
    ).json()
    for score, value, trace_id in (
        (single, [single["options"][0]["score_option_id"]], "tr_dashboard_category_selected"),
        (
            multiple,
            [
                multiple["options"][0]["score_option_id"],
                multiple["options"][1]["score_option_id"],
            ],
            "tr_dashboard_category_selected",
        ),
        (multiple, [], "tr_dashboard_category_empty"),
    ):
        assert (
            api.put(
                f"/api/v1/traces/{trace_id}/annotations/{score['score_config_id']}",
                json={"value": value},
            ).status_code
            == 200
        )

    response = api.get(
        "/api/v1/dashboard",
        params=[
            ("from", "2026-07-25T00:00:00Z"),
            ("to", "2026-07-25T01:00:00Z"),
            ("timezone", "UTC"),
            ("bucket", "hour"),
            ("score_id", single["score_config_id"]),
            ("score_id", multiple["score_config_id"]),
        ],
    )

    assert response.status_code == 200
    single_feedback, multiple_feedback = response.json()["buckets"][0]["feedback"]
    assert single_feedback["annotation_count"] == 1
    assert [item["rate"] for item in single_feedback["option_rates"]] == [1.0, 0.0]
    assert multiple_feedback["annotation_count"] == 2
    assert [item["selection_count"] for item in multiple_feedback["option_rates"]] == [1, 1]
    assert [item["rate"] for item in multiple_feedback["option_rates"]] == [0.5, 0.5]


def test_dashboard_deduplicates_score_ids_but_limits_repeated_parameters(
    api: TestClient,
) -> None:
    score = api.post(
        "/api/v1/scores",
        json={"name": "Repeated selection", "data_type": "boolean"},
    ).json()
    base = [
        ("from", "2026-07-25T00:00:00Z"),
        ("to", "2026-07-25T01:00:00Z"),
        ("timezone", "UTC"),
    ]

    accepted = api.get(
        "/api/v1/dashboard",
        params=[*base, *(("score_id", score["score_config_id"]) for _ in range(4))],
    )
    rejected = api.get(
        "/api/v1/dashboard",
        params=[*base, *(("score_id", score["score_config_id"]) for _ in range(5))],
    )

    assert accepted.status_code == 200
    assert all(
        len(bucket["feedback"]) == 1 for bucket in accepted.json()["buckets"]
    )
    assert rejected.status_code == 422
