"""Job Persistence Store.

This service provides SQLite-based persistence for training jobs,
allowing job state to survive across restarts.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import aiosqlite

from backend.models.training import JobStatus

logger = logging.getLogger(__name__)

# Database settings
DB_DIR = Path(os.environ.get("URDF_DATA_DIR", Path.home() / ".urdf-studio" / "data"))
DB_FILE = DB_DIR / "jobs.db"


@dataclass
class JobRecord:
    """Stored job record."""

    job_id: str
    status: JobStatus
    config: Dict[str, Any]
    created_at: str
    updated_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None
    compute_backend: str = "local"
    compute_job_id: Optional[str] = None
    tracker_url: Optional[str] = None
    run_name: Optional[str] = None
    model_architecture: Optional[str] = None
    dataset_id: Optional[str] = None
    metrics_history: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "job_id": self.job_id,
            "status": self.status.value if isinstance(self.status, JobStatus) else self.status,
            "config": self.config,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "compute_backend": self.compute_backend,
            "compute_job_id": self.compute_job_id,
            "tracker_url": self.tracker_url,
            "run_name": self.run_name,
            "model_architecture": self.model_architecture,
            "dataset_id": self.dataset_id,
            "metrics_history": self.metrics_history,
        }


@dataclass
class MetricRecord:
    """Stored metric record."""

    job_id: str
    step: int
    epoch: int
    timestamp: str
    metrics: Dict[str, float]


class JobStore:
    """SQLite-based job persistence store."""

    def __init__(self, db_path: Optional[Path] = None):
        """Initialize the job store.

        Args:
            db_path: Optional custom database path
        """
        self.db_path = db_path or DB_FILE
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialized = False

    @asynccontextmanager
    async def _get_db(self) -> AsyncIterator[aiosqlite.Connection]:
        """Get database connection."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            yield db

    async def initialize(self) -> None:
        """Initialize the database schema."""
        if self._initialized:
            return

        async with self._get_db() as db:
            # Jobs table
            await db.execute("""
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

            # Metrics history table
            await db.execute("""
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
            await db.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_jobs_model ON jobs (model_architecture)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_metrics_job ON metrics (job_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_metrics_step ON metrics (job_id, step)")

            await db.commit()

        self._initialized = True
        logger.info(f"Initialized job store at {self.db_path}")

    async def create_job(
        self,
        job_id: str,
        config: Dict[str, Any],
        compute_backend: str = "local",
        compute_job_id: Optional[str] = None,
        run_name: Optional[str] = None,
        model_architecture: Optional[str] = None,
        dataset_id: Optional[str] = None,
    ) -> JobRecord:
        """Create a new job record.

        Args:
            job_id: Unique job ID
            config: Job configuration
            compute_backend: Compute backend type
            compute_job_id: Backend-specific job ID
            run_name: Optional run name
            model_architecture: Model architecture name
            dataset_id: Dataset identifier

        Returns:
            Created job record
        """
        await self.initialize()

        now = datetime.now().isoformat()

        async with self._get_db() as db:
            await db.execute(
                """
                INSERT INTO jobs (
                    job_id, status, config, created_at, updated_at, started_at,
                    compute_backend, compute_job_id, run_name, model_architecture, dataset_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    JobStatus.PENDING.value,
                    json.dumps(config),
                    now,
                    now,
                    now,
                    compute_backend,
                    compute_job_id,
                    run_name,
                    model_architecture,
                    dataset_id,
                ),
            )
            await db.commit()

        logger.info(f"Created job record: {job_id}")

        return JobRecord(
            job_id=job_id,
            status=JobStatus.PENDING,
            config=config,
            created_at=now,
            updated_at=now,
            started_at=now,
            compute_backend=compute_backend,
            compute_job_id=compute_job_id,
            run_name=run_name,
            model_architecture=model_architecture,
            dataset_id=dataset_id,
        )

    async def get_job(self, job_id: str) -> Optional[JobRecord]:
        """Get a job record by ID.

        Args:
            job_id: Job ID to look up

        Returns:
            Job record or None if not found
        """
        await self.initialize()

        async with self._get_db() as db:
            cursor = await db.execute(
                "SELECT * FROM jobs WHERE job_id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()

            if not row:
                return None

            return self._row_to_job(dict(row))

    async def update_job(
        self,
        job_id: str,
        status: Optional[JobStatus] = None,
        error: Optional[str] = None,
        finished_at: Optional[str] = None,
        tracker_url: Optional[str] = None,
        compute_job_id: Optional[str] = None,
    ) -> Optional[JobRecord]:
        """Update a job record.

        Args:
            job_id: Job ID to update
            status: New status
            error: Error message
            finished_at: Completion timestamp
            tracker_url: Tracker URL
            compute_job_id: Backend job ID

        Returns:
            Updated job record or None if not found
        """
        await self.initialize()

        # Build update query dynamically
        updates = ["updated_at = ?"]
        params: List[Any] = [datetime.now().isoformat()]

        if status is not None:
            updates.append("status = ?")
            params.append(status.value if isinstance(status, JobStatus) else status)

        if error is not None:
            updates.append("error = ?")
            params.append(error)

        if finished_at is not None:
            updates.append("finished_at = ?")
            params.append(finished_at)

        if tracker_url is not None:
            updates.append("tracker_url = ?")
            params.append(tracker_url)

        if compute_job_id is not None:
            updates.append("compute_job_id = ?")
            params.append(compute_job_id)

        params.append(job_id)

        async with self._get_db() as db:
            await db.execute(
                f"UPDATE jobs SET {', '.join(updates)} WHERE job_id = ?",
                params,
            )
            await db.commit()

        return await self.get_job(job_id)

    async def list_jobs(
        self,
        status: Optional[JobStatus] = None,
        model_architecture: Optional[str] = None,
        dataset_id: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[JobRecord]:
        """List jobs with filters.

        Args:
            status: Filter by status
            model_architecture: Filter by model
            dataset_id: Filter by dataset
            since: Filter by created_at >= since
            until: Filter by created_at <= until
            limit: Maximum results
            offset: Results offset

        Returns:
            List of job records
        """
        await self.initialize()

        # Build query
        conditions = []
        params: List[Any] = []

        if status is not None:
            conditions.append("status = ?")
            params.append(status.value if isinstance(status, JobStatus) else status)

        if model_architecture is not None:
            conditions.append("model_architecture = ?")
            params.append(model_architecture)

        if dataset_id is not None:
            conditions.append("dataset_id = ?")
            params.append(dataset_id)

        if since is not None:
            conditions.append("created_at >= ?")
            params.append(since)

        if until is not None:
            conditions.append("created_at <= ?")
            params.append(until)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        query = f"""
            SELECT * FROM jobs
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])

        async with self._get_db() as db:
            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()

            return [self._row_to_job(dict(row)) for row in rows]

    async def count_jobs(
        self,
        status: Optional[JobStatus] = None,
    ) -> int:
        """Count jobs with optional status filter.

        Args:
            status: Optional status filter

        Returns:
            Number of jobs
        """
        await self.initialize()

        if status is not None:
            query = "SELECT COUNT(*) FROM jobs WHERE status = ?"
            params = (status.value if isinstance(status, JobStatus) else status,)
        else:
            query = "SELECT COUNT(*) FROM jobs"
            params = ()

        async with self._get_db() as db:
            cursor = await db.execute(query, params)
            row = await cursor.fetchone()
            return row[0] if row else 0

    async def add_metrics(
        self,
        job_id: str,
        step: int,
        epoch: int,
        metrics: Dict[str, float],
    ) -> None:
        """Add metrics for a job.

        Args:
            job_id: Job ID
            step: Training step
            epoch: Training epoch
            metrics: Metric values
        """
        await self.initialize()

        async with self._get_db() as db:
            await db.execute(
                """
                INSERT INTO metrics (job_id, step, epoch, timestamp, metrics)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    step,
                    epoch,
                    datetime.now().isoformat(),
                    json.dumps(metrics),
                ),
            )
            await db.commit()

    async def get_metrics(
        self,
        job_id: str,
        limit: Optional[int] = None,
    ) -> List[MetricRecord]:
        """Get metrics history for a job.

        Args:
            job_id: Job ID
            limit: Optional limit on results

        Returns:
            List of metric records
        """
        await self.initialize()

        query = """
            SELECT job_id, step, epoch, timestamp, metrics
            FROM metrics
            WHERE job_id = ?
            ORDER BY step ASC
        """
        params: List[Any] = [job_id]

        if limit:
            query += " LIMIT ?"
            params.append(limit)

        async with self._get_db() as db:
            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()

            return [
                MetricRecord(
                    job_id=row["job_id"],
                    step=row["step"],
                    epoch=row["epoch"],
                    timestamp=row["timestamp"],
                    metrics=json.loads(row["metrics"]),
                )
                for row in rows
            ]

    async def get_latest_metrics(self, job_id: str) -> Optional[MetricRecord]:
        """Get the latest metrics for a job.

        Args:
            job_id: Job ID

        Returns:
            Latest metric record or None
        """
        await self.initialize()

        async with self._get_db() as db:
            cursor = await db.execute(
                """
                SELECT job_id, step, epoch, timestamp, metrics
                FROM metrics
                WHERE job_id = ?
                ORDER BY step DESC
                LIMIT 1
                """,
                (job_id,),
            )
            row = await cursor.fetchone()

            if not row:
                return None

            return MetricRecord(
                job_id=row["job_id"],
                step=row["step"],
                epoch=row["epoch"],
                timestamp=row["timestamp"],
                metrics=json.loads(row["metrics"]),
            )

    async def delete_job(self, job_id: str) -> bool:
        """Delete a job and its metrics.

        Args:
            job_id: Job ID to delete

        Returns:
            True if deleted
        """
        await self.initialize()

        async with self._get_db() as db:
            # Delete metrics first
            await db.execute("DELETE FROM metrics WHERE job_id = ?", (job_id,))

            # Delete job
            cursor = await db.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
            await db.commit()

            deleted = cursor.rowcount > 0
            if deleted:
                logger.info(f"Deleted job: {job_id}")
            return deleted

    async def cleanup_old_jobs(
        self,
        days: int = 30,
        keep_statuses: Optional[List[JobStatus]] = None,
    ) -> int:
        """Clean up old job records.

        Args:
            days: Delete jobs older than this many days
            keep_statuses: Statuses to preserve regardless of age

        Returns:
            Number of jobs deleted
        """
        await self.initialize()

        from datetime import timedelta

        cutoff = (datetime.now() - timedelta(days=days)).isoformat()

        # Build exclusion list
        keep_statuses = keep_statuses or [JobStatus.RUNNING, JobStatus.PENDING, JobStatus.QUEUED]
        status_placeholders = ", ".join("?" * len(keep_statuses))
        status_values = [s.value if isinstance(s, JobStatus) else s for s in keep_statuses]

        async with self._get_db() as db:
            # Get jobs to delete
            cursor = await db.execute(
                f"""
                SELECT job_id FROM jobs
                WHERE created_at < ? AND status NOT IN ({status_placeholders})
                """,
                [cutoff] + status_values,
            )
            rows = await cursor.fetchall()
            job_ids = [row["job_id"] for row in rows]

            if not job_ids:
                return 0

            # Delete metrics
            placeholders = ", ".join("?" * len(job_ids))
            await db.execute(
                f"DELETE FROM metrics WHERE job_id IN ({placeholders})",
                job_ids,
            )

            # Delete jobs
            await db.execute(
                f"DELETE FROM jobs WHERE job_id IN ({placeholders})",
                job_ids,
            )
            await db.commit()

            logger.info(f"Cleaned up {len(job_ids)} old jobs")
            return len(job_ids)

    def _row_to_job(self, row: Dict[str, Any]) -> JobRecord:
        """Convert database row to JobRecord."""
        return JobRecord(
            job_id=row["job_id"],
            status=JobStatus(row["status"]),
            config=json.loads(row["config"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row.get("started_at"),
            finished_at=row.get("finished_at"),
            error=row.get("error"),
            compute_backend=row.get("compute_backend", "local"),
            compute_job_id=row.get("compute_job_id"),
            tracker_url=row.get("tracker_url"),
            run_name=row.get("run_name"),
            model_architecture=row.get("model_architecture"),
            dataset_id=row.get("dataset_id"),
        )


# Singleton instance
_store: Optional[JobStore] = None


def get_job_store() -> JobStore:
    """Get the job store singleton.

    Returns:
        JobStore instance
    """
    global _store
    if _store is None:
        _store = JobStore()
    return _store
