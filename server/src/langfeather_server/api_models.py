from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from langfeather_server.contracts import (
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


ScoreDataType = Literal["boolean", "number", "categorical"]
CategoricalSelectionMode = Literal["single", "multiple"]
QueueItemStatus = Literal["pending", "completed"]
AnnotationValue = bool | int | float | list[str]


class ScoreOptionCreate(ApiModel):
    label: str = Field(min_length=1, max_length=255)


class ScoreOptionResponse(ApiModel):
    score_option_id: str
    label: str
    position: int
    archived_at: datetime | None = None


class ScoreCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    data_type: ScoreDataType
    boolean_true_label: str | None = None
    boolean_false_label: str | None = None
    number_min: float | None = None
    number_max: float | None = None
    categorical_selection_mode: CategoricalSelectionMode | None = None
    options: list[ScoreOptionCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_type_configuration(self) -> ScoreCreateRequest:
        if self.data_type == "boolean":
            if (
                self.number_min is not None
                or self.number_max is not None
                or self.categorical_selection_mode is not None
                or self.options
            ):
                raise ValueError("boolean score has incompatible configuration")
        elif self.data_type == "number":
            if (
                self.boolean_true_label is not None
                or self.boolean_false_label is not None
                or self.categorical_selection_mode is not None
                or self.options
            ):
                raise ValueError("number score has incompatible configuration")
            if self.number_min is not None and not math.isfinite(self.number_min):
                raise ValueError("number_min must be finite")
            if self.number_max is not None and not math.isfinite(self.number_max):
                raise ValueError("number_max must be finite")
            if (
                self.number_min is not None
                and self.number_max is not None
                and self.number_min > self.number_max
            ):
                raise ValueError("number_min cannot exceed number_max")
        else:
            if (
                self.boolean_true_label is not None
                or self.boolean_false_label is not None
                or self.number_min is not None
                or self.number_max is not None
            ):
                raise ValueError("categorical score has incompatible configuration")
            if self.categorical_selection_mode is None:
                raise ValueError("categorical score requires a selection mode")
            if not self.options:
                raise ValueError("categorical score requires at least one option")
            labels = [option.label for option in self.options]
            if len(labels) != len(set(labels)):
                raise ValueError("categorical option labels must be unique")
        return self


class ScorePatchRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    boolean_true_label: str | None = None
    boolean_false_label: str | None = None
    number_min: float | None = None
    number_max: float | None = None
    categorical_selection_mode: CategoricalSelectionMode | None = None
    options: list[ScoreOptionCreate] | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> ScorePatchRequest:
        if not self.model_fields_set:
            raise ValueError("score patch must include at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("score name cannot be null")
        for field_name in ("number_min", "number_max"):
            value = getattr(self, field_name)
            if value is not None and not math.isfinite(value):
                raise ValueError(f"{field_name} must be finite")
        if self.options is not None:
            labels = [option.label for option in self.options]
            if not labels or len(labels) != len(set(labels)):
                raise ValueError("categorical options must be non-empty and unique")
        return self


class ScoreConfigResponse(ApiModel):
    score_config_id: str
    name: str
    description: str | None
    data_type: ScoreDataType
    boolean_true_label: str | None
    boolean_false_label: str | None
    number_min: float | None
    number_max: float | None
    categorical_selection_mode: CategoricalSelectionMode | None
    options: list[ScoreOptionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    has_annotations: bool = False
    is_used: bool = False


class ScoreListResponse(ApiModel):
    items: list[ScoreConfigResponse]


class AnnotationPutRequest(ApiModel):
    value: AnnotationValue


class AnnotationResponse(ApiModel):
    annotation_id: str
    score_config_id: str
    target_type: Literal["trace"]
    target_id: str
    trace_id: str
    value: AnnotationValue
    created_at: datetime
    updated_at: datetime


class TraceMemoPutRequest(ApiModel):
    content: str


class TraceMemoResponse(ApiModel):
    trace_id: str
    content: str
    created_at: datetime
    updated_at: datetime


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
    score_configs: list[ScoreConfigResponse] = Field(default_factory=list)
    annotations: list[AnnotationResponse] = Field(default_factory=list)
    memo: TraceMemoResponse | None = None
    previous_trace_id: str | None = None
    next_trace_id: str | None = None


class AnnotationQueueCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    score_config_ids: list[str] = Field(default_factory=list)
    trace_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_unique_members(self) -> AnnotationQueueCreateRequest:
        if len(self.score_config_ids) != len(set(self.score_config_ids)):
            raise ValueError("queue score IDs must be unique")
        if len(self.trace_ids) != len(set(self.trace_ids)):
            raise ValueError("queue trace IDs must be unique")
        return self


class AnnotationQueuePatchRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    score_config_ids: list[str] | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> AnnotationQueuePatchRequest:
        if not self.model_fields_set:
            raise ValueError("queue patch must include at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("queue name cannot be null")
        if self.score_config_ids is not None and len(self.score_config_ids) != len(
            set(self.score_config_ids)
        ):
            raise ValueError("queue score IDs must be unique")
        return self


class AnnotationQueueAddItemsRequest(ApiModel):
    trace_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_traces(self) -> AnnotationQueueAddItemsRequest:
        if len(self.trace_ids) != len(set(self.trace_ids)):
            raise ValueError("queue trace IDs must be unique")
        return self


class AnnotationQueueItemResponse(ApiModel):
    annotation_queue_item_id: str
    annotation_queue_id: str
    trace_id: str
    trace_name: str
    status: QueueItemStatus
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class AnnotationQueueResponse(ApiModel):
    annotation_queue_id: str
    name: str
    description: str | None
    score_config_ids: list[str]
    items: list[AnnotationQueueItemResponse]
    created_at: datetime
    updated_at: datetime


class AnnotationQueueListResponse(ApiModel):
    items: list[AnnotationQueueResponse]


class QueueCompletionAnnotation(ApiModel):
    score_config_id: str
    value: AnnotationValue


class AnnotationQueueCompleteRequest(ApiModel):
    annotations: list[QueueCompletionAnnotation] = Field(default_factory=list)
    memo: str | None = None

    @model_validator(mode="after")
    def require_unique_scores(self) -> AnnotationQueueCompleteRequest:
        score_ids = [annotation.score_config_id for annotation in self.annotations]
        if len(score_ids) != len(set(score_ids)):
            raise ValueError("completion annotations must have unique scores")
        return self


class AnnotationQueueEditRequest(ApiModel):
    pass


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
