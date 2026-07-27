"""Create trace and observation tables.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "traces",
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.String(length=27), nullable=False),
        sa.Column("ended_at", sa.String(length=27), nullable=False),
        sa.Column("duration_us", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=False),
        sa.Column("output_json", sa.Text(), nullable=False),
        sa.Column("error_json", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("release", sa.Text(), nullable=True),
        sa.Column("environment", sa.Text(), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("input_preview", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("trace_id"),
    )
    op.create_index("ix_traces_name", "traces", ["name"])
    op.create_index("ix_traces_started_at", "traces", ["started_at"])
    op.create_index("ix_traces_status", "traces", ["status"])
    op.create_index("ix_traces_session_id", "traces", ["session_id"])
    op.create_index("ix_traces_user_id", "traces", ["user_id"])
    op.create_index("ix_traces_release", "traces", ["release"])
    op.create_index("ix_traces_environment", "traces", ["environment"])
    op.create_index(
        "ix_traces_started_at_trace_id",
        "traces",
        [sa.text("started_at DESC"), sa.text("trace_id DESC")],
    )

    op.create_table(
        "observations",
        sa.Column("observation_id", sa.String(length=128), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("parent_observation_id", sa.String(length=128), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.String(length=27), nullable=False),
        sa.Column("ended_at", sa.String(length=27), nullable=False),
        sa.Column("duration_us", sa.BigInteger(), nullable=False),
        sa.Column("time_to_first_token_us", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=False),
        sa.Column("output_json", sa.Text(), nullable=False),
        sa.Column("error_json", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("usage_json", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["parent_observation_id"],
            ["observations.observation_id"],
            name="fk_observations_parent",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["trace_id"],
            ["traces.trace_id"],
            name="fk_observations_trace",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("observation_id"),
        sa.UniqueConstraint(
            "trace_id",
            "sequence",
            name="uq_observations_trace_sequence",
        ),
    )
    op.create_index(
        "ix_observations_trace_id",
        "observations",
        ["trace_id"],
    )
    op.create_index(
        "ix_observations_parent_observation_id",
        "observations",
        ["parent_observation_id"],
    )
    op.create_index("ix_observations_kind", "observations", ["kind"])
    op.create_index("ix_observations_status", "observations", ["status"])
    op.create_index(
        "ix_observations_started_at",
        "observations",
        ["started_at"],
    )


def downgrade() -> None:
    op.drop_table("observations")
    op.drop_table("traces")
