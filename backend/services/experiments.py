"""Experiments service.

This service provides CRUD operations for experiments,
which group training runs together for organization and reproducibility.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import aiosqlite

from backend.models.experiments import (
    EvaluationSummary,
    ExperimentCreate,
    ExperimentCreateResponse,
    ExperimentDetail,
    ExperimentListResponse,
    ExperimentResponse,
    ExperimentUpdate,
    JobSummary,
)
from backend.models.training import DatasetSource
from backend.services.hf_resolver import resolve_dataset_revision

logger = logging.getLogger(__name__)

# Database settings
DB_DIR = Path(os.environ.get("URDF_DATA_DIR", Path.home() / ".urdf-studio" / "data"))
DB_FILE = DB_DIR / "jobs.db"


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class ExperimentRecord:
    """Internal experiment record from database."""

    id: str
    name: str
    description: Optional[str]
    notes: Optional[str]
    tags: Optional[List[str]]
    dataset_source: str
    dataset_repo_id: Optional[str]
    dataset_local_path: Optional[str]
    dataset_version: Optional[str]
    dataset_resolved_revision: Optional[str]
    robot_name: Optional[str]
    urdf_hash: Optional[str]
    environment_config: Optional[Dict[str, Any]]
    created_at: str
    updated_at: str
    run_count: int = 0


# ============================================================================
# Experiments Service
# ============================================================================


class ExperimentsService:
    """Service for managing experiments."""

    def __init__(self, db_path: Optional[Path] = None):
        """Initialize the experiments service.

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
            # Run the experiments migration
            from backend.alembic.versions.experiments_migration import upgrade

            await upgrade(db)

        self._initialized = True
        logger.info(f"Initialized experiments service with database at {self.db_path}")

    async def _ensure_initialized(self) -> None:
        """Ensure the service is initialized."""
        if not self._initialized:
            await self._init_schema()
            self._initialized = True

    async def _init_schema(self) -> None:
        """Initialize the database schema directly."""
        async with self._get_db() as db:
            # Create experiments table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS experiments (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT,
                    notes TEXT,
                    tags TEXT,
                    dataset_source TEXT NOT NULL,
                    dataset_repo_id TEXT,
                    dataset_local_path TEXT,
                    dataset_version TEXT,
                    dataset_resolved_revision TEXT,
                    robot_name TEXT,
                    urdf_hash TEXT,
                    environment_config TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # Check if experiment_id column exists in jobs
            cursor = await db.execute("PRAGMA table_info(jobs)")
            columns = await cursor.fetchall()
            column_names = [col[1] for col in columns]

            if "experiment_id" not in column_names:
                await db.execute(
                    "ALTER TABLE jobs ADD COLUMN experiment_id TEXT REFERENCES experiments(id)"
                )
                logger.info("Added experiment_id column to jobs table")

            # Create indexes
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_jobs_experiment ON jobs(experiment_id)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_experiments_name ON experiments(name)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_experiments_created ON experiments(created_at)"
            )

            await db.commit()

    async def create_experiment(
        self, request: ExperimentCreate
    ) -> ExperimentCreateResponse:
        """Create a new experiment.

        Args:
            request: Experiment creation request

        Returns:
            Creation response with experiment details
        """
        await self._ensure_initialized()

        experiment_id = f"exp_{uuid.uuid4().hex[:12]}"
        now = datetime.now().isoformat()

        # Resolve HuggingFace dataset revision if applicable
        resolved_revision = None
        dataset_source = request.dataset.source
        if isinstance(dataset_source, DatasetSource):
            dataset_source = dataset_source.value

        if dataset_source == "huggingface" and request.dataset.repo_id:
            try:
                resolved_revision = await resolve_dataset_revision(
                    repo_id=request.dataset.repo_id,
                    revision=request.dataset.version,
                )
            except Exception as e:
                logger.warning(f"Failed to resolve dataset revision: {e}")
                resolved_revision = request.dataset.version

        # Serialize tags and environment config
        tags_json = json.dumps(request.tags) if request.tags else None
        env_config_json = (
            json.dumps(request.environment_config)
            if request.environment_config
            else None
        )

        try:
            async with self._get_db() as db:
                await db.execute(
                    """
                    INSERT INTO experiments (
                        id, name, description, notes, tags,
                        dataset_source, dataset_repo_id, dataset_local_path,
                        dataset_version, dataset_resolved_revision,
                        robot_name, urdf_hash, environment_config,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        experiment_id,
                        request.name,
                        request.description,
                        request.notes,
                        tags_json,
                        dataset_source,
                        request.dataset.repo_id,
                        request.dataset.local_path,
                        request.dataset.version,
                        resolved_revision,
                        request.robot_name,
                        request.urdf_hash,
                        env_config_json,
                        now,
                        now,
                    ),
                )
                await db.commit()

            logger.info(f"Created experiment: {experiment_id} ({request.name})")

            experiment = ExperimentResponse(
                id=experiment_id,
                name=request.name,
                description=request.description,
                notes=request.notes,
                tags=request.tags,
                dataset_source=dataset_source,
                dataset_repo_id=request.dataset.repo_id,
                dataset_local_path=request.dataset.local_path,
                dataset_version=request.dataset.version,
                dataset_resolved_revision=resolved_revision,
                robot_name=request.robot_name,
                run_count=0,
                created_at=now,
                updated_at=now,
            )

            return ExperimentCreateResponse(
                success=True,
                experiment=experiment,
                message=f"Experiment '{request.name}' created successfully",
                resolved_revision=resolved_revision,
            )

        except aiosqlite.IntegrityError as e:
            if "UNIQUE constraint failed" in str(e):
                return ExperimentCreateResponse(
                    success=False,
                    experiment=None,
                    message=f"Experiment with name '{request.name}' already exists",
                )
            raise

    async def get_experiment(self, experiment_id: str) -> Optional[ExperimentDetail]:
        """Get an experiment by ID with its runs.

        Args:
            experiment_id: Experiment ID

        Returns:
            Experiment details with runs, or None if not found
        """
        await self._ensure_initialized()

        async with self._get_db() as db:
            # Get experiment
            cursor = await db.execute(
                "SELECT * FROM experiments WHERE id = ?",
                (experiment_id,),
            )
            row = await cursor.fetchone()

            if not row:
                return None

            experiment = self._row_to_experiment(dict(row))

            # Get runs (jobs) for this experiment
            runs_cursor = await db.execute(
                """
                SELECT job_id, status, run_name, model_architecture,
                       started_at, finished_at, compute_backend
                FROM jobs
                WHERE experiment_id = ?
                ORDER BY created_at DESC
                """,
                (experiment_id,),
            )
            runs_rows = await runs_cursor.fetchall()

            runs = [
                JobSummary(
                    job_id=r["job_id"],
                    status=r["status"],
                    run_name=r["run_name"],
                    model_architecture=r["model_architecture"],
                    started_at=r["started_at"],
                    finished_at=r["finished_at"],
                    compute_backend=r["compute_backend"] or "local",
                )
                for r in runs_rows
            ]

            # For now, evaluations are empty (future feature)
            evaluations: List[EvaluationSummary] = []

            return ExperimentDetail(
                id=experiment.id,
                name=experiment.name,
                description=experiment.description,
                notes=experiment.notes,
                tags=experiment.tags,
                dataset_source=experiment.dataset_source,
                dataset_repo_id=experiment.dataset_repo_id,
                dataset_local_path=experiment.dataset_local_path,
                dataset_version=experiment.dataset_version,
                dataset_resolved_revision=experiment.dataset_resolved_revision,
                robot_name=experiment.robot_name,
                urdf_hash=experiment.urdf_hash,
                environment_config=experiment.environment_config,
                run_count=len(runs),
                created_at=experiment.created_at,
                updated_at=experiment.updated_at,
                runs=runs,
                evaluations=evaluations,
            )

    async def list_experiments(
        self,
        page: int = 1,
        page_size: int = 20,
        search: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> ExperimentListResponse:
        """List experiments with pagination.

        Args:
            page: Page number (1-indexed)
            page_size: Items per page
            search: Optional search query (matches name or description)
            tags: Optional tag filter

        Returns:
            Paginated list of experiments
        """
        await self._ensure_initialized()

        offset = (page - 1) * page_size

        async with self._get_db() as db:
            # Build query
            conditions = []
            params: List[Any] = []

            if search:
                conditions.append(
                    "(name LIKE ? OR description LIKE ?)"
                )
                search_pattern = f"%{search}%"
                params.extend([search_pattern, search_pattern])

            if tags:
                # Match any of the provided tags
                tag_conditions = []
                for tag in tags:
                    tag_conditions.append("tags LIKE ?")
                    params.append(f'%"{tag}"%')
                conditions.append(f"({' OR '.join(tag_conditions)})")

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            # Get total count
            count_cursor = await db.execute(
                f"SELECT COUNT(*) FROM experiments WHERE {where_clause}",
                params,
            )
            count_row = await count_cursor.fetchone()
            total = count_row[0] if count_row else 0

            # Get experiments with run counts
            query = f"""
                SELECT e.*,
                       (SELECT COUNT(*) FROM jobs WHERE experiment_id = e.id) as run_count
                FROM experiments e
                WHERE {where_clause}
                ORDER BY e.created_at DESC
                LIMIT ? OFFSET ?
            """
            params.extend([page_size, offset])

            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()

            experiments = []
            for row in rows:
                row_dict = dict(row)
                run_count = row_dict.pop("run_count", 0)
                exp = self._row_to_experiment(row_dict)
                experiments.append(
                    ExperimentResponse(
                        id=exp.id,
                        name=exp.name,
                        description=exp.description,
                        notes=exp.notes,
                        tags=exp.tags,
                        dataset_source=exp.dataset_source,
                        dataset_repo_id=exp.dataset_repo_id,
                        dataset_local_path=exp.dataset_local_path,
                        dataset_version=exp.dataset_version,
                        dataset_resolved_revision=exp.dataset_resolved_revision,
                        robot_name=exp.robot_name,
                        run_count=run_count,
                        created_at=exp.created_at,
                        updated_at=exp.updated_at,
                    )
                )

            return ExperimentListResponse(
                experiments=experiments,
                total=total,
                page=page,
                page_size=page_size,
            )

    async def update_experiment(
        self, experiment_id: str, request: ExperimentUpdate
    ) -> Optional[ExperimentResponse]:
        """Update an experiment.

        Args:
            experiment_id: Experiment ID
            request: Update request

        Returns:
            Updated experiment or None if not found
        """
        await self._ensure_initialized()

        # Build update query dynamically
        updates = ["updated_at = ?"]
        params: List[Any] = [datetime.now().isoformat()]

        if request.name is not None:
            updates.append("name = ?")
            params.append(request.name)

        if request.description is not None:
            updates.append("description = ?")
            params.append(request.description)

        if request.notes is not None:
            updates.append("notes = ?")
            params.append(request.notes)

        if request.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(request.tags))

        params.append(experiment_id)

        async with self._get_db() as db:
            try:
                await db.execute(
                    f"UPDATE experiments SET {', '.join(updates)} WHERE id = ?",
                    params,
                )
                await db.commit()

                # Fetch updated experiment
                cursor = await db.execute(
                    """
                    SELECT e.*,
                           (SELECT COUNT(*) FROM jobs WHERE experiment_id = e.id) as run_count
                    FROM experiments e
                    WHERE e.id = ?
                    """,
                    (experiment_id,),
                )
                row = await cursor.fetchone()

                if not row:
                    return None

                row_dict = dict(row)
                run_count = row_dict.pop("run_count", 0)
                exp = self._row_to_experiment(row_dict)

                return ExperimentResponse(
                    id=exp.id,
                    name=exp.name,
                    description=exp.description,
                    notes=exp.notes,
                    tags=exp.tags,
                    dataset_source=exp.dataset_source,
                    dataset_repo_id=exp.dataset_repo_id,
                    dataset_local_path=exp.dataset_local_path,
                    dataset_version=exp.dataset_version,
                    dataset_resolved_revision=exp.dataset_resolved_revision,
                    robot_name=exp.robot_name,
                    run_count=run_count,
                    created_at=exp.created_at,
                    updated_at=exp.updated_at,
                )

            except aiosqlite.IntegrityError as e:
                if "UNIQUE constraint failed" in str(e):
                    raise ValueError(
                        f"Experiment with name '{request.name}' already exists"
                    )
                raise

    async def delete_experiment(self, experiment_id: str) -> bool:
        """Delete an experiment.

        Note: This will unlink jobs from the experiment but not delete them.

        Args:
            experiment_id: Experiment ID

        Returns:
            True if deleted
        """
        await self._ensure_initialized()

        async with self._get_db() as db:
            # Unlink jobs from experiment
            await db.execute(
                "UPDATE jobs SET experiment_id = NULL WHERE experiment_id = ?",
                (experiment_id,),
            )

            # Delete experiment
            cursor = await db.execute(
                "DELETE FROM experiments WHERE id = ?",
                (experiment_id,),
            )
            await db.commit()

            deleted = cursor.rowcount > 0
            if deleted:
                logger.info(f"Deleted experiment: {experiment_id}")

            return deleted

    async def link_job_to_experiment(
        self, job_id: str, experiment_id: str
    ) -> bool:
        """Link a job to an experiment.

        Args:
            job_id: Job ID
            experiment_id: Experiment ID

        Returns:
            True if linked successfully
        """
        await self._ensure_initialized()

        async with self._get_db() as db:
            cursor = await db.execute(
                "UPDATE jobs SET experiment_id = ? WHERE job_id = ?",
                (experiment_id, job_id),
            )
            await db.commit()

            return cursor.rowcount > 0

    async def get_unassigned_jobs(
        self, limit: int = 50
    ) -> List[JobSummary]:
        """Get jobs that are not assigned to any experiment.

        Args:
            limit: Maximum jobs to return

        Returns:
            List of unassigned job summaries
        """
        await self._ensure_initialized()

        async with self._get_db() as db:
            cursor = await db.execute(
                """
                SELECT job_id, status, run_name, model_architecture,
                       started_at, finished_at, compute_backend
                FROM jobs
                WHERE experiment_id IS NULL
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = await cursor.fetchall()

            return [
                JobSummary(
                    job_id=r["job_id"],
                    status=r["status"],
                    run_name=r["run_name"],
                    model_architecture=r["model_architecture"],
                    started_at=r["started_at"],
                    finished_at=r["finished_at"],
                    compute_backend=r["compute_backend"] or "local",
                )
                for r in rows
            ]

    def _row_to_experiment(self, row: Dict[str, Any]) -> ExperimentRecord:
        """Convert database row to ExperimentRecord."""
        tags = None
        if row.get("tags"):
            try:
                tags = json.loads(row["tags"])
            except json.JSONDecodeError:
                tags = None

        env_config = None
        if row.get("environment_config"):
            try:
                env_config = json.loads(row["environment_config"])
            except json.JSONDecodeError:
                env_config = None

        return ExperimentRecord(
            id=row["id"],
            name=row["name"],
            description=row.get("description"),
            notes=row.get("notes"),
            tags=tags,
            dataset_source=row["dataset_source"],
            dataset_repo_id=row.get("dataset_repo_id"),
            dataset_local_path=row.get("dataset_local_path"),
            dataset_version=row.get("dataset_version"),
            dataset_resolved_revision=row.get("dataset_resolved_revision"),
            robot_name=row.get("robot_name"),
            urdf_hash=row.get("urdf_hash"),
            environment_config=env_config,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


# ============================================================================
# Singleton Instance
# ============================================================================

_service: Optional[ExperimentsService] = None


def get_experiments_service() -> ExperimentsService:
    """Get the experiments service singleton.

    Returns:
        ExperimentsService instance
    """
    global _service
    if _service is None:
        _service = ExperimentsService()
    return _service
