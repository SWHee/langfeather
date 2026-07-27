from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from langfeather_server.contracts import (
    FeedbackContract,
    TraceStatus,
    UsageContract,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BatchIngestRequest(ApiModel):
    items: list[JsonValue]


class BatchItemError(ApiModel):
    code: Literal["validation_error"]
    message: str


class BatchItemResult(ApiModel):
    trace_id: str | None
    status: Literal["stored", "duplicate", "rejected"]
    error: BatchItemError | None = None


class BatchIngestResponse(ApiModel):
    results: list[BatchItemResult]


class TraceSummary(ApiModel):
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    status: TraceStatus
    session_id: str | None
    user_id: str | None
    release: str | None
    environment: str | None
    tags: list[str]
    observation_count: int
    input_preview: str


class TraceListResponse(ApiModel):
    items: list[TraceSummary]
    next_cursor: str | None = None


class ObservationSummary(ApiModel):
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
    model: str | None
    dispatch_count: int = 0
    dispatch_source_observation_id: str | None = None


class TraceDetail(ApiModel):
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    status: TraceStatus
    session_id: str | None
    user_id: str | None
    release: str | None
    environment: str | None
    tags: list[str]
    observation_count: int
    observations: list[ObservationSummary]
    feedback: list[FeedbackContract] = Field(default_factory=list)
    previous_trace_id: str | None = None
    next_trace_id: str | None = None


class FeedbackPatchRequest(ApiModel):
    value: bool | int | float | str | None = None
    comment: str | None = None
    metadata: dict[str, JsonValue] | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> FeedbackPatchRequest:
        if not self.model_fields_set:
            raise ValueError("feedback patch must include at least one field")
        if "value" in self.model_fields_set and self.value is None:
            raise ValueError("feedback value cannot be null")
        return self


class ObservationDetail(ObservationSummary):
    input: JsonValue
    output: JsonValue
    error: JsonValue
    usage: UsageContract | None
    metadata: dict[str, JsonValue]


class HealthResponse(ApiModel):
    status: Literal["ok"]
    server_version: str
    supported_schema_versions: list[int]
    database_migration_version: str | None


class ResetRequest(ApiModel):
    confirmation: Literal["RESET"]
