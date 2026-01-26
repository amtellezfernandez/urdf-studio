"""Evaluation service.

This service manages policy evaluations, coordinating between:
- Database persistence
- eval_policy.py subprocess execution
- Artifact storage (episodes JSON, videos)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import aiosqlite

from backend.models.evaluations import (
    AggregateMetrics,
    EpisodeResult,
    EvaluationCreate,
    EvaluationDetail,
    EvaluationListResponse,
    EvaluationResponse,
    EvaluationStatus,
)

logger = logging.getLogger(__name__)

# Database settings
DB_DIR = Path(os.environ.get("URDF_DATA_DIR", Path.home() / ".urdf-studio" / "data"))
DB_FILE = DB_DIR / "jobs.db"

# Artifacts directory
ARTIFACTS_DIR = Path(os.environ.get("URDF_ARTIFACTS_DIR", Path.home() / ".urdf-studio" / "artifacts"))


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class EvaluationRecord:
    """Stored evaluation record."""

    id: str
    run_id: str
    experiment_id: Optional[str]
    checkpoint_name: str
    checkpoint_path: Optional[str]
    num_episodes: int
    seed: Optional[int]
    max_steps: int
    environment_config: Optional[Dict[str, Any]]
    status: EvaluationStatus
    metrics: Optional[Dict[str, float]]
    error: Optional[str]
    episodes_artifact_path: Optional[str]
    video_artifact_paths: Optional[List[str]]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]


# ============================================================================
# Evaluation Store
# ============================================================================


class EvaluationStore:
    """SQLite-based evaluation persistence store."""

    def __init__(self, db_path: Optional[Path] = None):
        """Initialize the evaluation store."""
        self.db_path = db_path or DB_FILE
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialized = False

    async def _get_db(self) -> aiosqlite.Connection:
        """Get database connection."""
        db = await aiosqlite.connect(self.db_path)
        db.row_factory = aiosqlite.Row
        return db

    async def initialize(self) -> None:
        """Initialize the database schema."""
        if self._initialized:
            return

        db = await self._get_db()
        try:
            # Evaluations table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS evaluations (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    experiment_id TEXT,
                    checkpoint_name TEXT NOT NULL,
                    checkpoint_path TEXT,
                    num_episodes INTEGER NOT NULL,
                    seed INTEGER,
                    max_steps INTEGER DEFAULT 1000,
                    environment_config TEXT,
                    status TEXT NOT NULL DEFAULT 'queued',
                    metrics TEXT,
                    error TEXT,
                    episodes_artifact_path TEXT,
                    video_artifact_paths TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    FOREIGN KEY (run_id) REFERENCES jobs(job_id)
                )
            """)

            # Indexes
            await db.execute("CREATE INDEX IF NOT EXISTS idx_evaluations_run ON evaluations(run_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_evaluations_experiment ON evaluations(experiment_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_evaluations_status ON evaluations(status)")

            await db.commit()
        finally:
            await db.close()

        self._initialized = True
        logger.info(f"Initialized evaluation store at {self.db_path}")

    async def create(
        self,
        run_id: str,
        checkpoint_name: str,
        num_episodes: int,
        seed: Optional[int] = None,
        max_steps: int = 1000,
        experiment_id: Optional[str] = None,
        checkpoint_path: Optional[str] = None,
        environment_config: Optional[Dict[str, Any]] = None,
    ) -> EvaluationRecord:
        """Create a new evaluation record."""
        await self.initialize()

        eval_id = f"eval_{uuid.uuid4().hex[:12]}"
        now = datetime.now().isoformat()

        db = await self._get_db()
        try:
            await db.execute(
                """
                INSERT INTO evaluations (
                    id, run_id, experiment_id, checkpoint_name, checkpoint_path,
                    num_episodes, seed, max_steps, environment_config, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    eval_id,
                    run_id,
                    experiment_id,
                    checkpoint_name,
                    checkpoint_path,
                    num_episodes,
                    seed,
                    max_steps,
                    json.dumps(environment_config) if environment_config else None,
                    EvaluationStatus.QUEUED.value,
                    now,
                ),
            )
            await db.commit()
        finally:
            await db.close()

        logger.info(f"Created evaluation record: {eval_id}")

        return EvaluationRecord(
            id=eval_id,
            run_id=run_id,
            experiment_id=experiment_id,
            checkpoint_name=checkpoint_name,
            checkpoint_path=checkpoint_path,
            num_episodes=num_episodes,
            seed=seed,
            max_steps=max_steps,
            environment_config=environment_config,
            status=EvaluationStatus.QUEUED,
            metrics=None,
            error=None,
            episodes_artifact_path=None,
            video_artifact_paths=None,
            created_at=now,
            started_at=None,
            completed_at=None,
        )

    async def get(self, eval_id: str) -> Optional[EvaluationRecord]:
        """Get an evaluation record by ID."""
        await self.initialize()

        db = await self._get_db()
        try:
            cursor = await db.execute(
                "SELECT * FROM evaluations WHERE id = ?",
                (eval_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_record(dict(row))
        finally:
            await db.close()

    async def update(
        self,
        eval_id: str,
        status: Optional[EvaluationStatus] = None,
        metrics: Optional[Dict[str, float]] = None,
        error: Optional[str] = None,
        episodes_artifact_path: Optional[str] = None,
        video_artifact_paths: Optional[List[str]] = None,
        started_at: Optional[str] = None,
        completed_at: Optional[str] = None,
    ) -> Optional[EvaluationRecord]:
        """Update an evaluation record."""
        await self.initialize()

        updates = []
        params: List[Any] = []

        if status is not None:
            updates.append("status = ?")
            params.append(status.value)

        if metrics is not None:
            updates.append("metrics = ?")
            params.append(json.dumps(metrics))

        if error is not None:
            updates.append("error = ?")
            params.append(error)

        if episodes_artifact_path is not None:
            updates.append("episodes_artifact_path = ?")
            params.append(episodes_artifact_path)

        if video_artifact_paths is not None:
            updates.append("video_artifact_paths = ?")
            params.append(json.dumps(video_artifact_paths))

        if started_at is not None:
            updates.append("started_at = ?")
            params.append(started_at)

        if completed_at is not None:
            updates.append("completed_at = ?")
            params.append(completed_at)

        if not updates:
            return await self.get(eval_id)

        params.append(eval_id)

        db = await self._get_db()
        try:
            await db.execute(
                f"UPDATE evaluations SET {', '.join(updates)} WHERE id = ?",
                params,
            )
            await db.commit()
        finally:
            await db.close()

        return await self.get(eval_id)

    async def list(
        self,
        run_id: Optional[str] = None,
        experiment_id: Optional[str] = None,
        status: Optional[EvaluationStatus] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[EvaluationRecord]:
        """List evaluations with filters."""
        await self.initialize()

        conditions = []
        params: List[Any] = []

        if run_id is not None:
            conditions.append("run_id = ?")
            params.append(run_id)

        if experiment_id is not None:
            conditions.append("experiment_id = ?")
            params.append(experiment_id)

        if status is not None:
            conditions.append("status = ?")
            params.append(status.value)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        query = f"""
            SELECT * FROM evaluations
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])

        db = await self._get_db()
        try:
            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()
            return [self._row_to_record(dict(row)) for row in rows]
        finally:
            await db.close()

    async def count(
        self,
        run_id: Optional[str] = None,
        experiment_id: Optional[str] = None,
        status: Optional[EvaluationStatus] = None,
    ) -> int:
        """Count evaluations with filters."""
        await self.initialize()

        conditions = []
        params: List[Any] = []

        if run_id is not None:
            conditions.append("run_id = ?")
            params.append(run_id)

        if experiment_id is not None:
            conditions.append("experiment_id = ?")
            params.append(experiment_id)

        if status is not None:
            conditions.append("status = ?")
            params.append(status.value)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        db = await self._get_db()
        try:
            cursor = await db.execute(
                f"SELECT COUNT(*) FROM evaluations WHERE {where_clause}",
                params,
            )
            row = await cursor.fetchone()
            return row[0] if row else 0
        finally:
            await db.close()

    async def delete(self, eval_id: str) -> bool:
        """Delete an evaluation record."""
        await self.initialize()

        db = await self._get_db()
        try:
            cursor = await db.execute("DELETE FROM evaluations WHERE id = ?", (eval_id,))
            await db.commit()
            deleted = cursor.rowcount > 0
            if deleted:
                logger.info(f"Deleted evaluation: {eval_id}")
            return deleted
        finally:
            await db.close()

    def _row_to_record(self, row: Dict[str, Any]) -> EvaluationRecord:
        """Convert database row to EvaluationRecord."""
        return EvaluationRecord(
            id=row["id"],
            run_id=row["run_id"],
            experiment_id=row.get("experiment_id"),
            checkpoint_name=row["checkpoint_name"],
            checkpoint_path=row.get("checkpoint_path"),
            num_episodes=row["num_episodes"],
            seed=row.get("seed"),
            max_steps=row.get("max_steps", 1000),
            environment_config=json.loads(row["environment_config"]) if row.get("environment_config") else None,
            status=EvaluationStatus(row["status"]),
            metrics=json.loads(row["metrics"]) if row.get("metrics") else None,
            error=row.get("error"),
            episodes_artifact_path=row.get("episodes_artifact_path"),
            video_artifact_paths=json.loads(row["video_artifact_paths"]) if row.get("video_artifact_paths") else None,
            created_at=row["created_at"],
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
        )


# Singleton instance
_store: Optional[EvaluationStore] = None


def get_evaluation_store() -> EvaluationStore:
    """Get the evaluation store singleton."""
    global _store
    if _store is None:
        _store = EvaluationStore()
    return _store


# ============================================================================
# Service Functions
# ============================================================================


def _record_to_response(record: EvaluationRecord) -> EvaluationResponse:
    """Convert EvaluationRecord to EvaluationResponse."""
    return EvaluationResponse(
        id=record.id,
        run_id=record.run_id,
        experiment_id=record.experiment_id,
        checkpoint_name=record.checkpoint_name,
        checkpoint_path=record.checkpoint_path,
        num_episodes=record.num_episodes,
        seed=record.seed,
        max_steps=record.max_steps,
        status=record.status.value,
        metrics=record.metrics,
        error=record.error,
        episodes_artifact_path=record.episodes_artifact_path,
        video_artifact_paths=record.video_artifact_paths,
        created_at=record.created_at,
        started_at=record.started_at,
        completed_at=record.completed_at,
    )


def _find_checkpoint_path(run_id: str, checkpoint_name: str) -> Optional[str]:
    """Find the checkpoint path for a given run and checkpoint name."""
    # Look in common checkpoint locations
    base_dirs = [
        Path(os.environ.get("URDF_OUTPUTS_DIR", "./outputs")),
        ARTIFACTS_DIR / "checkpoints",
        Path.home() / ".urdf-studio" / "checkpoints",
    ]

    for base_dir in base_dirs:
        # Try direct path
        checkpoint_path = base_dir / run_id / f"{checkpoint_name}.pt"
        if checkpoint_path.exists():
            return str(checkpoint_path)

        # Try safetensors
        checkpoint_path = base_dir / run_id / f"{checkpoint_name}.safetensors"
        if checkpoint_path.exists():
            return str(checkpoint_path)

        # Try nested checkpoint directory
        checkpoint_path = base_dir / run_id / "checkpoints" / f"{checkpoint_name}.pt"
        if checkpoint_path.exists():
            return str(checkpoint_path)

    return None


async def start_evaluation(
    run_id: str,
    request: EvaluationCreate,
    experiment_id: Optional[str] = None,
) -> EvaluationResponse:
    """Start a new evaluation.

    Args:
        run_id: Training run ID
        request: Evaluation configuration
        experiment_id: Optional experiment ID

    Returns:
        Created evaluation response
    """
    store = get_evaluation_store()

    # Find checkpoint path
    checkpoint_path = _find_checkpoint_path(run_id, request.checkpoint_name)

    # Create evaluation record
    record = await store.create(
        run_id=run_id,
        checkpoint_name=request.checkpoint_name,
        num_episodes=request.num_episodes,
        seed=request.seed,
        max_steps=request.max_steps,
        experiment_id=experiment_id,
        checkpoint_path=checkpoint_path,
        environment_config=request.environment_config,
    )

    # Start evaluation in background
    asyncio.create_task(_run_evaluation(record.id, request.render_video))

    return _record_to_response(record)


async def _run_evaluation(eval_id: str, render_video: bool = True) -> None:
    """Run evaluation in background.

    Args:
        eval_id: Evaluation ID
        render_video: Whether to render video from image observations
    """
    store = get_evaluation_store()

    # Update status to running
    await store.update(
        eval_id,
        status=EvaluationStatus.RUNNING,
        started_at=datetime.now().isoformat(),
    )

    record = await store.get(eval_id)
    if not record:
        logger.error(f"Evaluation {eval_id} not found")
        return

    try:
        # Prepare output paths
        artifacts_dir = ARTIFACTS_DIR / "evaluations" / eval_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        episodes_path = artifacts_dir / "episodes.json"
        output_path = artifacts_dir / "output.json"

        # Build command
        from backend.core.paths import SCRIPTS_DIR

        script_path = SCRIPTS_DIR / "eval_policy.py"

        cmd = [
            "python3",
            str(script_path),
            "--checkpoint",
            record.checkpoint_path or "",
            "--num-episodes",
            str(record.num_episodes),
            "--max-steps",
            str(record.max_steps),
            "--output",
            str(output_path),
        ]

        if record.seed is not None:
            cmd.extend(["--seed", str(record.seed)])

        if render_video:
            cmd.append("--render-video")

        logger.info(f"Running evaluation {eval_id}: {' '.join(cmd)}")

        # Run evaluation script
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600,  # 1 hour timeout
                cwd=str(artifacts_dir),
            ),
        )

        if result.returncode != 0:
            error_msg = result.stderr or "Unknown error"
            logger.error(f"Evaluation {eval_id} failed: {error_msg}")
            await store.update(
                eval_id,
                status=EvaluationStatus.FAILED,
                error=error_msg[:1000],
                completed_at=datetime.now().isoformat(),
            )
            return

        # Parse output
        if output_path.exists():
            output_data = json.loads(output_path.read_text())
        else:
            # Try parsing from stdout
            output_data = json.loads(result.stdout)

        # Extract episodes and metrics
        episodes = output_data.get("episodes", [])
        metrics = output_data.get("metrics", {})

        # Save episodes artifact
        episodes_path.write_text(json.dumps(episodes, indent=2))

        # Check for video files
        video_paths = []
        for video_file in artifacts_dir.glob("*.mp4"):
            video_paths.append(str(video_file))

        # Calculate aggregate metrics
        if episodes:
            total_rewards = []
            episode_lengths = []
            successes = []

            for ep in episodes:
                if "rewards" in ep and ep["rewards"]:
                    total_rewards.append(sum(ep["rewards"]))
                if "actions" in ep:
                    episode_lengths.append(len(ep["actions"]))
                if "success" in ep:
                    successes.append(1 if ep["success"] else 0)

            if total_rewards:
                import statistics

                metrics["avg_return"] = statistics.mean(total_rewards)
                metrics["std_return"] = statistics.stdev(total_rewards) if len(total_rewards) > 1 else 0
                metrics["min_return"] = min(total_rewards)
                metrics["max_return"] = max(total_rewards)

            if episode_lengths:
                metrics["avg_episode_length"] = statistics.mean(episode_lengths)
                metrics["total_steps"] = sum(episode_lengths)

            if successes:
                metrics["success_rate"] = sum(successes) / len(successes)

            metrics["total_episodes"] = len(episodes)

        # Update record with results
        await store.update(
            eval_id,
            status=EvaluationStatus.COMPLETED,
            metrics=metrics,
            episodes_artifact_path=str(episodes_path),
            video_artifact_paths=video_paths if video_paths else None,
            completed_at=datetime.now().isoformat(),
        )

        logger.info(f"Evaluation {eval_id} completed successfully")

    except asyncio.TimeoutError:
        logger.error(f"Evaluation {eval_id} timed out")
        await store.update(
            eval_id,
            status=EvaluationStatus.FAILED,
            error="Evaluation timed out after 1 hour",
            completed_at=datetime.now().isoformat(),
        )

    except Exception as e:
        logger.error(f"Evaluation {eval_id} error: {e}", exc_info=True)
        await store.update(
            eval_id,
            status=EvaluationStatus.FAILED,
            error=str(e)[:1000],
            completed_at=datetime.now().isoformat(),
        )


async def get_evaluation(eval_id: str) -> Optional[EvaluationResponse]:
    """Get evaluation by ID.

    Args:
        eval_id: Evaluation ID

    Returns:
        Evaluation response or None
    """
    store = get_evaluation_store()
    record = await store.get(eval_id)
    if not record:
        return None
    return _record_to_response(record)


async def get_evaluation_detail(eval_id: str) -> Optional[EvaluationDetail]:
    """Get detailed evaluation including episode data.

    Args:
        eval_id: Evaluation ID

    Returns:
        Evaluation detail or None
    """
    store = get_evaluation_store()
    record = await store.get(eval_id)
    if not record:
        return None

    # Load episodes from artifact
    episodes = None
    if record.episodes_artifact_path:
        episodes_path = Path(record.episodes_artifact_path)
        if episodes_path.exists():
            try:
                episodes_data = json.loads(episodes_path.read_text())
                episodes = [
                    EpisodeResult(
                        episode_index=ep.get("episode_index", i),
                        actions=ep.get("actions", []),
                        observations=ep.get("observations"),
                        rewards=ep.get("rewards"),
                        timestamps=ep.get("timestamps"),
                        success=ep.get("success"),
                        total_reward=ep.get("total_reward"),
                        episode_length=ep.get("episode_length", len(ep.get("actions", []))),
                        info=ep.get("info"),
                    )
                    for i, ep in enumerate(episodes_data)
                ]
            except Exception as e:
                logger.warning(f"Failed to load episodes for {eval_id}: {e}")

    return EvaluationDetail(
        id=record.id,
        run_id=record.run_id,
        experiment_id=record.experiment_id,
        checkpoint_name=record.checkpoint_name,
        checkpoint_path=record.checkpoint_path,
        num_episodes=record.num_episodes,
        seed=record.seed,
        max_steps=record.max_steps,
        status=record.status.value,
        metrics=record.metrics,
        error=record.error,
        episodes_artifact_path=record.episodes_artifact_path,
        video_artifact_paths=record.video_artifact_paths,
        created_at=record.created_at,
        started_at=record.started_at,
        completed_at=record.completed_at,
        episodes=episodes,
        environment_config=record.environment_config,
    )


async def get_evaluation_episodes(eval_id: str) -> Optional[List[EpisodeResult]]:
    """Get episodes for an evaluation.

    Args:
        eval_id: Evaluation ID

    Returns:
        List of episode results or None
    """
    detail = await get_evaluation_detail(eval_id)
    if not detail:
        return None
    return detail.episodes


async def list_evaluations(
    run_id: Optional[str] = None,
    experiment_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> EvaluationListResponse:
    """List evaluations with filters.

    Args:
        run_id: Filter by run ID
        experiment_id: Filter by experiment ID
        status: Filter by status
        limit: Maximum results
        offset: Results offset

    Returns:
        List of evaluations
    """
    store = get_evaluation_store()

    status_filter = None
    if status:
        try:
            status_filter = EvaluationStatus(status)
        except ValueError:
            pass

    records = await store.list(
        run_id=run_id,
        experiment_id=experiment_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )

    total = await store.count(
        run_id=run_id,
        experiment_id=experiment_id,
        status=status_filter,
    )

    return EvaluationListResponse(
        evaluations=[_record_to_response(r) for r in records],
        total=total,
    )


async def delete_evaluation(eval_id: str) -> bool:
    """Delete an evaluation.

    Args:
        eval_id: Evaluation ID

    Returns:
        True if deleted
    """
    store = get_evaluation_store()

    # Get record to find artifacts
    record = await store.get(eval_id)
    if record:
        # Delete artifacts
        if record.episodes_artifact_path:
            episodes_path = Path(record.episodes_artifact_path)
            if episodes_path.exists():
                episodes_path.unlink()

        if record.video_artifact_paths:
            for video_path in record.video_artifact_paths:
                video_file = Path(video_path)
                if video_file.exists():
                    video_file.unlink()

        # Delete artifacts directory if empty
        artifacts_dir = ARTIFACTS_DIR / "evaluations" / eval_id
        if artifacts_dir.exists():
            try:
                artifacts_dir.rmdir()
            except OSError:
                pass  # Directory not empty

    return await store.delete(eval_id)
