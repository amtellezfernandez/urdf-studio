"""Add experiments table and link jobs to experiments.

Revision ID: 002
Revises: 001
Create Date: 2024-01-26

This migration:
1. Creates the experiments table for grouping training runs
2. Adds experiment_id foreign key to jobs table
3. Creates necessary indexes
"""

from __future__ import annotations

import logging

import aiosqlite

logger = logging.getLogger(__name__)

# SQL statements for the migration
CREATE_EXPERIMENTS_TABLE = """
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    notes TEXT,
    tags TEXT,  -- JSON array

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
);
"""

ADD_EXPERIMENT_ID_COLUMN = """
ALTER TABLE jobs ADD COLUMN experiment_id TEXT REFERENCES experiments(id);
"""

CREATE_JOBS_EXPERIMENT_INDEX = """
CREATE INDEX IF NOT EXISTS idx_jobs_experiment ON jobs(experiment_id);
"""

CREATE_EXPERIMENTS_NAME_INDEX = """
CREATE INDEX IF NOT EXISTS idx_experiments_name ON experiments(name);
"""

CREATE_EXPERIMENTS_CREATED_INDEX = """
CREATE INDEX IF NOT EXISTS idx_experiments_created ON experiments(created_at);
"""


async def upgrade(db: aiosqlite.Connection) -> None:
    """Run the migration."""
    logger.info("Running migration 002_experiments: Creating experiments table")

    # Create experiments table
    await db.execute(CREATE_EXPERIMENTS_TABLE)
    logger.info("Created experiments table")

    # Check if experiment_id column already exists in jobs
    cursor = await db.execute("PRAGMA table_info(jobs)")
    columns = await cursor.fetchall()
    column_names = [col[1] for col in columns]

    if "experiment_id" not in column_names:
        await db.execute(ADD_EXPERIMENT_ID_COLUMN)
        logger.info("Added experiment_id column to jobs table")
    else:
        logger.info("experiment_id column already exists in jobs table")

    # Create indexes
    await db.execute(CREATE_JOBS_EXPERIMENT_INDEX)
    await db.execute(CREATE_EXPERIMENTS_NAME_INDEX)
    await db.execute(CREATE_EXPERIMENTS_CREATED_INDEX)
    logger.info("Created indexes for experiments")

    await db.commit()
    logger.info("Migration 002_experiments completed successfully")


async def downgrade(db: aiosqlite.Connection) -> None:
    """Revert the migration."""
    logger.info("Reverting migration 002_experiments")

    # SQLite doesn't support DROP COLUMN directly in older versions
    # We need to recreate the jobs table without experiment_id
    # For now, we'll just drop the experiments table

    await db.execute("DROP INDEX IF EXISTS idx_jobs_experiment")
    await db.execute("DROP INDEX IF EXISTS idx_experiments_name")
    await db.execute("DROP INDEX IF EXISTS idx_experiments_created")
    await db.execute("DROP TABLE IF EXISTS experiments")

    await db.commit()
    logger.info("Migration 002_experiments reverted")
