"""Migration Runner Service.

This module provides utilities for running Alembic migrations
programmatically, both from async code and CLI.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

logger = logging.getLogger(__name__)

# Path to alembic.ini relative to this file
ALEMBIC_INI_PATH = Path(__file__).parent.parent / "alembic.ini"


def get_alembic_config(db_path: Optional[Path] = None) -> Config:
    """Get Alembic configuration.

    Args:
        db_path: Optional custom database path. If not provided,
                 uses URDF_DATA_DIR env var or default location.

    Returns:
        Alembic Config object
    """
    config = Config(str(ALEMBIC_INI_PATH))

    # Override database URL if custom path provided
    if db_path is not None:
        config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    else:
        # Use the same logic as env.py
        data_dir = os.environ.get(
            "URDF_DATA_DIR",
            str(Path.home() / ".urdf-studio" / "data")
        )
        db_path = Path(data_dir) / "jobs.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    return config


def get_database_url(db_path: Optional[Path] = None) -> str:
    """Get database URL string.

    Args:
        db_path: Optional custom database path.

    Returns:
        SQLite database URL string
    """
    if db_path is not None:
        return f"sqlite:///{db_path}"

    data_dir = os.environ.get(
        "URDF_DATA_DIR",
        str(Path.home() / ".urdf-studio" / "data")
    )
    return f"sqlite:///{Path(data_dir) / 'jobs.db'}"


def get_current_revision(db_path: Optional[Path] = None) -> Optional[str]:
    """Get current database revision.

    Args:
        db_path: Optional custom database path.

    Returns:
        Current revision string or None if no migrations applied
    """
    url = get_database_url(db_path)
    engine = create_engine(url)

    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        return context.get_current_revision()


def get_head_revision() -> str:
    """Get the head revision from migration scripts.

    Returns:
        Head revision string
    """
    config = get_alembic_config()
    script = ScriptDirectory.from_config(config)
    return script.get_current_head()


def needs_migration(db_path: Optional[Path] = None) -> bool:
    """Check if database needs migration.

    Args:
        db_path: Optional custom database path.

    Returns:
        True if there are pending migrations
    """
    current = get_current_revision(db_path)
    head = get_head_revision()
    return current != head


async def run_migrations(db_path: Optional[Path] = None) -> bool:
    """Run pending migrations on startup.

    This function runs all pending migrations to bring the database
    schema up to date. It is safe to call multiple times - if no
    migrations are pending, it will return quickly.

    Args:
        db_path: Optional custom database path.

    Returns:
        True if migrations were run successfully, False on error
    """
    try:
        config = get_alembic_config(db_path)

        # Ensure database directory exists
        url = get_database_url(db_path)
        db_file = Path(url.replace("sqlite:///", ""))
        db_file.parent.mkdir(parents=True, exist_ok=True)

        current = get_current_revision(db_path)
        head = get_head_revision()

        if current == head:
            logger.debug(f"Database at current revision: {current}")
            return True

        logger.info(f"Running migrations: {current} -> {head}")
        command.upgrade(config, "head")
        logger.info("Migrations completed successfully")
        return True

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        return False


def stamp_existing_db(
    db_path: Optional[Path] = None,
    revision: str = "head"
) -> bool:
    """Stamp an existing database as having the specified migration.

    This is used when adopting Alembic for an existing database that
    already has the correct schema. It marks the database as being at
    the specified revision without running any migrations.

    Args:
        db_path: Optional custom database path.
        revision: Revision to stamp (default: "head")

    Returns:
        True if stamping was successful, False on error
    """
    try:
        config = get_alembic_config(db_path)
        command.stamp(config, revision)
        logger.info(f"Database stamped at revision: {revision}")
        return True

    except Exception as e:
        logger.error(f"Failed to stamp database: {e}")
        return False


def downgrade(
    db_path: Optional[Path] = None,
    revision: str = "-1"
) -> bool:
    """Downgrade database to a previous revision.

    Args:
        db_path: Optional custom database path.
        revision: Target revision (default: "-1" for one step back)

    Returns:
        True if downgrade was successful, False on error
    """
    try:
        config = get_alembic_config(db_path)
        command.downgrade(config, revision)
        logger.info(f"Database downgraded to revision: {revision}")
        return True

    except Exception as e:
        logger.error(f"Failed to downgrade database: {e}")
        return False


def create_all_tables_fallback(db_path: Path) -> None:
    """Fallback: create tables directly without Alembic.

    This is used when Alembic migrations fail, to maintain
    backward compatibility with the original job_store behavior.

    Args:
        db_path: Database path
    """
    import sqlite3

    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Jobs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            error TEXT,
            compute_backend TEXT DEFAULT 'local',
            compute_job_id TEXT,
            tracker_url TEXT,
            run_name TEXT,
            model_architecture TEXT,
            dataset_id TEXT
        )
    """)

    # Metrics table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            step INTEGER NOT NULL,
            epoch INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            metrics TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES jobs (job_id)
        )
    """)

    # Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_model ON jobs (model_architecture)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_metrics_job ON metrics (job_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_metrics_step ON metrics (job_id, step)")

    conn.commit()
    conn.close()

    logger.warning("Created tables using fallback method (Alembic unavailable)")
