from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TraceRow(Base):
    __tablename__ = "traces"

    trace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(27), nullable=False, index=True)
    ended_at: Mapped[str] = mapped_column(String(27), nullable=False)
    duration_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    output_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_json: Mapped[str] = mapped_column(Text, nullable=False)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    release: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    environment: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        index=True,
    )
    tags_json: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    observation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    input_preview: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_traces_started_at_trace_id",
            started_at.desc(),
            trace_id.desc(),
        ),
    )


class ObservationRow(Base):
    __tablename__ = "observations"

    observation_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    trace_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "traces.trace_id",
            name="fk_observations_trace",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    parent_observation_id: Mapped[str | None] = mapped_column(
        String(128),
        ForeignKey(
            "observations.observation_id",
            name="fk_observations_parent",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(27), nullable=False, index=True)
    ended_at: Mapped[str] = mapped_column(String(27), nullable=False)
    duration_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    time_to_first_token_us: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    output_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_json: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_json: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "trace_id",
            "sequence",
            name="uq_observations_trace_sequence",
        ),
    )


class FeedbackRow(Base):
    __tablename__ = "feedback"

    feedback_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    # Feedback can arrive before its trace, so this intentionally has no
    # database foreign key. Trace deletion removes matching rows explicitly.
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False, index=True)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)
