"""Compute Backend Protocol - Plug-and-play interface for training compute.

This module defines the ComputeBackend protocol that allows URDF Studio to
run training jobs on different compute backends (local GPU, Modal, RunPod, etc.)
through a unified async interface.

Usage:
    from backend.robotops.compute_factory import get_compute, ComputeConfig

    compute = get_compute(ComputeConfig(type="modal", api_key="..."))
    job_id = await compute.launch(script="train.py", config={...})
    status = await compute.status(job_id)
    async for line in compute.logs(job_id):
        print(line)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Protocol, runtime_checkable


class JobState(str, Enum):
    """Training job state."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class JobProgress:
    """Training progress information."""

    current_epoch: int = 0
    total_epochs: int = 0
    current_step: int = 0
    total_steps: int = 0

    @property
    def epoch_progress(self) -> float:
        """Progress within current epoch (0.0 - 1.0)."""
        if self.total_steps == 0:
            return 0.0
        return self.current_step / self.total_steps

    @property
    def overall_progress(self) -> float:
        """Overall training progress (0.0 - 1.0)."""
        if self.total_epochs == 0:
            return 0.0
        # When current_epoch equals total_epochs, training is complete
        if self.current_epoch >= self.total_epochs:
            return 1.0
        # Otherwise, combine epoch progress with step progress
        epoch_fraction = self.current_epoch / self.total_epochs
        step_fraction = self.epoch_progress / self.total_epochs
        return min(1.0, epoch_fraction + step_fraction)


@dataclass
class JobStatus:
    """Training job status information."""

    job_id: str
    state: JobState
    progress: Optional[JobProgress] = None
    metrics: Dict[str, float] = field(default_factory=dict)
    logs_tail: Optional[str] = None
    error_message: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    compute_backend: str = "unknown"

    # Cloud-specific info
    instance_type: Optional[str] = None
    cost_estimate_usd: Optional[float] = None


@dataclass
class JobArtifact:
    """Information about a job artifact."""

    name: str
    path: str
    size_bytes: int
    artifact_type: str  # "checkpoint", "log", "video", etc.
    created_at: Optional[str] = None


@runtime_checkable
class ComputeBackend(Protocol):
    """Plug-and-play compute backend interface.

    Implement this protocol to add support for any compute backend.
    All methods are async to support cloud backends with network latency.

    Example implementation:
        class MyCloudCompute:
            name = "my_cloud"

            async def launch(self, script: str, config: Dict[str, Any]) -> str:
                # Submit job to cloud
                return "job_123"

            async def status(self, job_id: str) -> JobStatus:
                # Poll job status
                return JobStatus(job_id=job_id, state=JobState.RUNNING)

            # ... implement other methods
    """

    @property
    def name(self) -> str:
        """Backend identifier (e.g., 'local', 'modal', 'runpod')."""
        ...

    async def launch(
        self,
        script: str,
        config: Dict[str, Any],
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        """Launch a training job.

        Args:
            script: Path to training script or script content
            config: Training configuration (passed as JSON to script)
            env: Environment variables to set

        Returns:
            Job ID for tracking
        """
        ...

    async def status(self, job_id: str) -> JobStatus:
        """Get current job status.

        Args:
            job_id: Job ID from launch()

        Returns:
            Current status including state, progress, metrics
        """
        ...

    async def logs(self, job_id: str, follow: bool = False) -> AsyncIterator[str]:
        """Stream logs from the job.

        Args:
            job_id: Job ID from launch()
            follow: If True, keep streaming until job completes

        Yields:
            Log lines as they become available
        """
        ...

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running job.

        Args:
            job_id: Job ID from launch()

        Returns:
            True if cancellation was successful
        """
        ...

    async def list_artifacts(self, job_id: str) -> List[JobArtifact]:
        """List artifacts produced by a job.

        Args:
            job_id: Job ID from launch()

        Returns:
            List of artifact metadata
        """
        ...

    async def download_artifact(
        self,
        job_id: str,
        artifact_name: str,
        dest: Path,
    ) -> Path:
        """Download an artifact from the job.

        Args:
            job_id: Job ID from launch()
            artifact_name: Name of artifact to download
            dest: Destination directory

        Returns:
            Path to downloaded artifact
        """
        ...

    async def download_all_artifacts(
        self,
        job_id: str,
        dest: Path,
    ) -> List[Path]:
        """Download all artifacts from a job.

        Args:
            job_id: Job ID from launch()
            dest: Destination directory

        Returns:
            List of paths to downloaded artifacts
        """
        ...

    def estimate_cost(
        self,
        config: Dict[str, Any],
        duration_hours: Optional[float] = None,
    ) -> Optional[float]:
        """Estimate cost for a training job.

        Args:
            config: Training configuration
            duration_hours: Estimated duration (None to estimate from config)

        Returns:
            Estimated cost in USD, or None if not applicable (e.g., local)
        """
        ...

    async def get_available_instances(self) -> List[Dict[str, Any]]:
        """Get available compute instances/GPUs.

        Returns:
            List of available instance types with specs and pricing
        """
        ...

    async def cleanup(self, job_id: str) -> None:
        """Clean up resources after a job completes.

        Args:
            job_id: Job ID from launch()
        """
        ...
