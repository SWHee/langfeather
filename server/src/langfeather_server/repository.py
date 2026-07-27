from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, cast

from pydantic import JsonValue
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from langfeather_server.api_models import (
    FeedbackPatchRequest,
    ObservationDetail,
    ObservationSummary,
    TraceDetail,
    TraceSummary,
)
from langfeather_server.contracts import (
    CompletedEnvelopeContract,
    FeedbackContract,
    ObservationContract,
    TraceContract,
    TraceStatus,
    UsageContract,
)
from langfeather_server.models import FeedbackRow, ObservationRow, TraceRow

INPUT_PREVIEW_MAX_CHARS = 240


class ObservationIdConflictError(ValueError):
    pass


class InvalidCursorError(ValueError):
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


def _feedback_row(feedback: FeedbackContract) -> FeedbackRow:
    return FeedbackRow(
        feedback_id=feedback.feedback_id,
        trace_id=feedback.trace_id,
        name=feedback.name,
        value_json=_dump_json(feedback.value),
        comment=feedback.comment,
        metadata_json=_dump_json(feedback.metadata),
        created_at=_timestamp(feedback.created_at),
        updated_at=_timestamp(feedback.updated_at),
    )


def _feedback_contract(row: FeedbackRow) -> FeedbackContract:
    raw_metadata = _load_json(row.metadata_json)
    if not isinstance(raw_metadata, dict):
        raise RuntimeError("stored feedback metadata is not an object")
    return FeedbackContract.model_validate(
        {
            "feedback_id": row.feedback_id,
            "trace_id": row.trace_id,
            "name": row.name,
            "value": _load_json(row.value_json),
            "comment": row.comment,
            "metadata": raw_metadata,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
    )


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
            feedback = session.scalars(
                select(FeedbackRow)
                .where(FeedbackRow.trace_id == trace_id)
                .order_by(FeedbackRow.created_at, FeedbackRow.feedback_id)
            ).all()
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
                feedback=[_feedback_contract(item) for item in feedback],
                previous_trace_id=previous_trace_id,
                next_trace_id=next_trace_id,
            )

    def create_feedback(
        self,
        feedback: FeedbackContract,
    ) -> tuple[FeedbackContract, Literal["stored", "duplicate"]]:
        with self._session_factory.begin() as session:
            existing = session.get(FeedbackRow, feedback.feedback_id)
            if existing is not None:
                return _feedback_contract(existing), "duplicate"
            session.add(_feedback_row(feedback))
        return feedback, "stored"

    def update_feedback(
        self,
        feedback_id: str,
        patch: FeedbackPatchRequest,
    ) -> FeedbackContract | None:
        with self._session_factory.begin() as session:
            row = session.get(FeedbackRow, feedback_id)
            if row is None:
                return None
            if "value" in patch.model_fields_set:
                row.value_json = _dump_json(patch.value)
            if "comment" in patch.model_fields_set:
                row.comment = patch.comment
            if "metadata" in patch.model_fields_set:
                row.metadata_json = _dump_json(patch.metadata)
            updated_at = datetime.now(timezone.utc)
            created_at = _parse_timestamp(row.created_at)
            if updated_at <= created_at:
                updated_at = created_at + timedelta(microseconds=1)
            row.updated_at = _timestamp(updated_at)
            session.flush()
            return _feedback_contract(row)

    def delete_feedback(self, feedback_id: str) -> bool:
        with self._session_factory.begin() as session:
            row = session.get(FeedbackRow, feedback_id)
            if row is None:
                return False
            session.delete(row)
        return True

    def delete_trace(self, trace_id: str) -> bool:
        with self._session_factory.begin() as session:
            trace = session.get(TraceRow, trace_id)
            if trace is None:
                return False
            session.execute(delete(FeedbackRow).where(FeedbackRow.trace_id == trace_id))
            session.delete(trace)
        return True

    def reset(self) -> None:
        with self._session_factory.begin() as session:
            session.execute(delete(FeedbackRow))
            session.execute(delete(TraceRow))

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
