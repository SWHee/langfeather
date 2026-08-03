"""Track whether a completed annotation queue item was later edited.

Revision ID: 0005_queue_item_was_edited
Revises: 0004_datasets_experiments
Create Date: 2026-08-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_queue_item_was_edited"
down_revision: str | None = "0004_datasets_experiments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotation_queue_items",
        sa.Column(
            "was_edited",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("annotation_queue_items", "was_edited")
