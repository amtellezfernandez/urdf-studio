"""Create evaluations table.

Revision ID: 003
Revises: 002
Create Date: 2024-01-26
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create evaluations table."""
    op.execute("""
        CREATE TABLE evaluations (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            experiment_id TEXT,

            -- Checkpoint reference
            checkpoint_name TEXT NOT NULL,
            checkpoint_path TEXT,

            -- Configuration
            num_episodes INTEGER NOT NULL,
            seed INTEGER,
            max_steps INTEGER DEFAULT 1000,
            environment_config TEXT,

            -- Status
            status TEXT NOT NULL DEFAULT 'queued',

            -- Results
            metrics TEXT,
            error TEXT,

            -- Artifacts
            episodes_artifact_path TEXT,
            video_artifact_paths TEXT,

            -- Timestamps
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,

            FOREIGN KEY (run_id) REFERENCES jobs(job_id),
            FOREIGN KEY (experiment_id) REFERENCES experiments(id)
        )
    """)

    op.execute("CREATE INDEX idx_evaluations_run ON evaluations(run_id)")
    op.execute("CREATE INDEX idx_evaluations_experiment ON evaluations(experiment_id)")
    op.execute("CREATE INDEX idx_evaluations_status ON evaluations(status)")


def downgrade() -> None:
    """Drop evaluations table."""
    op.execute("DROP INDEX IF EXISTS idx_evaluations_status")
    op.execute("DROP INDEX IF EXISTS idx_evaluations_experiment")
    op.execute("DROP INDEX IF EXISTS idx_evaluations_run")
    op.execute("DROP TABLE IF EXISTS evaluations")
