"""RunPod compute backend for GPU training.

RunPod provides on-demand and spot GPU instances with competitive
pricing, suitable for longer training jobs.

Usage:
    compute = RunPodCompute(api_key="...")
    job_id = await compute.launch("train.py", config={...})
    status = await compute.status(job_id)

Requires: pip install runpod
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from backend.robotops.compute_protocol import (
    ComputeBackend,
    JobArtifact,
    JobProgress,
    JobState,
    JobStatus,
)

logger = logging.getLogger(__name__)


# GPU pricing estimates (USD per hour) - varies by availability
RUNPOD_GPU_PRICING = {
    "RTX 3090": 0.44,
    "RTX 4090": 0.74,
    "A40": 0.79,
    "A100 PCIe": 1.89,
    "A100 SXM": 2.09,
    "H100 PCIe": 3.99,
    "H100 SXM": 4.49,
}


class RunPodCompute:
    """RunPod GPU compute backend.

    Features:
    - On-demand and spot instances
    - Persistent volumes for checkpoints
    - SSH access for debugging
    - Template-based container deployment
    """

    name = "runpod"

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_gpu: str = "RTX 4090",
        default_template: Optional[str] = None,
        use_spot: bool = True,
        **kwargs: Any,
    ) -> None:
        """Initialize RunPod compute backend.

        Args:
            api_key: RunPod API key (or set RUNPOD_API_KEY env var)
            default_gpu: Default GPU type
            default_template: RunPod template ID for training container
            use_spot: Whether to prefer spot instances (cheaper but interruptible)
            **kwargs: Additional configuration
        """
        self._api_key = api_key or os.environ.get("RUNPOD_API_KEY")
        self._default_gpu = default_gpu
        self._default_template = default_template
        self._use_spot = use_spot

        self._runpod = None
        self._jobs: Dict[str, Dict[str, Any]] = {}

        self._init_runpod()

    def _init_runpod(self) -> None:
        """Initialize RunPod SDK."""
        try:
            import runpod

            if self._api_key:
                runpod.api_key = self._api_key

            self._runpod = runpod
            logger.info("RunPod initialized")

        except ImportError:
            logger.warning(
                "RunPod not installed. Install with: pip install runpod"
            )
            self._runpod = None

    @property
    def name(self) -> str:
        return "runpod"

    async def launch(
        self,
        script: str,
        config: Dict[str, Any],
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        """Launch training job on RunPod."""
        if not self._runpod:
            raise RuntimeError("RunPod not initialized")

        import uuid
        job_id = f"runpod_{uuid.uuid4().hex[:8]}"

        # Extract compute config
        gpu_type = config.get("compute", {}).get("gpu", self._default_gpu)

        # Store job info
        self._jobs[job_id] = {
            "config": config,
            "gpu_type": gpu_type,
            "started_at": datetime.now().isoformat(),
            "state": JobState.PENDING,
            "pod_id": None,
        }

        try:
            # In production, create RunPod pod
            # pod = self._runpod.create_pod(
            #     name=f"training-{job_id}",
            #     image_name="pytorch/pytorch:2.0.1-cuda11.8-cudnn8-runtime",
            #     gpu_type_id=gpu_type,
            #     cloud_type="SECURE" if not self._use_spot else "COMMUNITY",
            #     env={
            #         "URDF_STUDIO_JOB_ID": job_id,
            #         **(env or {}),
            #     },
            # )
            # self._jobs[job_id]["pod_id"] = pod["id"]

            self._jobs[job_id]["state"] = JobState.QUEUED
            logger.info(f"Launched RunPod job {job_id} on {gpu_type}")
            return job_id

        except Exception as e:
            logger.error(f"Failed to launch RunPod job: {e}")
            self._jobs[job_id]["state"] = JobState.FAILED
            self._jobs[job_id]["error"] = str(e)
            return job_id

    async def status(self, job_id: str) -> JobStatus:
        """Get RunPod job status."""
        if job_id not in self._jobs:
            return JobStatus(
                job_id=job_id,
                state=JobState.FAILED,
                error_message="Job not found",
                compute_backend=self.name,
            )

        job_info = self._jobs[job_id]

        # In production, query RunPod API for pod status
        state = job_info.get("state", JobState.PENDING)

        return JobStatus(
            job_id=job_id,
            state=state,
            progress=job_info.get("progress"),
            metrics=job_info.get("metrics", {}),
            error_message=job_info.get("error"),
            started_at=job_info.get("started_at"),
            finished_at=job_info.get("finished_at"),
            compute_backend=self.name,
            instance_type=job_info.get("gpu_type"),
            cost_estimate_usd=self._estimate_job_cost(job_info),
        )

    def _estimate_job_cost(self, job_info: Dict[str, Any]) -> Optional[float]:
        """Estimate job cost based on GPU and duration."""
        gpu_type = job_info.get("gpu_type", self._default_gpu)
        hourly_rate = RUNPOD_GPU_PRICING.get(gpu_type, 0.74)

        # Spot instances are typically 50-70% cheaper
        if self._use_spot:
            hourly_rate *= 0.6

        started = job_info.get("started_at")
        finished = job_info.get("finished_at")

        if started and finished:
            start_dt = datetime.fromisoformat(started)
            end_dt = datetime.fromisoformat(finished)
            hours = (end_dt - start_dt).total_seconds() / 3600
            return hours * hourly_rate

        return None

    async def logs(self, job_id: str, follow: bool = False) -> AsyncIterator[str]:
        """Stream logs from RunPod job."""
        if job_id not in self._jobs:
            yield f"Job {job_id} not found"
            return

        # In production, use RunPod's exec/logs API
        yield f"[RunPod] Job {job_id} logs would be streamed here"

    async def cancel(self, job_id: str) -> bool:
        """Cancel/terminate RunPod job."""
        if job_id not in self._jobs:
            return False

        job_info = self._jobs[job_id]

        # In production, terminate the pod
        # if job_info.get("pod_id"):
        #     self._runpod.terminate_pod(job_info["pod_id"])

        if job_info["state"] in [JobState.PENDING, JobState.QUEUED, JobState.RUNNING]:
            job_info["state"] = JobState.CANCELLED
            job_info["finished_at"] = datetime.now().isoformat()
            logger.info(f"Cancelled RunPod job {job_id}")
            return True

        return False

    async def list_artifacts(self, job_id: str) -> List[JobArtifact]:
        """List artifacts from RunPod job."""
        # In production, list files from RunPod volume
        return []

    async def download_artifact(
        self,
        job_id: str,
        artifact_name: str,
        dest: Path,
    ) -> Path:
        """Download artifact from RunPod."""
        # In production, use rsync/scp to download from pod
        raise NotImplementedError("RunPod artifact download not yet implemented")

    async def download_all_artifacts(
        self,
        job_id: str,
        dest: Path,
    ) -> List[Path]:
        """Download all artifacts from RunPod."""
        return []

    def estimate_cost(
        self,
        config: Dict[str, Any],
        duration_hours: Optional[float] = None,
    ) -> Optional[float]:
        """Estimate training cost on RunPod."""
        gpu_type = config.get("compute", {}).get("gpu", self._default_gpu)
        hourly_rate = RUNPOD_GPU_PRICING.get(gpu_type, 0.74)

        if self._use_spot:
            hourly_rate *= 0.6

        if duration_hours is None:
            epochs = config.get("training", {}).get("epochs", 100)
            duration_hours = epochs * 0.02

        return duration_hours * hourly_rate

    async def get_available_instances(self) -> List[Dict[str, Any]]:
        """Get available RunPod GPU types."""
        instances = []

        for gpu, price in RUNPOD_GPU_PRICING.items():
            instances.append({
                "name": gpu,
                "cost_per_hour": price,
                "cost_per_hour_spot": price * 0.6,
                "available": True,  # In production, check actual availability
                "provider": "runpod",
            })

        return instances

    async def cleanup(self, job_id: str) -> None:
        """Clean up RunPod job resources."""
        if job_id in self._jobs:
            job_info = self._jobs[job_id]

            # In production, terminate pod if still running
            # and clean up any volumes

            del self._jobs[job_id]
