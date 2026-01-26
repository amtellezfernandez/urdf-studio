"""Baseline migration for existing schema.

Revision ID: 001
Revises:
Create Date: 2025-01-26

This migration creates the baseline schema that matches the existing
database structure. For existing databases, use `alembic stamp 001`
to mark them as already having this migration applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create baseline schema tables and indexes."""
    # Create jobs table
    op.create_table(
        "jobs",
        sa.Column("job_id", sa.Text(), primary_key=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("started_at", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("compute_backend", sa.Text(), server_default="local"),
        sa.Column("compute_job_id", sa.Text(), nullable=True),
        sa.Column("tracker_url", sa.Text(), nullable=True),
        sa.Column("run_name", sa.Text(), nullable=True),
        sa.Column("model_architecture", sa.Text(), nullable=True),
        sa.Column("dataset_id", sa.Text(), nullable=True),
    )

    # Create metrics table
    op.create_table(
        "metrics",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Text(), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("metrics", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.job_id"]),
    )

    # Create indexes
    op.create_index("idx_jobs_status", "jobs", ["status"])
    op.create_index("idx_jobs_created", "jobs", ["created_at"])
    op.create_index("idx_jobs_model", "jobs", ["model_architecture"])
    op.create_index("idx_metrics_job", "metrics", ["job_id"])
    op.create_index("idx_metrics_step", "metrics", ["job_id", "step"])


def downgrade() -> None:
    """Drop all tables and indexes."""
    # Drop indexes first
    op.drop_index("idx_metrics_step", table_name="metrics")
    op.drop_index("idx_metrics_job", table_name="metrics")
    op.drop_index("idx_jobs_model", table_name="jobs")
    op.drop_index("idx_jobs_created", table_name="jobs")
    op.drop_index("idx_jobs_status", table_name="jobs")

    # Drop tables
    op.drop_table("metrics")
    op.drop_table("jobs")
