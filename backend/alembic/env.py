"""Alembic migration environment for URDF Studio.

This module configures Alembic to:
- Read database path from URDF_DATA_DIR environment variable
- Support async migrations with aiosqlite
- Run migrations synchronously for CLI usage
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

# Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def get_database_url() -> str:
    """Get database URL from environment or default location.

    Uses URDF_DATA_DIR env var if set, otherwise defaults to
    ~/.urdf-studio/data/jobs.db

    Returns:
        SQLite database URL string
    """
    data_dir = os.environ.get(
        "URDF_DATA_DIR",
        str(Path.home() / ".urdf-studio" / "data")
    )
    db_path = Path(data_dir) / "jobs.db"

    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    return f"sqlite:///{db_path}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well. By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    url = get_database_url()

    connectable = create_engine(
        url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=None,
        )

        with context.begin_transaction():
            context.run_migrations()


def run_migrations_async() -> None:
    """Run migrations asynchronously.

    This is used when running migrations programmatically
    from async code (e.g., during server startup).
    """
    # For SQLite, we run synchronously even in async context
    # since aiosqlite doesn't support Alembic directly
    run_migrations_online()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
