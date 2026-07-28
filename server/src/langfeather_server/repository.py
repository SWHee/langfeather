from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, cast
from uuid import uuid4

from pydantic import JsonValue
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from langfeather_server.api_models import (
    AnnotationPutRequest,
    AnnotationQueueCompleteRequest,
    AnnotationQueueCreateRequest,
    AnnotationQueueItemResponse,
    AnnotationQueuePatchRequest,
    AnnotationQueueResponse,
    AnnotationResponse,
    ObservationDetail,
    ObservationSummary,
    ScoreConfigResponse,
    ScoreCreateRequest,
    ScoreOptionResponse,
    ScorePatchRequest,
    TraceDetail,
    TraceMemoResponse,
    TraceSummary,
)
from langfeather_server.contracts import (
    CompletedEnvelopeContract,
    ObservationContract,
    TraceContract,
    TraceStatus,
    UsageContract,
)
from langfeather_server.models import (
    AnnotationQueueItemRow,
    AnnotationQueueRow,
    AnnotationQueueScoreRow,
    AnnotationRow,
    AnnotationSelectedOptionRow,
    ObservationRow,
    ScoreConfigRow,
    ScoreOptionRow,
    TraceMemoRow,
    TraceRow,
)

INPUT_PREVIEW_MAX_CHARS = 240


class ObservationIdConflictError(ValueError):
    pass


class InvalidCursorError(ValueError):
    pass


class ResourceNotFoundError(ValueError):
    pass


class ResourceConflictError(ValueError):
    pass


class InvalidAnnotationError(ValueError):
    pass


@dataclass(frozen=True)
class TraceListPage:
    items: list[TraceSummary]
    next_cursor: str | None


@dataclass(frozen=True)
class TraceCursor:
    started_at: str
    trace_id: str


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _dump_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _load_json(value: str) -> JsonValue:
    return cast(JsonValue, json.loads(value))


def _input_preview(value: JsonValue) -> str:
    encoded = _dump_json(value)
    if len(encoded) <= INPUT_PREVIEW_MAX_CHARS:
        return encoded
    return f"{encoded[: INPUT_PREVIEW_MAX_CHARS - 3]}..."


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4()}"


def _now_timestamp() -> str:
    return _timestamp(datetime.now(timezone.utc))


def _encode_cursor(cursor: TraceCursor) -> str:
    payload = json.dumps(
        {
            "v": 1,
            "started_at": cursor.started_at,
            "trace_id": cursor.trace_id,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(value: str) -> TraceCursor:
    try:
        padded = value + ("=" * (-len(value) % 4))
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        raw = json.loads(decoded)
    except (UnicodeEncodeError, ValueError, json.JSONDecodeError) as error:
        raise InvalidCursorError("cursor is invalid") from error

    if (
        not isinstance(raw, dict)
        or raw.get("v") != 1
        or not isinstance(raw.get("started_at"), str)
        or not isinstance(raw.get("trace_id"), str)
    ):
        raise InvalidCursorError("cursor is invalid")
    try:
        _parse_timestamp(raw["started_at"])
    except ValueError as error:
        raise InvalidCursorError("cursor is invalid") from error
    return TraceCursor(started_at=raw["started_at"], trace_id=raw["trace_id"])


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _trace_row(
    trace: TraceContract,
    observation_count: int,
) -> TraceRow:
    return TraceRow(
        trace_id=trace.trace_id,
        name=trace.name,
        started_at=_timestamp(trace.started_at),
        ended_at=_timestamp(trace.ended_at),
        duration_us=trace.duration_us,
        status=trace.status.value,
        input_json=_dump_json(trace.input),
        output_json=_dump_json(trace.output),
        error_json=_dump_json(trace.error),
        session_id=trace.session_id,
        user_id=trace.user_id,
        release=trace.release,
        environment=trace.environment,
        tags_json=_dump_json(trace.tags),
        metadata_json=_dump_json(trace.metadata),
        observation_count=observation_count,
        input_preview=_input_preview(trace.input),
    )


def _observation_row(observation: ObservationContract) -> ObservationRow:
    usage = (
        None if observation.usage is None else observation.usage.model_dump(mode="json")
    )
    return ObservationRow(
        observation_id=observation.observation_id,
        trace_id=observation.trace_id,
        parent_observation_id=observation.parent_observation_id,
        sequence=observation.sequence,
        name=observation.name,
        kind=observation.kind,
        started_at=_timestamp(observation.started_at),
        ended_at=_timestamp(observation.ended_at),
        duration_us=observation.duration_us,
        time_to_first_token_us=observation.time_to_first_token_us,
        status=observation.status.value,
        input_json=_dump_json(observation.input),
        output_json=_dump_json(observation.output),
        error_json=_dump_json(observation.error),
        model=observation.model,
        usage_json=_dump_json(usage),
        metadata_json=_dump_json(observation.metadata),
    )


def _trace_summary(row: TraceRow) -> TraceSummary:
    return TraceSummary(
        trace_id=row.trace_id,
        name=row.name,
        started_at=_parse_timestamp(row.started_at),
        ended_at=_parse_timestamp(row.ended_at),
        duration_us=row.duration_us,
        status=TraceStatus(row.status),
        session_id=row.session_id,
        user_id=row.user_id,
        release=row.release,
        environment=row.environment,
        tags=cast(list[str], _load_json(row.tags_json)),
        observation_count=row.observation_count,
        input_preview=row.input_preview,
    )


def _observation_summary(row: ObservationRow) -> ObservationSummary:
    metadata = _load_json(row.metadata_json)
    if not isinstance(metadata, dict):
        raise RuntimeError("stored observation metadata is not an object")
    dispatches = metadata.get("langfeather_dispatches")
    dispatch_count = len(dispatches) if isinstance(dispatches, list) else 0
    dispatch_source = metadata.get("langfeather_dispatch_source_observation_id")
    return ObservationSummary(
        observation_id=row.observation_id,
        trace_id=row.trace_id,
        parent_observation_id=row.parent_observation_id,
        sequence=row.sequence,
        name=row.name,
        kind=row.kind,
        started_at=_parse_timestamp(row.started_at),
        ended_at=_parse_timestamp(row.ended_at),
        duration_us=row.duration_us,
        time_to_first_token_us=row.time_to_first_token_us,
        status=TraceStatus(row.status),
        model=row.model,
        dispatch_count=dispatch_count,
        dispatch_source_observation_id=(
            dispatch_source if isinstance(dispatch_source, str) else None
        ),
    )


def _score_response(session: Session, row: ScoreConfigRow) -> ScoreConfigResponse:
    option_rows = session.scalars(
        select(ScoreOptionRow)
        .where(ScoreOptionRow.score_config_id == row.score_config_id)
        .order_by(ScoreOptionRow.position, ScoreOptionRow.score_option_id)
    ).all()
    has_annotations = (
        session.scalars(
            select(AnnotationRow.annotation_id)
            .where(AnnotationRow.score_config_id == row.score_config_id)
            .limit(1)
        ).first()
        is not None
    )
    is_used_by_queue = (
        session.scalars(
            select(AnnotationQueueScoreRow.score_config_id)
            .where(
                AnnotationQueueScoreRow.score_config_id == row.score_config_id
            )
            .limit(1)
        ).first()
        is not None
    )
    return ScoreConfigResponse(
        score_config_id=row.score_config_id,
        name=row.name,
        description=row.description,
        data_type=cast(Literal["boolean", "number", "categorical"], row.data_type),
        boolean_true_label=row.boolean_true_label,
        boolean_false_label=row.boolean_false_label,
        number_min=row.number_min,
        number_max=row.number_max,
        categorical_selection_mode=cast(
            Literal["single", "multiple"] | None,
            row.categorical_selection_mode,
        ),
        options=[
            ScoreOptionResponse(
                score_option_id=option.score_option_id,
                label=option.label,
                position=option.position,
                archived_at=(
                    None
                    if option.archived_at is None
                    else _parse_timestamp(option.archived_at)
                ),
            )
            for option in option_rows
        ],
        created_at=_parse_timestamp(row.created_at),
        updated_at=_parse_timestamp(row.updated_at),
        archived_at=(
            None if row.archived_at is None else _parse_timestamp(row.archived_at)
        ),
        has_annotations=has_annotations,
        is_used=has_annotations or is_used_by_queue,
    )


def _annotation_response(session: Session, row: AnnotationRow) -> AnnotationResponse:
    config = session.get(ScoreConfigRow, row.score_config_id)
    if config is None:
        raise RuntimeError("stored annotation score config is missing")
    if config.data_type == "boolean":
        if row.boolean_value is None:
            raise RuntimeError("stored boolean annotation has no value")
        value: bool | int | float | list[str] = row.boolean_value
    elif config.data_type == "number":
        if row.number_value is None:
            raise RuntimeError("stored number annotation has no value")
        value = row.number_value
    else:
        value = list(
            session.scalars(
                select(AnnotationSelectedOptionRow.score_option_id)
                .join(
                    ScoreOptionRow,
                    ScoreOptionRow.score_option_id
                    == AnnotationSelectedOptionRow.score_option_id,
                )
                .where(
                    AnnotationSelectedOptionRow.annotation_id == row.annotation_id
                )
                .order_by(
                    ScoreOptionRow.position,
                    AnnotationSelectedOptionRow.score_option_id,
                )
            ).all()
        )
    return AnnotationResponse(
        annotation_id=row.annotation_id,
        score_config_id=row.score_config_id,
        target_type="trace",
        target_id=row.target_id,
        trace_id=row.trace_id,
        value=value,
        created_at=_parse_timestamp(row.created_at),
        updated_at=_parse_timestamp(row.updated_at),
    )


def _memo_response(row: TraceMemoRow) -> TraceMemoResponse:
    return TraceMemoResponse(
        trace_id=row.trace_id,
        content=row.content,
        created_at=_parse_timestamp(row.created_at),
        updated_at=_parse_timestamp(row.updated_at),
    )


def _queue_item_response(
    session: Session,
    row: AnnotationQueueItemRow,
) -> AnnotationQueueItemResponse:
    trace = session.get(TraceRow, row.trace_id)
    if trace is None:
        raise RuntimeError("stored annotation queue trace is missing")
    return AnnotationQueueItemResponse(
        annotation_queue_item_id=row.annotation_queue_item_id,
        annotation_queue_id=row.annotation_queue_id,
        trace_id=row.trace_id,
        trace_name=trace.name,
        status=cast(Literal["pending", "completed"], row.status),
        created_at=_parse_timestamp(row.created_at),
        updated_at=_parse_timestamp(row.updated_at),
        completed_at=(
            None if row.completed_at is None else _parse_timestamp(row.completed_at)
        ),
    )


def _queue_response(
    session: Session,
    row: AnnotationQueueRow,
) -> AnnotationQueueResponse:
    score_ids = list(
        session.scalars(
            select(AnnotationQueueScoreRow.score_config_id)
            .where(
                AnnotationQueueScoreRow.annotation_queue_id
                == row.annotation_queue_id
            )
            .order_by(
                AnnotationQueueScoreRow.position,
                AnnotationQueueScoreRow.score_config_id,
            )
        ).all()
    )
    item_rows = session.scalars(
        select(AnnotationQueueItemRow)
        .where(
            AnnotationQueueItemRow.annotation_queue_id == row.annotation_queue_id
        )
        .order_by(
            AnnotationQueueItemRow.created_at,
            AnnotationQueueItemRow.annotation_queue_item_id,
        )
    ).all()
    return AnnotationQueueResponse(
        annotation_queue_id=row.annotation_queue_id,
        name=row.name,
        description=row.description,
        score_config_ids=score_ids,
        items=[_queue_item_response(session, item) for item in item_rows],
        created_at=_parse_timestamp(row.created_at),
        updated_at=_parse_timestamp(row.updated_at),
    )


class TraceRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def ingest(
        self,
        envelope: CompletedEnvelopeContract,
    ) -> Literal["stored", "duplicate"]:
        try:
            with self._session_factory.begin() as session:
                existing = session.get(TraceRow, envelope.trace.trace_id)
                if existing is not None:
                    return "duplicate"

                observation_ids = [
                    observation.observation_id for observation in envelope.observations
                ]
                collision = session.scalars(
                    select(ObservationRow.observation_id)
                    .where(ObservationRow.observation_id.in_(observation_ids))
                    .limit(1)
                ).first()
                if collision is not None:
                    raise ObservationIdConflictError(
                        f"observation_id already exists: {collision}"
                    )

                session.add(
                    _trace_row(
                        envelope.trace,
                        observation_count=len(envelope.observations),
                    )
                )
                # No ORM relationship is needed for query behavior, so make the
                # trace row visible to SQLite's immediate trace foreign key
                # before flushing the observation rows.
                session.flush()
                session.add_all(
                    [
                        _observation_row(observation)
                        for observation in envelope.observations
                    ]
                )
        except IntegrityError as error:
            with self._session_factory() as session:
                existing = session.get(TraceRow, envelope.trace.trace_id)
                if existing is not None:
                    return "duplicate"
            raise ObservationIdConflictError(
                "an observation_id already belongs to another trace"
            ) from error
        return "stored"

    def list_traces(
        self,
        *,
        limit: int,
        cursor: str | None = None,
        status: TraceStatus | None = None,
        from_time: datetime | None = None,
        to_time: datetime | None = None,
        tag: str | None = None,
        session_id: str | None = None,
        query: str | None = None,
    ) -> TraceListPage:
        decoded_cursor = None if cursor is None else _decode_cursor(cursor)
        conditions: list[ColumnElement[bool]] = []
        if status is not None:
            conditions.append(TraceRow.status == status.value)
        if from_time is not None:
            conditions.append(TraceRow.started_at >= _timestamp(from_time))
        if to_time is not None:
            conditions.append(TraceRow.started_at <= _timestamp(to_time))
        if tag is not None:
            tag_json = _escape_like(_dump_json(tag))
            conditions.append(TraceRow.tags_json.like(f"%{tag_json}%", escape="\\"))
        if session_id is not None:
            conditions.append(TraceRow.session_id == session_id)
        if query is not None:
            escaped_query = _escape_like(query)
            pattern = f"%{escaped_query}%"
            conditions.append(
                or_(
                    TraceRow.name.like(pattern, escape="\\"),
                    TraceRow.input_json.like(pattern, escape="\\"),
                    TraceRow.output_json.like(pattern, escape="\\"),
                )
            )
        if decoded_cursor is not None:
            conditions.append(
                or_(
                    TraceRow.started_at < decoded_cursor.started_at,
                    and_(
                        TraceRow.started_at == decoded_cursor.started_at,
                        TraceRow.trace_id < decoded_cursor.trace_id,
                    ),
                )
            )

        with self._session_factory() as session:
            rows = session.scalars(
                select(TraceRow)
                .where(*conditions)
                .order_by(TraceRow.started_at.desc(), TraceRow.trace_id.desc())
                .limit(limit + 1)
            ).all()
            page_rows = rows[:limit]
            next_cursor = None
            if len(rows) > limit:
                last_row = page_rows[-1]
                next_cursor = _encode_cursor(
                    TraceCursor(
                        started_at=last_row.started_at,
                        trace_id=last_row.trace_id,
                    )
                )
            return TraceListPage(
                items=[_trace_summary(row) for row in page_rows],
                next_cursor=next_cursor,
            )

    def get_trace(self, trace_id: str) -> TraceDetail | None:
        with self._session_factory() as session:
            trace = session.get(TraceRow, trace_id)
            if trace is None:
                return None
            observations = session.scalars(
                select(ObservationRow)
                .where(ObservationRow.trace_id == trace_id)
                .order_by(ObservationRow.sequence)
            ).all()
            annotations = session.scalars(
                select(AnnotationRow)
                .where(AnnotationRow.trace_id == trace_id)
                .order_by(AnnotationRow.created_at, AnnotationRow.annotation_id)
            ).all()
            score_configs = session.scalars(
                select(ScoreConfigRow)
                .where(
                    or_(
                        ScoreConfigRow.archived_at.is_(None),
                        ScoreConfigRow.score_config_id.in_(
                            select(AnnotationRow.score_config_id).where(
                                AnnotationRow.trace_id == trace_id
                            )
                        ),
                    )
                )
                .order_by(ScoreConfigRow.created_at, ScoreConfigRow.name)
            ).all()
            memo = session.get(TraceMemoRow, trace_id)
            previous_trace_id: str | None = None
            next_trace_id: str | None = None
            if trace.session_id is not None:
                previous_trace_id = session.scalars(
                    select(TraceRow.trace_id)
                    .where(
                        TraceRow.session_id == trace.session_id,
                        or_(
                            TraceRow.started_at < trace.started_at,
                            and_(
                                TraceRow.started_at == trace.started_at,
                                TraceRow.trace_id < trace.trace_id,
                            ),
                        ),
                    )
                    .order_by(TraceRow.started_at.desc(), TraceRow.trace_id.desc())
                    .limit(1)
                ).first()
                next_trace_id = session.scalars(
                    select(TraceRow.trace_id)
                    .where(
                        TraceRow.session_id == trace.session_id,
                        or_(
                            TraceRow.started_at > trace.started_at,
                            and_(
                                TraceRow.started_at == trace.started_at,
                                TraceRow.trace_id > trace.trace_id,
                            ),
                        ),
                    )
                    .order_by(TraceRow.started_at, TraceRow.trace_id)
                    .limit(1)
                ).first()
            summary = _trace_summary(trace)
            return TraceDetail(
                **summary.model_dump(exclude={"input_preview"}),
                observations=[
                    _observation_summary(observation) for observation in observations
                ],
                score_configs=[
                    _score_response(session, score) for score in score_configs
                ],
                annotations=[
                    _annotation_response(session, item) for item in annotations
                ],
                memo=None if memo is None else _memo_response(memo),
                previous_trace_id=previous_trace_id,
                next_trace_id=next_trace_id,
            )

    def list_scores(self, *, include_archived: bool = False) -> list[ScoreConfigResponse]:
        with self._session_factory() as session:
            statement = select(ScoreConfigRow)
            if not include_archived:
                statement = statement.where(ScoreConfigRow.archived_at.is_(None))
            rows = session.scalars(
                statement.order_by(ScoreConfigRow.created_at, ScoreConfigRow.name)
            ).all()
            return [_score_response(session, row) for row in rows]

    def create_score(self, request: ScoreCreateRequest) -> ScoreConfigResponse:
        timestamp = _now_timestamp()
        with self._session_factory.begin() as session:
            duplicate = session.scalars(
                select(ScoreConfigRow.score_config_id)
                .where(
                    ScoreConfigRow.name == request.name,
                    ScoreConfigRow.archived_at.is_(None),
                )
                .limit(1)
            ).first()
            if duplicate is not None:
                raise ResourceConflictError("an active score with this name exists")
            row = ScoreConfigRow(
                score_config_id=_new_id("sc"),
                name=request.name,
                description=request.description,
                data_type=request.data_type,
                boolean_true_label=(
                    request.boolean_true_label or "True"
                    if request.data_type == "boolean"
                    else None
                ),
                boolean_false_label=(
                    request.boolean_false_label or "False"
                    if request.data_type == "boolean"
                    else None
                ),
                number_min=request.number_min,
                number_max=request.number_max,
                categorical_selection_mode=request.categorical_selection_mode,
                created_at=timestamp,
                updated_at=timestamp,
                archived_at=None,
            )
            session.add(row)
            session.flush()
            session.add_all(
                [
                    ScoreOptionRow(
                        score_option_id=_new_id("so"),
                        score_config_id=row.score_config_id,
                        label=option.label,
                        position=position,
                        created_at=timestamp,
                        updated_at=timestamp,
                        archived_at=None,
                    )
                    for position, option in enumerate(request.options)
                ]
            )
            session.flush()
            return _score_response(session, row)

    def get_score(self, score_config_id: str) -> ScoreConfigResponse | None:
        with self._session_factory() as session:
            row = session.get(ScoreConfigRow, score_config_id)
            return None if row is None else _score_response(session, row)

    def update_score(
        self,
        score_config_id: str,
        patch: ScorePatchRequest,
    ) -> ScoreConfigResponse:
        structural_fields = {
            "boolean_true_label",
            "boolean_false_label",
            "number_min",
            "number_max",
            "categorical_selection_mode",
            "options",
        }
        with self._session_factory.begin() as session:
            row = session.get(ScoreConfigRow, score_config_id)
            if row is None:
                raise ResourceNotFoundError("Score not found")
            has_annotations = (
                session.scalars(
                    select(AnnotationRow.annotation_id)
                    .where(AnnotationRow.score_config_id == score_config_id)
                    .limit(1)
                ).first()
                is not None
            )
            queue_use = (
                session.scalars(
                    select(AnnotationQueueScoreRow.score_config_id)
                    .where(
                        AnnotationQueueScoreRow.score_config_id == score_config_id
                    )
                    .limit(1)
                ).first()
                is not None
            )
            if (has_annotations or queue_use) and structural_fields.intersection(
                patch.model_fields_set
            ):
                raise ResourceConflictError(
                    "used score structure is immutable; create a new score"
                )
            if "name" in patch.model_fields_set:
                duplicate = session.scalars(
                    select(ScoreConfigRow.score_config_id)
                    .where(
                        ScoreConfigRow.name == patch.name,
                        ScoreConfigRow.archived_at.is_(None),
                        ScoreConfigRow.score_config_id != score_config_id,
                    )
                    .limit(1)
                ).first()
                if duplicate is not None:
                    raise ResourceConflictError(
                        "an active score with this name exists"
                    )
                row.name = cast(str, patch.name)
            if "description" in patch.model_fields_set:
                row.description = patch.description

            type_fields = structural_fields.intersection(patch.model_fields_set)
            if type_fields:
                if row.data_type == "boolean":
                    incompatible = type_fields - {
                        "boolean_true_label",
                        "boolean_false_label",
                    }
                    if incompatible:
                        raise ResourceConflictError(
                            "boolean score received incompatible configuration"
                        )
                    if "boolean_true_label" in patch.model_fields_set:
                        if patch.boolean_true_label is None:
                            raise ResourceConflictError(
                                "boolean true label cannot be null"
                            )
                        row.boolean_true_label = patch.boolean_true_label
                    if "boolean_false_label" in patch.model_fields_set:
                        if patch.boolean_false_label is None:
                            raise ResourceConflictError(
                                "boolean false label cannot be null"
                            )
                        row.boolean_false_label = patch.boolean_false_label
                elif row.data_type == "number":
                    incompatible = type_fields - {"number_min", "number_max"}
                    if incompatible:
                        raise ResourceConflictError(
                            "number score received incompatible configuration"
                        )
                    if "number_min" in patch.model_fields_set:
                        row.number_min = patch.number_min
                    if "number_max" in patch.model_fields_set:
                        row.number_max = patch.number_max
                    if (
                        row.number_min is not None
                        and row.number_max is not None
                        and row.number_min > row.number_max
                    ):
                        raise ResourceConflictError(
                            "number_min cannot exceed number_max"
                        )
                else:
                    incompatible = type_fields - {
                        "categorical_selection_mode",
                        "options",
                    }
                    if incompatible:
                        raise ResourceConflictError(
                            "categorical score received incompatible configuration"
                        )
                    if "categorical_selection_mode" in patch.model_fields_set:
                        if patch.categorical_selection_mode is None:
                            raise ResourceConflictError(
                                "categorical selection mode cannot be null"
                            )
                        row.categorical_selection_mode = (
                            patch.categorical_selection_mode
                        )
                    if patch.options is not None:
                        session.execute(
                            delete(ScoreOptionRow).where(
                                ScoreOptionRow.score_config_id == score_config_id
                            )
                        )
                        timestamp = _now_timestamp()
                        session.add_all(
                            [
                                ScoreOptionRow(
                                    score_option_id=_new_id("so"),
                                    score_config_id=score_config_id,
                                    label=option.label,
                                    position=position,
                                    created_at=timestamp,
                                    updated_at=timestamp,
                                    archived_at=None,
                                )
                                for position, option in enumerate(patch.options)
                            ]
                        )
            row.updated_at = _now_timestamp()
            session.flush()
            return _score_response(session, row)

    def archive_score(self, score_config_id: str) -> ScoreConfigResponse:
        with self._session_factory.begin() as session:
            row = session.get(ScoreConfigRow, score_config_id)
            if row is None:
                raise ResourceNotFoundError("Score not found")
            if row.archived_at is None:
                timestamp = _now_timestamp()
                row.archived_at = timestamp
                row.updated_at = timestamp
            session.flush()
            return _score_response(session, row)

    def delete_score(self, score_config_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.get(ScoreConfigRow, score_config_id)
            if row is None:
                return False
            annotation = session.scalars(
                select(AnnotationRow.annotation_id)
                .where(AnnotationRow.score_config_id == score_config_id)
                .limit(1)
            ).first()
            queue_use = session.scalars(
                select(AnnotationQueueScoreRow.score_config_id)
                .where(AnnotationQueueScoreRow.score_config_id == score_config_id)
                .limit(1)
            ).first()
            if annotation is not None or queue_use is not None:
                raise ResourceConflictError("used score must be archived")
            session.delete(row)
        return True

    def _upsert_annotation_in_session(
        self,
        session: Session,
        *,
        trace_id: str,
        score_config_id: str,
        value: bool | int | float | list[str],
    ) -> AnnotationResponse:
        if session.get(TraceRow, trace_id) is None:
            raise ResourceNotFoundError("Trace not found")
        config = session.get(ScoreConfigRow, score_config_id)
        if config is None:
            raise ResourceNotFoundError("Score not found")
        if config.archived_at is not None:
            raise ResourceConflictError("Archived score cannot be annotated")

        boolean_value: bool | None = None
        number_value: float | None = None
        option_ids: list[str] = []
        if config.data_type == "boolean":
            if not isinstance(value, bool):
                raise InvalidAnnotationError("boolean score requires a boolean")
            boolean_value = value
        elif config.data_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise InvalidAnnotationError("number score requires a number")
            number_value = float(value)
            if not math.isfinite(number_value):
                raise InvalidAnnotationError("number annotation must be finite")
            if config.number_min is not None and number_value < config.number_min:
                raise InvalidAnnotationError("number annotation is below minimum")
            if config.number_max is not None and number_value > config.number_max:
                raise InvalidAnnotationError("number annotation is above maximum")
        else:
            if not isinstance(value, list) or not all(
                isinstance(item, str) for item in value
            ):
                raise InvalidAnnotationError(
                    "categorical score requires option ID list"
                )
            option_ids = value
            if len(option_ids) != len(set(option_ids)):
                raise InvalidAnnotationError("categorical options must be unique")
            if config.categorical_selection_mode == "single" and len(option_ids) != 1:
                raise InvalidAnnotationError(
                    "single categorical score requires one option"
                )
            if option_ids:
                options = session.scalars(
                    select(ScoreOptionRow).where(
                        ScoreOptionRow.score_option_id.in_(option_ids)
                    )
                ).all()
                if len(options) != len(option_ids):
                    raise InvalidAnnotationError("categorical option was not found")
                if any(
                    option.score_config_id != score_config_id
                    or option.archived_at is not None
                    for option in options
                ):
                    raise InvalidAnnotationError(
                        "categorical option is unavailable for this score"
                    )

        row = session.scalars(
            select(AnnotationRow)
            .where(
                AnnotationRow.score_config_id == score_config_id,
                AnnotationRow.target_type == "trace",
                AnnotationRow.target_id == trace_id,
            )
            .limit(1)
        ).first()
        timestamp = _now_timestamp()
        if row is None:
            row = AnnotationRow(
                annotation_id=_new_id("an"),
                score_config_id=score_config_id,
                target_type="trace",
                target_id=trace_id,
                trace_id=trace_id,
                boolean_value=boolean_value,
                number_value=number_value,
                created_at=timestamp,
                updated_at=timestamp,
            )
            session.add(row)
            session.flush()
        else:
            row.boolean_value = boolean_value
            row.number_value = number_value
            row.updated_at = timestamp
            session.execute(
                delete(AnnotationSelectedOptionRow).where(
                    AnnotationSelectedOptionRow.annotation_id == row.annotation_id
                )
            )
        session.add_all(
            [
                AnnotationSelectedOptionRow(
                    annotation_id=row.annotation_id,
                    score_option_id=option_id,
                )
                for option_id in option_ids
            ]
        )
        session.flush()
        return _annotation_response(session, row)

    def put_annotation(
        self,
        trace_id: str,
        score_config_id: str,
        request: AnnotationPutRequest,
    ) -> AnnotationResponse:
        with self._session_factory.begin() as session:
            return self._upsert_annotation_in_session(
                session,
                trace_id=trace_id,
                score_config_id=score_config_id,
                value=request.value,
            )

    def delete_annotation(self, trace_id: str, score_config_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.scalars(
                select(AnnotationRow)
                .where(
                    AnnotationRow.trace_id == trace_id,
                    AnnotationRow.score_config_id == score_config_id,
                    AnnotationRow.target_type == "trace",
                    AnnotationRow.target_id == trace_id,
                )
                .limit(1)
            ).first()
            if row is None:
                return False
            session.delete(row)
        return True

    def _put_memo_in_session(
        self,
        session: Session,
        *,
        trace_id: str,
        content: str,
    ) -> TraceMemoResponse | None:
        if session.get(TraceRow, trace_id) is None:
            raise ResourceNotFoundError("Trace not found")
        row = session.get(TraceMemoRow, trace_id)
        if content == "":
            if row is not None:
                session.delete(row)
            return None
        timestamp = _now_timestamp()
        if row is None:
            row = TraceMemoRow(
                trace_id=trace_id,
                content=content,
                created_at=timestamp,
                updated_at=timestamp,
            )
            session.add(row)
        else:
            row.content = content
            row.updated_at = timestamp
        session.flush()
        return _memo_response(row)

    def put_memo(self, trace_id: str, content: str) -> TraceMemoResponse | None:
        with self._session_factory.begin() as session:
            return self._put_memo_in_session(
                session,
                trace_id=trace_id,
                content=content,
            )

    def delete_memo(self, trace_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.get(TraceMemoRow, trace_id)
            if row is None:
                return False
            session.delete(row)
        return True

    def _require_active_scores(
        self,
        session: Session,
        score_config_ids: list[str],
    ) -> None:
        for score_config_id in score_config_ids:
            row = session.get(ScoreConfigRow, score_config_id)
            if row is None:
                raise ResourceNotFoundError(f"Score not found: {score_config_id}")
            if row.archived_at is not None:
                raise ResourceConflictError(
                    f"Archived score cannot be added: {score_config_id}"
                )

    def _require_traces(self, session: Session, trace_ids: list[str]) -> None:
        for trace_id in trace_ids:
            if session.get(TraceRow, trace_id) is None:
                raise ResourceNotFoundError(f"Trace not found: {trace_id}")

    def create_annotation_queue(
        self,
        request: AnnotationQueueCreateRequest,
    ) -> AnnotationQueueResponse:
        timestamp = _now_timestamp()
        with self._session_factory.begin() as session:
            duplicate = session.scalars(
                select(AnnotationQueueRow.annotation_queue_id)
                .where(AnnotationQueueRow.name == request.name)
                .limit(1)
            ).first()
            if duplicate is not None:
                raise ResourceConflictError("an annotation queue with this name exists")
            self._require_active_scores(session, request.score_config_ids)
            self._require_traces(session, request.trace_ids)
            row = AnnotationQueueRow(
                annotation_queue_id=_new_id("aq"),
                name=request.name,
                description=request.description,
                created_at=timestamp,
                updated_at=timestamp,
            )
            session.add(row)
            session.flush()
            session.add_all(
                [
                    AnnotationQueueScoreRow(
                        annotation_queue_id=row.annotation_queue_id,
                        score_config_id=score_config_id,
                        position=position,
                    )
                    for position, score_config_id in enumerate(
                        request.score_config_ids
                    )
                ]
            )
            session.add_all(
                [
                    AnnotationQueueItemRow(
                        annotation_queue_item_id=_new_id("qi"),
                        annotation_queue_id=row.annotation_queue_id,
                        trace_id=trace_id,
                        status="pending",
                        created_at=timestamp,
                        updated_at=timestamp,
                        completed_at=None,
                    )
                    for trace_id in request.trace_ids
                ]
            )
            session.flush()
            return _queue_response(session, row)

    def list_annotation_queues(self) -> list[AnnotationQueueResponse]:
        with self._session_factory() as session:
            rows = session.scalars(
                select(AnnotationQueueRow).order_by(
                    AnnotationQueueRow.created_at,
                    AnnotationQueueRow.annotation_queue_id,
                )
            ).all()
            return [_queue_response(session, row) for row in rows]

    def get_annotation_queue(
        self,
        queue_id: str,
    ) -> AnnotationQueueResponse | None:
        with self._session_factory() as session:
            row = session.get(AnnotationQueueRow, queue_id)
            return None if row is None else _queue_response(session, row)

    def update_annotation_queue(
        self,
        queue_id: str,
        patch: AnnotationQueuePatchRequest,
    ) -> AnnotationQueueResponse:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueRow, queue_id)
            if row is None:
                raise ResourceNotFoundError("Annotation queue not found")
            if "name" in patch.model_fields_set:
                duplicate = session.scalars(
                    select(AnnotationQueueRow.annotation_queue_id)
                    .where(
                        AnnotationQueueRow.name == patch.name,
                        AnnotationQueueRow.annotation_queue_id != queue_id,
                    )
                    .limit(1)
                ).first()
                if duplicate is not None:
                    raise ResourceConflictError(
                        "an annotation queue with this name exists"
                    )
                row.name = cast(str, patch.name)
            if "description" in patch.model_fields_set:
                row.description = patch.description
            if patch.score_config_ids is not None:
                self._require_active_scores(session, patch.score_config_ids)
                session.execute(
                    delete(AnnotationQueueScoreRow).where(
                        AnnotationQueueScoreRow.annotation_queue_id == queue_id
                    )
                )
                session.add_all(
                    [
                        AnnotationQueueScoreRow(
                            annotation_queue_id=queue_id,
                            score_config_id=score_config_id,
                            position=position,
                        )
                        for position, score_config_id in enumerate(
                            patch.score_config_ids
                        )
                    ]
                )
            row.updated_at = _now_timestamp()
            session.flush()
            return _queue_response(session, row)

    def add_annotation_queue_items(
        self,
        queue_id: str,
        trace_ids: list[str],
    ) -> AnnotationQueueResponse:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueRow, queue_id)
            if row is None:
                raise ResourceNotFoundError("Annotation queue not found")
            self._require_traces(session, trace_ids)
            existing = set(
                session.scalars(
                    select(AnnotationQueueItemRow.trace_id).where(
                        AnnotationQueueItemRow.annotation_queue_id == queue_id,
                        AnnotationQueueItemRow.trace_id.in_(trace_ids),
                    )
                ).all()
            )
            timestamp = _now_timestamp()
            session.add_all(
                [
                    AnnotationQueueItemRow(
                        annotation_queue_item_id=_new_id("qi"),
                        annotation_queue_id=queue_id,
                        trace_id=trace_id,
                        status="pending",
                        created_at=timestamp,
                        updated_at=timestamp,
                        completed_at=None,
                    )
                    for trace_id in trace_ids
                    if trace_id not in existing
                ]
            )
            row.updated_at = timestamp
            session.flush()
            return _queue_response(session, row)

    def delete_annotation_queue_item(self, queue_id: str, item_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueItemRow, item_id)
            if row is None or row.annotation_queue_id != queue_id:
                return False
            session.delete(row)
        return True

    def delete_annotation_queue(self, queue_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueRow, queue_id)
            if row is None:
                return False
            session.delete(row)
        return True

    def edit_annotation_queue_item(
        self,
        queue_id: str,
        item_id: str,
    ) -> AnnotationQueueItemResponse:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueItemRow, item_id)
            if row is None or row.annotation_queue_id != queue_id:
                raise ResourceNotFoundError("Annotation queue item not found")
            if row.status != "completed":
                raise ResourceConflictError(
                    "only a completed queue item can enter edit mode"
                )
            row.status = "pending"
            row.completed_at = None
            row.updated_at = _now_timestamp()
            session.flush()
            return _queue_item_response(session, row)

    def complete_annotation_queue_item(
        self,
        queue_id: str,
        item_id: str,
        request: AnnotationQueueCompleteRequest,
    ) -> AnnotationQueueItemResponse:
        with self._session_factory.begin() as session:
            row = session.get(AnnotationQueueItemRow, item_id)
            if row is None or row.annotation_queue_id != queue_id:
                raise ResourceNotFoundError("Annotation queue item not found")
            if row.status != "pending":
                raise ResourceConflictError(
                    "completed queue item must enter edit mode before completion"
                )
            allowed_scores = set(
                session.scalars(
                    select(AnnotationQueueScoreRow.score_config_id).where(
                        AnnotationQueueScoreRow.annotation_queue_id == queue_id
                    )
                ).all()
            )
            for annotation in request.annotations:
                if annotation.score_config_id not in allowed_scores:
                    raise ResourceConflictError(
                        "completion annotation score is not assigned to this queue"
                    )
                self._upsert_annotation_in_session(
                    session,
                    trace_id=row.trace_id,
                    score_config_id=annotation.score_config_id,
                    value=annotation.value,
                )
            if "memo" in request.model_fields_set:
                self._put_memo_in_session(
                    session,
                    trace_id=row.trace_id,
                    content=request.memo or "",
                )
            timestamp = _now_timestamp()
            row.status = "completed"
            row.updated_at = timestamp
            row.completed_at = timestamp
            session.flush()
            return _queue_item_response(session, row)

    def delete_trace(self, trace_id: str) -> bool:
        with self._session_factory.begin() as session:
            trace = session.get(TraceRow, trace_id)
            if trace is None:
                return False
            session.delete(trace)
        return True

    def reset(self) -> None:
        with self._session_factory.begin() as session:
            session.execute(delete(AnnotationQueueRow))
            session.execute(delete(TraceRow))
            session.execute(delete(ScoreConfigRow))

    def get_observation(
        self,
        observation_id: str,
    ) -> ObservationDetail | None:
        with self._session_factory() as session:
            row = session.get(ObservationRow, observation_id)
            if row is None:
                return None
            summary = _observation_summary(row)
            raw_usage = _load_json(row.usage_json)
            usage = (
                None if raw_usage is None else UsageContract.model_validate(raw_usage)
            )
            raw_metadata = _load_json(row.metadata_json)
            if not isinstance(raw_metadata, dict):
                raise RuntimeError("stored observation metadata is not an object")
            return ObservationDetail(
                **summary.model_dump(),
                input=_load_json(row.input_json),
                output=_load_json(row.output_json),
                error=_load_json(row.error_json),
                usage=usage,
                metadata=raw_metadata,
            )
