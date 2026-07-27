from __future__ import annotations

import math
from datetime import datetime, timedelta
from enum import Enum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    field_validator,
    model_validator,
)

OpaqueId = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ContractName = Annotated[str, StringConstraints(min_length=1, max_length=255)]
NonNegativeInt = Annotated[int, Field(ge=0, strict=True)]
Metadata = dict[str, JsonValue]


class TraceStatus(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        populate_by_name=True,
    )


def _require_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must include the UTC timezone")
    return value


def _require_timestamp_string(value: object) -> object:
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO 8601 string")
    return value


class TracebackFrameContract(ContractModel):
    file: str
    line: NonNegativeInt
    function: str
    code: str | None = None


class ErrorContract(ContractModel):
    type_name: str = Field(alias="__type__")
    message: str | None = None
    repr: str
    traceback: list[TracebackFrameContract] = Field(default_factory=list)


class UsageContract(ContractModel):
    input_tokens: NonNegativeInt | None = None
    output_tokens: NonNegativeInt | None = None
    total_tokens: NonNegativeInt | None = None
    provider: str | None = None
    raw: Metadata = Field(default_factory=dict)


class TraceContract(ContractModel):
    trace_id: OpaqueId
    name: ContractName
    started_at: datetime
    ended_at: datetime
    duration_us: NonNegativeInt
    status: TraceStatus
    input: JsonValue = None
    output: JsonValue = None
    error: JsonValue = None
    session_id: str | None = None
    user_id: str | None = None
    release: str | None = None
    environment: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: Metadata = Field(default_factory=dict)

    _started_at_is_string = field_validator(
        "started_at",
        mode="before",
    )(_require_timestamp_string)
    _ended_at_is_string = field_validator(
        "ended_at",
        mode="before",
    )(_require_timestamp_string)
    _started_at_is_utc = field_validator("started_at")(_require_utc)
    _ended_at_is_utc = field_validator("ended_at")(_require_utc)

    @model_validator(mode="after")
    def validate_time_order(self) -> TraceContract:
        if self.ended_at < self.started_at:
            raise ValueError("ended_at must not be earlier than started_at")
        return self


class ObservationContract(ContractModel):
    observation_id: OpaqueId
    trace_id: OpaqueId
    parent_observation_id: OpaqueId | None = None
    sequence: NonNegativeInt
    name: ContractName
    kind: ContractName
    started_at: datetime
    ended_at: datetime
    duration_us: NonNegativeInt
    time_to_first_token_us: NonNegativeInt | None = None
    status: TraceStatus
    input: JsonValue = None
    output: JsonValue = None
    error: JsonValue = None
    model: str | None = None
    usage: UsageContract | None = None
    metadata: Metadata = Field(default_factory=dict)

    _started_at_is_string = field_validator(
        "started_at",
        mode="before",
    )(_require_timestamp_string)
    _ended_at_is_string = field_validator(
        "ended_at",
        mode="before",
    )(_require_timestamp_string)
    _started_at_is_utc = field_validator("started_at")(_require_utc)
    _ended_at_is_utc = field_validator("ended_at")(_require_utc)

    @model_validator(mode="after")
    def validate_time_order(self) -> ObservationContract:
        if self.ended_at < self.started_at:
            raise ValueError("ended_at must not be earlier than started_at")
        return self


class CompletedEnvelopeContract(ContractModel):
    schema_version: Literal[1]
    trace: TraceContract
    observations: list[ObservationContract]

    @model_validator(mode="after")
    def validate_observation_graph(self) -> CompletedEnvelopeContract:
        if not self.observations:
            raise ValueError("observations must contain one root observation")

        by_id: dict[str, ObservationContract] = {}
        sequences: set[int] = set()
        for observation in self.observations:
            if observation.trace_id != self.trace.trace_id:
                raise ValueError(
                    "every observation trace_id must match the envelope trace"
                )
            if observation.observation_id in by_id:
                raise ValueError("observation_id values must be unique")
            if observation.sequence in sequences:
                raise ValueError("observation sequence values must be unique")
            by_id[observation.observation_id] = observation
            sequences.add(observation.sequence)

        roots = [
            observation
            for observation in self.observations
            if observation.parent_observation_id is None
        ]
        if len(roots) != 1:
            raise ValueError(
                "observations must contain exactly one root observation"
            )
        if roots[0].status != self.trace.status:
            raise ValueError("trace status must match the root observation status")

        for observation in self.observations:
            parent_id = observation.parent_observation_id
            if parent_id is None:
                continue
            if parent_id == observation.observation_id:
                raise ValueError("observation cannot be its own parent")
            if parent_id not in by_id:
                raise ValueError("observation parent must exist in the same envelope")

        for observation in self.observations:
            visited: set[str] = set()
            current = observation
            while current.parent_observation_id is not None:
                if current.observation_id in visited:
                    raise ValueError("observation parent cycle is not allowed")
                visited.add(current.observation_id)
                current = by_id[current.parent_observation_id]
        return self


class FeedbackContract(ContractModel):
    feedback_id: OpaqueId
    trace_id: OpaqueId
    name: ContractName
    value: bool | int | float | str
    comment: str | None = None
    metadata: Metadata = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    _created_at_is_string = field_validator(
        "created_at",
        mode="before",
    )(_require_timestamp_string)
    _updated_at_is_string = field_validator(
        "updated_at",
        mode="before",
    )(_require_timestamp_string)
    _created_at_is_utc = field_validator("created_at")(_require_utc)
    _updated_at_is_utc = field_validator("updated_at")(_require_utc)

    @field_validator("value")
    @classmethod
    def validate_finite_number(cls, value: bool | int | float | str) -> object:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("feedback number must be finite")
        return value

    @model_validator(mode="after")
    def validate_time_order(self) -> FeedbackContract:
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not be earlier than created_at")
        return self
