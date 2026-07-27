from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import TypeAlias, cast

JsonScalar: TypeAlias = None | bool | int | float | str
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
FeedbackValue: TypeAlias = bool | int | float | str

_JS_SAFE_INTEGER = (1 << 53) - 1


class ContractValidationError(ValueError):
    """Raised when a value does not satisfy the v1 transport contract."""


class TraceStatus(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def _fail(path: str, message: str) -> ContractValidationError:
    return ContractValidationError(f"{path}: {message}")


def _mapping(value: object, path: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise _fail(path, "expected an object")
    if not all(isinstance(key, str) for key in value):
        raise _fail(path, "object keys must be strings")
    return cast(Mapping[str, object], value)


def _required(mapping: Mapping[str, object], key: str, path: str) -> object:
    if key not in mapping:
        raise _fail(path, f"missing required field {key!r}")
    return mapping[key]


def _string(
    value: object,
    path: str,
    *,
    minimum: int = 0,
    maximum: int | None = None,
) -> str:
    if not isinstance(value, str):
        raise _fail(path, "expected a string")
    if len(value) < minimum:
        raise _fail(path, f"must contain at least {minimum} character(s)")
    if maximum is not None and len(value) > maximum:
        raise _fail(path, f"must contain at most {maximum} character(s)")
    return value


def _optional_string(value: object, path: str) -> str | None:
    if value is None:
        return None
    return _string(value, path)


def _non_negative_int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _fail(path, "expected an integer")
    if value < 0:
        raise _fail(path, "must be non-negative")
    return value


def _timestamp(value: object, path: str) -> datetime:
    raw = _string(value, path)
    normalized = f"{raw[:-1]}+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise _fail(path, "expected an ISO 8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise _fail(path, "timestamp must include the UTC timezone")
    return parsed


def _status(value: object, path: str) -> TraceStatus:
    try:
        return TraceStatus(value)
    except (TypeError, ValueError) as error:
        raise _fail(path, "expected completed, failed, or cancelled") from error


def _json_value(
    value: object,
    path: str,
    *,
    ancestors: frozenset[int] = frozenset(),
) -> JsonValue:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > _JS_SAFE_INTEGER:
            raise _fail(path, "unsafe integers must use a serialization marker")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _fail(path, "non-finite floats must use a serialization marker")
        return value

    identity = id(value)
    if identity in ancestors:
        raise _fail(path, "cycles must use a serialization marker")
    next_ancestors = ancestors | {identity}

    if isinstance(value, Mapping):
        mapping = _mapping(value, path)
        return {
            key: _json_value(item, f"{path}.{key}", ancestors=next_ancestors)
            for key, item in mapping.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [
            _json_value(item, f"{path}[{index}]", ancestors=next_ancestors)
            for index, item in enumerate(value)
        ]
    raise _fail(path, "expected a JSON-compatible value")


def _json_object(value: object, path: str) -> dict[str, JsonValue]:
    converted = _json_value(value, path)
    if not isinstance(converted, dict):
        raise _fail(path, "expected an object")
    return converted


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    type_name: str
    message: str | None
    repr: str
    traceback: tuple[dict[str, JsonValue], ...] = ()

    @classmethod
    def from_mapping(cls, value: object, path: str = "error") -> ErrorInfo:
        raw = _mapping(value, path)
        traceback_value = raw.get("traceback", [])
        if not isinstance(traceback_value, list):
            raise _fail(f"{path}.traceback", "expected an array")
        frames = tuple(
            _json_object(frame, f"{path}.traceback[{index}]")
            for index, frame in enumerate(traceback_value)
        )
        return cls(
            type_name=_string(_required(raw, "__type__", path), f"{path}.__type__"),
            message=_optional_string(raw.get("message"), f"{path}.message"),
            repr=_string(_required(raw, "repr", path), f"{path}.repr"),
            traceback=frames,
        )


@dataclass(frozen=True, slots=True)
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    provider: str | None = None
    raw: dict[str, JsonValue] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: object, path: str) -> Usage:
        raw = _mapping(value, path)

        def optional_tokens(key: str) -> int | None:
            item = raw.get(key)
            return None if item is None else _non_negative_int(item, f"{path}.{key}")

        return cls(
            input_tokens=optional_tokens("input_tokens"),
            output_tokens=optional_tokens("output_tokens"),
            total_tokens=optional_tokens("total_tokens"),
            provider=_optional_string(raw.get("provider"), f"{path}.provider"),
            raw=_json_object(raw.get("raw", {}), f"{path}.raw"),
        )


@dataclass(frozen=True, slots=True)
class Trace:
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    status: TraceStatus
    input: JsonValue = None
    output: JsonValue = None
    error: JsonValue = None
    session_id: str | None = None
    user_id: str | None = None
    release: str | None = None
    environment: str | None = None
    tags: tuple[str, ...] = ()
    metadata: dict[str, JsonValue] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: object, path: str = "trace") -> Trace:
        raw = _mapping(value, path)
        started_at = _timestamp(
            _required(raw, "started_at", path), f"{path}.started_at"
        )
        ended_at = _timestamp(_required(raw, "ended_at", path), f"{path}.ended_at")
        if ended_at < started_at:
            raise _fail(f"{path}.ended_at", "must not be earlier than started_at")

        tags_value = raw.get("tags", [])
        if not isinstance(tags_value, list):
            raise _fail(f"{path}.tags", "expected an array")
        tags = tuple(
            _string(item, f"{path}.tags[{index}]")
            for index, item in enumerate(tags_value)
        )

        return cls(
            trace_id=_string(
                _required(raw, "trace_id", path),
                f"{path}.trace_id",
                minimum=1,
                maximum=128,
            ),
            name=_string(
                _required(raw, "name", path),
                f"{path}.name",
                minimum=1,
                maximum=255,
            ),
            started_at=started_at,
            ended_at=ended_at,
            duration_us=_non_negative_int(
                _required(raw, "duration_us", path), f"{path}.duration_us"
            ),
            status=_status(_required(raw, "status", path), f"{path}.status"),
            input=_json_value(raw.get("input"), f"{path}.input"),
            output=_json_value(raw.get("output"), f"{path}.output"),
            error=_json_value(raw.get("error"), f"{path}.error"),
            session_id=_optional_string(raw.get("session_id"), f"{path}.session_id"),
            user_id=_optional_string(raw.get("user_id"), f"{path}.user_id"),
            release=_optional_string(raw.get("release"), f"{path}.release"),
            environment=_optional_string(
                raw.get("environment"), f"{path}.environment"
            ),
            tags=tags,
            metadata=_json_object(raw.get("metadata", {}), f"{path}.metadata"),
        )


@dataclass(frozen=True, slots=True)
class Observation:
    observation_id: str
    trace_id: str
    parent_observation_id: str | None
    sequence: int
    name: str
    kind: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    time_to_first_token_us: int | None
    status: TraceStatus
    input: JsonValue = None
    output: JsonValue = None
    error: JsonValue = None
    model: str | None = None
    usage: Usage | None = None
    metadata: dict[str, JsonValue] = field(default_factory=dict)

    @classmethod
    def from_mapping(
        cls, value: object, path: str = "observation"
    ) -> Observation:
        raw = _mapping(value, path)
        started_at = _timestamp(
            _required(raw, "started_at", path), f"{path}.started_at"
        )
        ended_at = _timestamp(_required(raw, "ended_at", path), f"{path}.ended_at")
        if ended_at < started_at:
            raise _fail(f"{path}.ended_at", "must not be earlier than started_at")
        ttft_value = raw.get("time_to_first_token_us")
        usage_value = raw.get("usage")

        return cls(
            observation_id=_string(
                _required(raw, "observation_id", path),
                f"{path}.observation_id",
                minimum=1,
                maximum=128,
            ),
            trace_id=_string(
                _required(raw, "trace_id", path),
                f"{path}.trace_id",
                minimum=1,
                maximum=128,
            ),
            parent_observation_id=_optional_string(
                raw.get("parent_observation_id"),
                f"{path}.parent_observation_id",
            ),
            sequence=_non_negative_int(
                _required(raw, "sequence", path), f"{path}.sequence"
            ),
            name=_string(
                _required(raw, "name", path),
                f"{path}.name",
                minimum=1,
                maximum=255,
            ),
            kind=_string(
                _required(raw, "kind", path),
                f"{path}.kind",
                minimum=1,
                maximum=255,
            ),
            started_at=started_at,
            ended_at=ended_at,
            duration_us=_non_negative_int(
                _required(raw, "duration_us", path), f"{path}.duration_us"
            ),
            time_to_first_token_us=(
                None
                if ttft_value is None
                else _non_negative_int(ttft_value, f"{path}.time_to_first_token_us")
            ),
            status=_status(_required(raw, "status", path), f"{path}.status"),
            input=_json_value(raw.get("input"), f"{path}.input"),
            output=_json_value(raw.get("output"), f"{path}.output"),
            error=_json_value(raw.get("error"), f"{path}.error"),
            model=_optional_string(raw.get("model"), f"{path}.model"),
            usage=(
                None if usage_value is None else Usage.from_mapping(usage_value, path)
            ),
            metadata=_json_object(raw.get("metadata", {}), f"{path}.metadata"),
        )


@dataclass(frozen=True, slots=True)
class CompletedEnvelope:
    schema_version: int
    trace: Trace
    observations: tuple[Observation, ...]

    @classmethod
    def from_mapping(
        cls, value: object, path: str = "envelope"
    ) -> CompletedEnvelope:
        raw = _mapping(value, path)
        schema_version = _required(raw, "schema_version", path)
        if isinstance(schema_version, bool) or schema_version != 1:
            raise _fail(f"{path}.schema_version", "only schema version 1 is supported")
        trace = Trace.from_mapping(_required(raw, "trace", path))

        observations_value = _required(raw, "observations", path)
        if not isinstance(observations_value, list):
            raise _fail(f"{path}.observations", "expected an array")
        observations = tuple(
            Observation.from_mapping(item, f"{path}.observations[{index}]")
            for index, item in enumerate(observations_value)
        )
        _validate_observation_graph(trace, observations, path)
        return cls(schema_version=1, trace=trace, observations=observations)


def _validate_observation_graph(
    trace: Trace,
    observations: tuple[Observation, ...],
    path: str,
) -> None:
    if not observations:
        raise _fail(f"{path}.observations", "must contain one root observation")

    by_id: dict[str, Observation] = {}
    sequences: set[int] = set()
    for observation in observations:
        if observation.trace_id != trace.trace_id:
            raise _fail(
                f"{path}.observations",
                "every observation trace_id must match the envelope trace",
            )
        if observation.observation_id in by_id:
            raise _fail(
                f"{path}.observations", "observation_id values must be unique"
            )
        if observation.sequence in sequences:
            raise _fail(f"{path}.observations", "sequence values must be unique")
        by_id[observation.observation_id] = observation
        sequences.add(observation.sequence)

    roots = [
        observation
        for observation in observations
        if observation.parent_observation_id is None
    ]
    if len(roots) != 1:
        raise _fail(
            f"{path}.observations", "must contain exactly one root observation"
        )
    if roots[0].status is not trace.status:
        raise _fail(
            f"{path}.trace.status", "must match the root observation status"
        )

    for observation in observations:
        parent_id = observation.parent_observation_id
        if parent_id is None:
            continue
        if parent_id == observation.observation_id:
            raise _fail(f"{path}.observations", "self-parent is not allowed")
        if parent_id not in by_id:
            raise _fail(
                f"{path}.observations", "parent must exist in the same envelope"
            )

    for observation in observations:
        visited: set[str] = set()
        current = observation
        while current.parent_observation_id is not None:
            if current.observation_id in visited:
                raise _fail(f"{path}.observations", "parent cycle is not allowed")
            visited.add(current.observation_id)
            current = by_id[current.parent_observation_id]


@dataclass(frozen=True, slots=True)
class Feedback:
    feedback_id: str
    trace_id: str
    name: str
    value: FeedbackValue
    comment: str | None
    metadata: dict[str, JsonValue]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_mapping(cls, value: object, path: str = "feedback") -> Feedback:
        raw = _mapping(value, path)
        feedback_value = _required(raw, "value", path)
        if not isinstance(feedback_value, (bool, int, float, str)):
            raise _fail(f"{path}.value", "expected a boolean, number, or string")
        if isinstance(feedback_value, float) and not math.isfinite(feedback_value):
            raise _fail(f"{path}.value", "number must be finite")

        created_at = _timestamp(
            _required(raw, "created_at", path), f"{path}.created_at"
        )
        updated_at = _timestamp(
            _required(raw, "updated_at", path), f"{path}.updated_at"
        )
        if updated_at < created_at:
            raise _fail(f"{path}.updated_at", "must not be earlier than created_at")

        return cls(
            feedback_id=_string(
                _required(raw, "feedback_id", path),
                f"{path}.feedback_id",
                minimum=1,
                maximum=128,
            ),
            trace_id=_string(
                _required(raw, "trace_id", path),
                f"{path}.trace_id",
                minimum=1,
                maximum=128,
            ),
            name=_string(
                _required(raw, "name", path),
                f"{path}.name",
                minimum=1,
                maximum=255,
            ),
            value=feedback_value,
            comment=_optional_string(raw.get("comment"), f"{path}.comment"),
            metadata=_json_object(raw.get("metadata", {}), f"{path}.metadata"),
            created_at=created_at,
            updated_at=updated_at,
        )
