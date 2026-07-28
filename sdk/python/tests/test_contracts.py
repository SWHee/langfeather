from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from langfeather._contracts import (
    CompletedEnvelope,
    ContractValidationError,
)

FIXTURE_ROOT = Path(__file__).parents[3] / "tests" / "fixtures" / "envelopes"
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
def test_sdk_accepts_canonical_envelope_fixtures(fixture_name: str) -> None:
    raw = load_fixture(fixture_name)

    envelope = CompletedEnvelope.from_mapping(raw)

    assert envelope.schema_version == 1
    assert envelope.trace.trace_id == raw["trace"]["trace_id"]
    assert len(envelope.observations) == len(raw["observations"])


def test_sdk_rejects_unknown_schema_version() -> None:
    raw = load_fixture("completed.json")
    raw["schema_version"] = 2

    with pytest.raises(ContractValidationError, match="schema_version"):
        CompletedEnvelope.from_mapping(raw)


def test_sdk_rejects_duplicate_observation_sequence() -> None:
    raw = load_fixture("completed.json")
    raw["observations"][1]["sequence"] = 0

    with pytest.raises(ContractValidationError, match="sequence"):
        CompletedEnvelope.from_mapping(raw)
