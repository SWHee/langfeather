from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import TypedDict, cast
from uuid import UUID

import pytest
from langchain_core.documents import Document
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from pydantic import BaseModel

from langfeather._contracts import JsonValue
from langfeather._serialization import serialize_error, to_json_value


def _qualified_type(value: object) -> str:
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


def _object(value: JsonValue) -> dict[str, JsonValue]:
    assert isinstance(value, dict)
    return value


def _array(value: JsonValue) -> list[JsonValue]:
    assert isinstance(value, list)
    return value


class StudentState(TypedDict):
    question: str
    attempts: int


def test_nested_supported_values_and_typed_dict_stay_plain_json() -> None:
    state: StudentState = {"question": "왜 실패했지?", "attempts": 2}

    serialized = to_json_value(
        {
            "state": state,
            "steps": [None, True, 3, 1.5, "done"],
        }
    )

    assert serialized == {
        "state": {"question": "왜 실패했지?", "attempts": 2},
        "steps": [None, True, 3, 1.5, "done"],
    }
    json.dumps(serialized, allow_nan=False)


class StudentPayload(BaseModel):
    question: str
    created_at: datetime


def test_pydantic_v2_uses_python_mode_and_preserves_qualified_type() -> None:
    payload = StudentPayload(
        question="상태를 보여줘",
        created_at=datetime(2026, 7, 25, 12, 30, tzinfo=timezone.utc),
    )

    serialized = to_json_value(payload)

    assert serialized == {
        "__type__": _qualified_type(payload),
        "fields": {
            "question": "상태를 보여줘",
            "created_at": {
                "__type__": "datetime.datetime",
                "value": "2026-07-25T12:30:00+00:00",
            },
        },
    }


@dataclass(slots=True)
class RetryState:
    question: str
    attempts: int


def test_dataclass_preserves_type_and_fields() -> None:
    state = RetryState(question="다시 시도해줘", attempts=3)

    assert to_json_value(state) == {
        "__type__": _qualified_type(state),
        "fields": {
            "question": "다시 시도해줘",
            "attempts": 3,
        },
    }


@pytest.mark.parametrize(
    ("value", "semantic_assertions"),
    [
        (
            Document(
                page_content="LangGraph는 상태 기반 실행을 지원한다.",
                metadata={"source": "lesson-1"},
                id="doc-1",
            ),
            {
                "page_content": "LangGraph는 상태 기반 실행을 지원한다.",
                "metadata": {"source": "lesson-1"},
                "id": "doc-1",
            },
        ),
        (
            HumanMessage(content="실패 지점을 알려줘", name="student", id="msg-1"),
            {
                "content": "실패 지점을 알려줘",
                "name": "student",
                "id": "msg-1",
                "type": "human",
            },
        ),
        (
            AIMessage(
                content="도구를 호출할게요.",
                tool_calls=[
                    {
                        "name": "lookup",
                        "args": {"query": "LangGraph"},
                        "id": "call-1",
                        "type": "tool_call",
                    }
                ],
                usage_metadata={
                    "input_tokens": 2,
                    "output_tokens": 3,
                    "total_tokens": 5,
                },
            ),
            {
                "content": "도구를 호출할게요.",
                "type": "ai",
                "usage_metadata": {
                    "input_tokens": 2,
                    "output_tokens": 3,
                    "total_tokens": 5,
                },
            },
        ),
        (
            SystemMessage(content="근거만 사용하세요."),
            {"content": "근거만 사용하세요.", "type": "system"},
        ),
        (
            ToolMessage(content="검색 결과", tool_call_id="call-1"),
            {
                "content": "검색 결과",
                "type": "tool",
                "tool_call_id": "call-1",
            },
        ),
    ],
)
def test_langchain_document_and_message_subtypes_keep_semantic_fields(
    value: object,
    semantic_assertions: dict[str, object],
) -> None:
    serialized = _object(to_json_value(value))
    fields = _object(serialized["fields"])

    assert serialized["__type__"] == _qualified_type(value)
    for key, expected in semantic_assertions.items():
        assert fields[key] == expected


def test_tuple_set_and_bytes_use_type_markers() -> None:
    serialized = _object(
        to_json_value(
            {
                "tuple": ("draft", 1),
                "set": {"left", "right"},
                "bytes": b"\x00\xff",
                "bytearray": bytearray(b"ok"),
            }
        )
    )

    assert serialized["tuple"] == {
        "__type__": "builtins.tuple",
        "items": ["draft", 1],
    }
    set_marker = _object(serialized["set"])
    assert set_marker["__type__"] == "builtins.set"
    assert set(cast(list[str], set_marker["items"])) == {"left", "right"}
    assert serialized["bytes"] == {
        "__type__": "builtins.bytes",
        "encoding": "base64",
        "value": "AP8=",
    }
    assert serialized["bytearray"] == {
        "__type__": "builtins.bytearray",
        "encoding": "base64",
        "value": "b2s=",
    }


@pytest.mark.parametrize(
    "reserved_key",
    ["__type__", "__unsupported__", "encoding", "items"],
)
def test_reserved_marker_collision_uses_dict_items(
    reserved_key: str,
) -> None:
    value = {reserved_key: "application value", "safe": True}

    assert to_json_value(value) == {
        "__type__": "builtins.dict",
        "items": [
            [reserved_key, "application value"],
            ["safe", True],
        ],
    }


def test_non_string_dict_keys_remain_distinct() -> None:
    assert to_json_value({1: "integer key", "1": "string key"}) == {
        "__type__": "builtins.dict",
        "items": [[1, "integer key"], ["1", "string key"]],
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (float("nan"), {"__type__": "builtins.float", "value": "nan"}),
        (float("inf"), {"__type__": "builtins.float", "value": "infinity"}),
        (float("-inf"), {"__type__": "builtins.float", "value": "-infinity"}),
        (
            9_007_199_254_740_992,
            {"__type__": "builtins.int", "value": "9007199254740992"},
        ),
        (
            -9_007_199_254_740_992,
            {"__type__": "builtins.int", "value": "-9007199254740992"},
        ),
    ],
)
def test_non_json_numbers_use_lossless_markers(
    value: int | float,
    expected: dict[str, str],
) -> None:
    serialized = to_json_value(value)

    assert serialized == expected
    json.dumps(serialized, allow_nan=False)


def test_finite_numbers_and_javascript_safe_integer_boundaries_are_plain() -> None:
    safe = (1 << 53) - 1

    assert to_json_value([0.0, -1.25, safe, -safe]) == [0.0, -1.25, safe, -safe]


class Stage(Enum):
    RETRY = "retry"


def test_standard_diagnostic_types_use_lossless_markers() -> None:
    identifier = UUID("01234567-89ab-cdef-0123-456789abcdef")
    naive = datetime(2026, 7, 25, 9, 15, 30)

    assert to_json_value(
        {
            "date": date(2026, 7, 25),
            "naive": naive,
            "uuid": identifier,
            "decimal": Decimal("12.50"),
            "enum": Stage.RETRY,
            "path": Path("/tmp/trace.json"),
        }
    ) == {
        "date": {"__type__": "datetime.date", "value": "2026-07-25"},
        "naive": {
            "__type__": "datetime.datetime",
            "value": "2026-07-25T09:15:30",
            "naive": True,
        },
        "uuid": {"__type__": "uuid.UUID", "value": str(identifier)},
        "decimal": {"__type__": "decimal.Decimal", "value": "12.50"},
        "enum": {"__type__": _qualified_type(Stage.RETRY), "value": "retry"},
        "path": {
            "__type__": _qualified_type(Path("/tmp/trace.json")),
            "value": "/tmp/trace.json",
        },
    }


def _captured_error() -> ValueError:
    def fail_node() -> None:
        raise ValueError("invalid state")

    try:
        fail_node()
    except ValueError as error:
        return error
    raise AssertionError("unreachable")


def test_exception_includes_traceback_without_mutating_the_original() -> None:
    error = _captured_error()
    original_traceback = error.__traceback__

    serialized = serialize_error(error)

    assert serialized["__type__"] == "builtins.ValueError"
    assert serialized["message"] == "invalid state"
    assert serialized["repr"] == "ValueError('invalid state')"
    frames = _array(serialized["traceback"])
    assert frames
    assert _object(frames[-1])["function"] == "fail_node"
    assert error.__traceback__ is original_traceback
    assert to_json_value(error) == serialized


class BrokenError(Exception):
    def __str__(self) -> str:
        raise RuntimeError("str is broken")

    def __repr__(self) -> str:
        raise RuntimeError("repr is broken")


def test_error_serialization_failure_keeps_minimum_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = BrokenError()
    monkeypatch.setattr(
        "langfeather._serialization.traceback_module.extract_tb",
        lambda _traceback: (_ for _ in ()).throw(RuntimeError("traceback is broken")),
    )

    assert serialize_error(error) == {
        "__type__": _qualified_type(error),
        "message": None,
        "repr": f"<unrepresentable {_qualified_type(error)}>",
        "traceback": [],
    }


@dataclass
class LinkedState:
    child: object = None


def test_cycles_use_the_repeated_reference_path_and_shared_values_are_not_cycles() -> None:
    mapping: dict[str, object] = {}
    mapping["parent"] = mapping
    linked = LinkedState()
    linked.child = linked
    shared = {"value": 1}

    assert to_json_value(mapping) == {
        "parent": {"__type__": "cycle", "path": "$.parent"}
    }
    assert to_json_value(linked) == {
        "__type__": _qualified_type(linked),
        "fields": {
            "child": {"__type__": "cycle", "path": "$.child"},
        },
    }
    assert to_json_value([shared, shared]) == [
        {"value": 1},
        {"value": 1},
    ]


class Unsupported:
    def __init__(self) -> None:
        self.secret = "must not traverse __dict__"

    def __repr__(self) -> str:
        return "Unsupported()"


class BrokenRepr:
    def __repr__(self) -> str:
        raise RuntimeError("repr failed")


class LongRepr:
    def __repr__(self) -> str:
        return "x" * 5_000


@pytest.mark.parametrize(
    ("value", "expected_repr"),
    [
        (Unsupported(), "Unsupported()"),
        (BrokenRepr(), None),
        (LongRepr(), None),
    ],
)
def test_unsupported_object_uses_bounded_safe_repr(
    value: object,
    expected_repr: str | None,
) -> None:
    serialized = _object(to_json_value(value))

    assert serialized["__type__"] == _qualified_type(value)
    assert serialized["__unsupported__"] is True
    assert set(serialized) == {"__type__", "__unsupported__", "repr"}
    rendered = serialized["repr"]
    assert isinstance(rendered, str)
    if expected_repr is not None:
        assert rendered == expected_repr
    elif isinstance(value, BrokenRepr):
        assert rendered == f"<unrepresentable {_qualified_type(value)}>"
    else:
        assert len(rendered) == 2_000
        assert rendered.endswith("...")


class BrokenMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("iteration failed")

    def __len__(self) -> int:
        return 1

    def __repr__(self) -> str:
        return "BrokenMapping()"


def test_adapter_failure_is_contained_as_an_unsupported_value() -> None:
    value = BrokenMapping()

    assert to_json_value(value) == {
        "__type__": _qualified_type(value),
        "__unsupported__": True,
        "repr": "BrokenMapping()",
    }


def test_deep_supported_payload_does_not_hit_python_recursion_limit() -> None:
    value: object = "leaf"
    for _ in range(2_000):
        value = [value]

    serialized = to_json_value(value)

    current = serialized
    for _ in range(2_000):
        items = _array(current)
        assert len(items) == 1
        current = items[0]
    assert current == "leaf"
