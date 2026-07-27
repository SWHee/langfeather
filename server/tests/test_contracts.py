from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from langfeather_server.contracts import CompletedEnvelopeContract, FeedbackContract

FIXTURE_ROOT = Path(__file__).parents[2] / "tests" / "fixtures" / "envelopes"
SCHEMA_FIXTURE = (
    Path(__file__).parents[2] / "tests" / "fixtures" / "schema" / "v1.json"
)
ENVELOPE_FIXTURES = (
    "completed.json",
    "failed.json",
    "parallel.json",
    "loop.json",
)


def load_fixture(name: str) -> dict[str, Any]:
    with (FIXTURE_ROOT / name).open(encoding="utf-8") as fixture_file:
        value: dict[str, Any] = json.load(fixture_file)
    return value


@pytest.mark.parametrize("fixture_name", ENVELOPE_FIXTURES)
def test_server_accepts_canonical_envelope_fixtures(fixture_name: str) -> None:
    raw = load_fixture(fixture_name)

    envelope = CompletedEnvelopeContract.model_validate(raw)

    assert envelope.schema_version == 1
    assert envelope.trace.trace_id == raw["trace"]["trace_id"]
    assert len(envelope.observations) == len(raw["observations"])


def test_server_accepts_feedback_before_trace_fixture() -> None:
    feedback = FeedbackContract.model_validate(
        load_fixture("feedback-before-trace.json")
    )

    assert feedback.trace_id == "tr_delayed_01"
    assert feedback.value is False


def test_server_rejects_unknown_schema_version() -> None:
    raw = load_fixture("completed.json")
    raw["schema_version"] = 2

    with pytest.raises(ValidationError, match="schema_version"):
        CompletedEnvelopeContract.model_validate(raw)


@pytest.mark.parametrize(
    ("target", "field"),
    (
        ("trace", "started_at"),
        ("observation", "ended_at"),
    ),
)
def test_server_rejects_numeric_wire_timestamps(
    target: str,
    field: str,
) -> None:
    raw = load_fixture("completed.json")
    if target == "trace":
        raw["trace"][field] = 0
    else:
        raw["observations"][0][field] = 0

    with pytest.raises(ValidationError, match="ISO 8601 string"):
        CompletedEnvelopeContract.model_validate(raw)


def test_server_rejects_numeric_feedback_timestamp() -> None:
    raw = load_fixture("feedback-before-trace.json")
    raw["created_at"] = 0

    with pytest.raises(ValidationError, match="ISO 8601 string"):
        FeedbackContract.model_validate(raw)


def test_server_rejects_parent_cycle() -> None:
    raw = load_fixture("completed.json")
    root, child = raw["observations"]
    root["parent_observation_id"] = child["observation_id"]

    with pytest.raises(ValidationError, match="root observation"):
        CompletedEnvelopeContract.model_validate(raw)


def test_server_contract_schema_locks_version_one() -> None:
    schema = CompletedEnvelopeContract.model_json_schema()

    assert schema["properties"]["schema_version"]["const"] == 1


def test_generated_schema_fixture_is_current() -> None:
    with SCHEMA_FIXTURE.open(encoding="utf-8") as fixture_file:
        exported_schema: dict[str, Any] = json.load(fixture_file)

    assert exported_schema == {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "completed_envelope": CompletedEnvelopeContract.model_json_schema(),
        "feedback": FeedbackContract.model_json_schema(),
    }
