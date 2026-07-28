"""Add local datasets and immutable experiment results.

Revision ID: 0004_datasets_experiments
Revises: 0003_score_annotations
Create Date: 2026-07-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_datasets_experiments"
down_revision: str | None = "0003_score_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("dataset_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "dataset_examples",
        sa.Column("dataset_example_id", sa.String(length=128), nullable=False),
        sa.Column("dataset_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=False),
        sa.Column("expected_output_json", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("source_trace_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.String(length=27), nullable=False),
        sa.Column("updated_at", sa.String(length=27), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.dataset_id"],
            name="fk_dataset_examples_dataset",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("dataset_example_id"),
        sa.UniqueConstraint(
            "dataset_id", "position", name="uq_dataset_examples_position"
        ),
    )
    op.create_index(
        "ix_dataset_examples_dataset_id", "dataset_examples", ["dataset_id"]
    )
    op.create_table(
        "experiments",
        sa.Column("experiment_id", sa.String(length=128), nullable=False),
        sa.Column("dataset_id", sa.String(length=128), nullable=False),
        sa.Column("dataset_revision", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("target_metadata_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("started_at", sa.String(length=27), nullable=False),
        sa.Column("ended_at", sa.String(length=27), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.dataset_id"],
            name="fk_experiments_dataset",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("experiment_id"),
    )
    op.create_index("ix_experiments_dataset_id", "experiments", ["dataset_id"])
    op.create_index("ix_experiments_name", "experiments", ["name"])
    op.create_index("ix_experiments_status", "experiments", ["status"])
    op.create_table(
        "experiment_evaluators",
        sa.Column("experiment_evaluator_id", sa.String(length=128), nullable=False),
        sa.Column("experiment_id", sa.String(length=128), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("data_type", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["experiment_id"],
            ["experiments.experiment_id"],
            name="fk_experiment_evaluators_experiment",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("experiment_evaluator_id"),
        sa.UniqueConstraint(
            "experiment_id", "key", name="uq_experiment_evaluators_key"
        ),
    )
    op.create_index(
        "ix_experiment_evaluators_experiment_id",
        "experiment_evaluators",
        ["experiment_id"],
    )
    op.create_table(
        "experiment_cases",
        sa.Column("experiment_case_id", sa.String(length=128), nullable=False),
        sa.Column("experiment_id", sa.String(length=128), nullable=False),
        sa.Column("dataset_example_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=False),
        sa.Column("expected_output_json", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("output_json", sa.Text(), nullable=True),
        sa.Column("error_json", sa.Text(), nullable=True),
        sa.Column("duration_us", sa.BigInteger(), nullable=True),
        sa.Column("trace_id", sa.String(length=128), nullable=True),
        sa.Column("completed_at", sa.String(length=27), nullable=True),
        sa.ForeignKeyConstraint(
            ["experiment_id"],
            ["experiments.experiment_id"],
            name="fk_experiment_cases_experiment",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("experiment_case_id"),
        sa.UniqueConstraint(
            "experiment_id", "dataset_example_id", name="uq_experiment_cases_example"
        ),
    )
    op.create_index(
        "ix_experiment_cases_experiment_id", "experiment_cases", ["experiment_id"]
    )
    op.create_index("ix_experiment_cases_status", "experiment_cases", ["status"])
    op.create_table(
        "experiment_results",
        sa.Column("experiment_result_id", sa.String(length=128), nullable=False),
        sa.Column("experiment_case_id", sa.String(length=128), nullable=False),
        sa.Column("experiment_evaluator_id", sa.String(length=128), nullable=False),
        sa.Column("boolean_value", sa.Boolean(), nullable=True),
        sa.Column("number_value", sa.Float(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["experiment_case_id"],
            ["experiment_cases.experiment_case_id"],
            name="fk_experiment_results_case",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["experiment_evaluator_id"],
            ["experiment_evaluators.experiment_evaluator_id"],
            name="fk_experiment_results_evaluator",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("experiment_result_id"),
        sa.UniqueConstraint(
            "experiment_case_id",
            "experiment_evaluator_id",
            name="uq_experiment_results_case_evaluator",
        ),
    )
    op.create_index(
        "ix_experiment_results_case_id", "experiment_results", ["experiment_case_id"]
    )
    op.create_index(
        "ix_experiment_results_evaluator_id",
        "experiment_results",
        ["experiment_evaluator_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_experiment_results_evaluator_id", table_name="experiment_results")
    op.drop_index("ix_experiment_results_case_id", table_name="experiment_results")
    op.drop_table("experiment_results")
    op.drop_index("ix_experiment_cases_status", table_name="experiment_cases")
    op.drop_index("ix_experiment_cases_experiment_id", table_name="experiment_cases")
    op.drop_table("experiment_cases")
    op.drop_index(
        "ix_experiment_evaluators_experiment_id", table_name="experiment_evaluators"
    )
    op.drop_table("experiment_evaluators")
    op.drop_index("ix_experiments_status", table_name="experiments")
    op.drop_index("ix_experiments_name", table_name="experiments")
    op.drop_index("ix_experiments_dataset_id", table_name="experiments")
    op.drop_table("experiments")
    op.drop_index("ix_dataset_examples_dataset_id", table_name="dataset_examples")
    op.drop_table("dataset_examples")
    op.drop_table("datasets")
