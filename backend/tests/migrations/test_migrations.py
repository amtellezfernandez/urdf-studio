"""Tests for Alembic migrations.

This module tests:
- Fresh database migration
- Stamping existing databases
- Upgrade/downgrade cycle
- Migration idempotency
"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from backend.services.migrations import (
    create_all_tables_fallback,
    downgrade,
    get_current_revision,
    get_head_revision,
    needs_migration,
    run_migrations,
    stamp_existing_db,
)


@pytest.fixture
def temp_db() -> Path:
    """Create a temporary database path."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_jobs.db"
        yield db_path


@pytest.fixture
def existing_db(temp_db: Path) -> Path:
    """Create a database with existing schema (pre-Alembic)."""
    create_all_tables_fallback(temp_db)
    return temp_db


class TestFreshMigration:
    """Tests for migrating a fresh database."""

    @pytest.mark.asyncio
    async def test_fresh_db_migration(self, temp_db: Path) -> None:
        """Test running migrations on a fresh database."""
        # Database should not exist yet
        assert not temp_db.exists()

        # Run migrations
        success = await run_migrations(temp_db)
        assert success

        # Database should now exist
        assert temp_db.exists()

        # Should be at head revision
        current = get_current_revision(temp_db)
        head = get_head_revision()
        assert current == head

    @pytest.mark.asyncio
    async def test_fresh_db_has_tables(self, temp_db: Path) -> None:
        """Test that fresh migration creates all required tables."""
        await run_migrations(temp_db)

        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()

        # Check tables exist
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = {row[0] for row in cursor.fetchall()}

        assert "jobs" in tables
        assert "metrics" in tables
        assert "alembic_version" in tables

        conn.close()

    @pytest.mark.asyncio
    async def test_fresh_db_has_indexes(self, temp_db: Path) -> None:
        """Test that fresh migration creates all required indexes."""
        await run_migrations(temp_db)

        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()

        # Check indexes exist
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
        )
        indexes = {row[0] for row in cursor.fetchall()}

        assert "idx_jobs_status" in indexes
        assert "idx_jobs_created" in indexes
        assert "idx_jobs_model" in indexes
        assert "idx_metrics_job" in indexes
        assert "idx_metrics_step" in indexes

        conn.close()


class TestStampExistingDb:
    """Tests for stamping existing databases."""

    def test_stamp_existing_db(self, existing_db: Path) -> None:
        """Test stamping an existing database."""
        # Before stamp, no alembic_version table
        conn = sqlite3.connect(existing_db)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"
        )
        assert cursor.fetchone() is None
        conn.close()

        # Stamp the database
        success = stamp_existing_db(existing_db)
        assert success

        # After stamp, should have alembic_version
        conn = sqlite3.connect(existing_db)
        cursor = conn.cursor()
        cursor.execute("SELECT version_num FROM alembic_version")
        row = cursor.fetchone()
        conn.close()

        assert row is not None
        assert row[0] == get_head_revision()

    def test_stamp_with_specific_revision(self, existing_db: Path) -> None:
        """Test stamping with a specific revision."""
        success = stamp_existing_db(existing_db, revision="001")
        assert success

        current = get_current_revision(existing_db)
        assert current == "001"

    @pytest.mark.asyncio
    async def test_stamped_db_needs_no_migration(self, existing_db: Path) -> None:
        """Test that a stamped database reports no pending migrations."""
        stamp_existing_db(existing_db, revision="head")

        # Should not need migration
        assert not needs_migration(existing_db)

        # Running migrations should succeed immediately
        success = await run_migrations(existing_db)
        assert success


class TestUpgradeDowngrade:
    """Tests for upgrade/downgrade cycle."""

    @pytest.mark.asyncio
    async def test_upgrade_downgrade_cycle(self, temp_db: Path) -> None:
        """Test full upgrade then downgrade cycle."""
        # Upgrade
        success = await run_migrations(temp_db)
        assert success

        current = get_current_revision(temp_db)
        head = get_head_revision()
        assert current == head

        # Downgrade to base
        success = downgrade(temp_db, revision="base")
        assert success

        # After downgrade, revision should be None
        current = get_current_revision(temp_db)
        assert current is None

        # Tables should be dropped
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
        )
        assert cursor.fetchone() is None
        conn.close()

    @pytest.mark.asyncio
    async def test_reupgrade_after_downgrade(self, temp_db: Path) -> None:
        """Test that we can upgrade again after downgrade."""
        # Initial upgrade
        await run_migrations(temp_db)

        # Downgrade
        downgrade(temp_db, revision="base")

        # Upgrade again
        success = await run_migrations(temp_db)
        assert success

        # Should be at head
        current = get_current_revision(temp_db)
        assert current == get_head_revision()

        # Tables should exist
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
        )
        assert cursor.fetchone() is not None
        conn.close()


class TestIdempotency:
    """Tests for migration idempotency."""

    @pytest.mark.asyncio
    async def test_multiple_migrations_safe(self, temp_db: Path) -> None:
        """Test that running migrations multiple times is safe."""
        # Run migrations multiple times
        for _ in range(3):
            success = await run_migrations(temp_db)
            assert success

        # Should still be at head
        current = get_current_revision(temp_db)
        assert current == get_head_revision()

    @pytest.mark.asyncio
    async def test_already_migrated_fast(self, temp_db: Path) -> None:
        """Test that already-migrated database returns quickly."""
        # Initial migration
        await run_migrations(temp_db)

        # Should report no migration needed
        assert not needs_migration(temp_db)

    def test_multiple_stamps_safe(self, existing_db: Path) -> None:
        """Test that stamping multiple times is safe."""
        for _ in range(3):
            success = stamp_existing_db(existing_db)
            assert success

        # Should still be at head
        current = get_current_revision(existing_db)
        assert current == get_head_revision()


class TestNeedsMigration:
    """Tests for needs_migration detection."""

    @pytest.mark.asyncio
    async def test_fresh_db_needs_migration(self, temp_db: Path) -> None:
        """Test that a fresh database needs migration."""
        # Create empty database file
        temp_db.touch()

        # Should need migration (no alembic_version table)
        assert needs_migration(temp_db)

    @pytest.mark.asyncio
    async def test_migrated_db_no_migration_needed(self, temp_db: Path) -> None:
        """Test that a fully migrated database needs no migration."""
        await run_migrations(temp_db)
        assert not needs_migration(temp_db)

    def test_stamped_db_no_migration_needed(self, existing_db: Path) -> None:
        """Test that a stamped database needs no migration."""
        stamp_existing_db(existing_db)
        assert not needs_migration(existing_db)
