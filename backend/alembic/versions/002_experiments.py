"""Add experiments table and link jobs to experiments.

Revision ID: 002
Revises: 001
Create Date: 2024-01-26

This migration:
1. Creates the experiments table for grouping training runs
2. Adds experiment_id foreign key to jobs table
3. Creates necessary indexes
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create experiments table and add experiment_id to jobs."""
    # Create experiments table
    op.execute("""
        CREATE TABLE experiments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            notes TEXT,
            tags TEXT,

            -- Dataset reference
            dataset_source TEXT NOT NULL,
            dataset_repo_id TEXT,
            dataset_local_path TEXT,
            dataset_version TEXT,
            dataset_resolved_revision TEXT,

            -- Robot reference
            robot_name TEXT,
            urdf_hash TEXT,

            -- Environment (nullable for v0.1)
            environment_config TEXT,

            -- Timestamps
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    # Add experiment_id column to jobs table
    op.execute("ALTER TABLE jobs ADD COLUMN experiment_id TEXT REFERENCES experiments(id)")

    # Create indexes
    op.execute("CREATE INDEX idx_jobs_experiment ON jobs(experiment_id)")
    op.execute("CREATE INDEX idx_experiments_name ON experiments(name)")
    op.execute("CREATE INDEX idx_experiments_created ON experiments(created_at)")


def downgrade() -> None:
    """Drop experiments table and related indexes."""
    op.execute("DROP INDEX IF EXISTS idx_jobs_experiment")
    op.execute("DROP INDEX IF EXISTS idx_experiments_name")
    op.execute("DROP INDEX IF EXISTS idx_experiments_created")
    op.execute("DROP TABLE IF EXISTS experiments")
    # Note: SQLite doesn't support DROP COLUMN, so experiment_id remains in jobs
