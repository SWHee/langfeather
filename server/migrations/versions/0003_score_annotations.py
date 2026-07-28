"""Replace feedback with score annotations and fixed review queues.

Revision ID: 0003_score_annotations
Revises: 0002_feedback
Create Date: 2026-07-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_score_annotations"
down_revision: str | None = "0002_feedback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_feedback_created_at", table_name="feedback")
    op.drop_index("ix_feedback_trace_id", table_name="feedback")
    op.drop_table("feedback")

    op.create_table(
        "score_configs",
        sa.Column("score_config_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("data_type", sa.String(length=32), nullable=False),
        sa.Column("boolean_true_label", sa.Text(), nullable=True),
        sa.Column("boolean_false_label", sa.Text(), nullable=True),
        sa.Column("number_min", sa.Float(), nullable=True),
        sa.Column("number_max", sa.Float(), nullable=True),
        sa.Column(
            "categorical_selection_mode",
            sa.String(length=16),
            nullable=True,
        ),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.Column("archived_at", sa.String(length=27), nullable=True),
        sa.PrimaryKeyConstraint("score_config_id"),
    )
    op.create_index("ix_score_configs_name", "score_configs", ["name"])

    op.create_table(
        "score_options",
        sa.Column("score_option_id", sa.String(length=128), nullable=False),
        sa.Column("score_config_id", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.Column("archived_at", sa.String(length=27), nullable=True),
        sa.ForeignKeyConstraint(
            ["score_config_id"],
            ["score_configs.score_config_id"],
            name="fk_score_options_config",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("score_option_id"),
        sa.UniqueConstraint(
            "score_config_id",
            "position",
            name="uq_score_options_config_position",
        ),
    )
    op.create_index(
        "ix_score_options_score_config_id",
        "score_options",
        ["score_config_id"],
    )

    op.create_table(
        "annotations",
        sa.Column("annotation_id", sa.String(length=128), nullable=False),
        sa.Column("score_config_id", sa.String(length=128), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("boolean_value", sa.Boolean(), nullable=True),
        sa.Column("number_value", sa.Float(), nullable=True),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.ForeignKeyConstraint(
            ["score_config_id"],
            ["score_configs.score_config_id"],
            name="fk_annotations_score_config",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["trace_id"],
            ["traces.trace_id"],
            name="fk_annotations_trace",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("annotation_id"),
        sa.UniqueConstraint(
            "score_config_id",
            "target_type",
            "target_id",
            name="uq_annotations_score_target",
        ),
    )
    op.create_index(
        "ix_annotations_score_config_id",
        "annotations",
        ["score_config_id"],
    )
    op.create_index("ix_annotations_trace_id", "annotations", ["trace_id"])

    op.create_table(
        "annotation_selected_options",
        sa.Column("annotation_id", sa.String(length=128), nullable=False),
        sa.Column("score_option_id", sa.String(length=128), nullable=False),
        sa.ForeignKeyConstraint(
            ["annotation_id"],
            ["annotations.annotation_id"],
            name="fk_annotation_options_annotation",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["score_option_id"],
            ["score_options.score_option_id"],
            name="fk_annotation_options_option",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("annotation_id", "score_option_id"),
    )

    op.create_table(
        "trace_memos",
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.ForeignKeyConstraint(
            ["trace_id"],
            ["traces.trace_id"],
            name="fk_trace_memos_trace",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("trace_id"),
    )

    op.create_table(
        "annotation_queues",
        sa.Column("annotation_queue_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.PrimaryKeyConstraint("annotation_queue_id"),
    )
    op.create_index("ix_annotation_queues_name", "annotation_queues", ["name"])

    op.create_table(
        "annotation_queue_scores",
        sa.Column("annotation_queue_id", sa.String(length=128), nullable=False),
        sa.Column("score_config_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["annotation_queue_id"],
            ["annotation_queues.annotation_queue_id"],
            name="fk_annotation_queue_scores_queue",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["score_config_id"],
            ["score_configs.score_config_id"],
            name="fk_annotation_queue_scores_config",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("annotation_queue_id", "score_config_id"),
    )

    op.create_table(
        "annotation_queue_items",
        sa.Column(
            "annotation_queue_item_id",
            sa.String(length=128),
            nullable=False,
        ),
        sa.Column("annotation_queue_id", sa.String(length=128), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.Column("completed_at", sa.String(length=27), nullable=True),
        sa.ForeignKeyConstraint(
            ["annotation_queue_id"],
            ["annotation_queues.annotation_queue_id"],
            name="fk_annotation_queue_items_queue",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["trace_id"],
            ["traces.trace_id"],
            name="fk_annotation_queue_items_trace",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("annotation_queue_item_id"),
        sa.UniqueConstraint(
            "annotation_queue_id",
            "trace_id",
            name="uq_annotation_queue_items_queue_trace",
        ),
    )
    op.create_index(
        "ix_annotation_queue_items_annotation_queue_id",
        "annotation_queue_items",
        ["annotation_queue_id"],
    )
    op.create_index(
        "ix_annotation_queue_items_trace_id",
        "annotation_queue_items",
        ["trace_id"],
    )
    op.create_index(
        "ix_annotation_queue_items_status",
        "annotation_queue_items",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_annotation_queue_items_status",
        table_name="annotation_queue_items",
    )
    op.drop_index(
        "ix_annotation_queue_items_trace_id",
        table_name="annotation_queue_items",
    )
    op.drop_index(
        "ix_annotation_queue_items_annotation_queue_id",
        table_name="annotation_queue_items",
    )
    op.drop_table("annotation_queue_items")
    op.drop_table("annotation_queue_scores")
    op.drop_index("ix_annotation_queues_name", table_name="annotation_queues")
    op.drop_table("annotation_queues")
    op.drop_table("trace_memos")
    op.drop_table("annotation_selected_options")
    op.drop_index("ix_annotations_trace_id", table_name="annotations")
    op.drop_index("ix_annotations_score_config_id", table_name="annotations")
    op.drop_table("annotations")
    op.drop_index(
        "ix_score_options_score_config_id",
        table_name="score_options",
    )
    op.drop_table("score_options")
    op.drop_index("ix_score_configs_name", table_name="score_configs")
    op.drop_table("score_configs")

    op.create_table(
        "feedback",
        sa.Column("feedback_id", sa.String(length=128), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.PrimaryKeyConstraint("feedback_id"),
    )
    op.create_index("ix_feedback_trace_id", "feedback", ["trace_id"])
    op.create_index("ix_feedback_created_at", "feedback", ["created_at"])
