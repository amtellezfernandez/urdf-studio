"""Modal compute backend for serverless GPU training.

Modal (modal.com) provides serverless GPU compute that automatically
scales up and down, with per-second billing.

Usage:
    compute = ModalCompute(api_key="...")
    job_id = await compute.launch("train.py", config={...})
    status = await compute.status(job_id)

Requires: pip install modal
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


# GPU pricing estimates (USD per hour)
MODAL_GPU_PRICING = {
    "T4": 0.59,
    "L4": 0.80,
    "A10G": 1.10,
    "A100-40GB": 2.78,
    "A100-80GB": 3.72,
    "H100": 4.76,
}


class ModalCompute:
    """Modal serverless GPU compute backend.

    Features:
    - Automatic scaling (0 to N GPUs)
    - Per-second billing
    - Built-in artifact storage
    - Automatic container management
    """

    name = "modal"

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_gpu: str = "T4",
        default_timeout_hours: float = 4.0,
        app_name: str = "urdf-studio-training",
        **kwargs: Any,
    ) -> None:
        """Initialize Modal compute backend.

        Args:
            api_key: Modal API key (or set MODAL_TOKEN_ID + MODAL_TOKEN_SECRET)
            default_gpu: Default GPU type (T4, L4, A10G, A100-40GB, A100-80GB, H100)
            default_timeout_hours: Default job timeout
            app_name: Modal app name
            **kwargs: Additional configuration
        """
        self._api_key = api_key
        self._default_gpu = default_gpu
        self._default_timeout_hours = default_timeout_hours
        self._app_name = app_name

        self._modal = None
        self._app = None
        self._jobs: Dict[str, Dict[str, Any]] = {}

        self._init_modal()

    def _init_modal(self) -> None:
        """Initialize Modal SDK."""
        try:
            import modal

            self._modal = modal

            # Create or get Modal app
            self._app = modal.App(self._app_name)

            logger.info(f"Modal initialized: {self._app_name}")

        except ImportError:
            logger.warning(
                "Modal not installed. Install with: pip install modal"
            )
            self._modal = None

    @property
    def name(self) -> str:
        return "modal"

    async def launch(
        self,
        script: str,
        config: Dict[str, Any],
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        """Launch training job on Modal."""
        if not self._modal:
            raise RuntimeError("Modal not initialized")

        import uuid
        job_id = f"modal_{uuid.uuid4().hex[:8]}"

        # Extract GPU config
        gpu_type = config.get("compute", {}).get("gpu", self._default_gpu)
        timeout_hours = config.get("compute", {}).get(
            "timeout_hours", self._default_timeout_hours
        )

        # Store job info
        self._jobs[job_id] = {
            "config": config,
            "gpu_type": gpu_type,
            "started_at": datetime.now().isoformat(),
            "state": JobState.PENDING,
            "modal_function_id": None,
        }

        try:
            # Define Modal function dynamically
            # In production, this would be a pre-defined Modal app
            image = (
                self._modal.Image.debian_slim()
                .pip_install("torch", "transformers", "lerobot")
            )

            gpu_spec = getattr(self._modal.gpu, gpu_type, self._modal.gpu.T4)()

            @self._app.function(
                image=image,
                gpu=gpu_spec,
                timeout=int(timeout_hours * 3600),
                secrets=[self._modal.Secret.from_dict(env or {})],
            )
            def run_training(script_content: str, config_json: str) -> Dict[str, Any]:
                import subprocess
                import tempfile
                import json

                # Write script and config
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".py", delete=False
                ) as f:
                    f.write(script_content)
                    script_path = f.name

                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".json", delete=False
                ) as f:
                    f.write(config_json)
                    config_path = f.name

                # Run training
                result = subprocess.run(
                    ["python", script_path, "--config", config_path],
                    capture_output=True,
                    text=True,
                )

                return {
                    "return_code": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                }

            # Read script if it's a file
            script_content = script
            if Path(script).exists():
                with open(script) as f:
                    script_content = f.read()

            # Submit job (async)
            # Note: In real implementation, use Modal's spawn() for async execution
            self._jobs[job_id]["state"] = JobState.QUEUED

            logger.info(f"Launched Modal job {job_id} on {gpu_type}")
            return job_id

        except Exception as e:
            logger.error(f"Failed to launch Modal job: {e}")
            self._jobs[job_id]["state"] = JobState.FAILED
            self._jobs[job_id]["error"] = str(e)
            return job_id

    async def status(self, job_id: str) -> JobStatus:
        """Get Modal job status."""
        if job_id not in self._jobs:
            return JobStatus(
                job_id=job_id,
                state=JobState.FAILED,
                error_message="Job not found",
                compute_backend=self.name,
            )

        job_info = self._jobs[job_id]

        # In production, query Modal API for actual status
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
        hourly_rate = MODAL_GPU_PRICING.get(gpu_type, 0.59)

        started = job_info.get("started_at")
        finished = job_info.get("finished_at")

        if started and finished:
            from datetime import datetime
            start_dt = datetime.fromisoformat(started)
            end_dt = datetime.fromisoformat(finished)
            hours = (end_dt - start_dt).total_seconds() / 3600
            return hours * hourly_rate

        return None

    async def logs(self, job_id: str, follow: bool = False) -> AsyncIterator[str]:
        """Stream logs from Modal job."""
        if job_id not in self._jobs:
            yield f"Job {job_id} not found"
            return

        # In production, use Modal's log streaming API
        yield f"[Modal] Job {job_id} logs would be streamed here"

    async def cancel(self, job_id: str) -> bool:
        """Cancel Modal job."""
        if job_id not in self._jobs:
            return False

        job_info = self._jobs[job_id]

        # In production, call Modal API to cancel
        if job_info["state"] in [JobState.PENDING, JobState.QUEUED, JobState.RUNNING]:
            job_info["state"] = JobState.CANCELLED
            job_info["finished_at"] = datetime.now().isoformat()
            logger.info(f"Cancelled Modal job {job_id}")
            return True

        return False

    async def list_artifacts(self, job_id: str) -> List[JobArtifact]:
        """List artifacts from Modal job."""
        # In production, query Modal's volume/artifact storage
        return []

    async def download_artifact(
        self,
        job_id: str,
        artifact_name: str,
        dest: Path,
    ) -> Path:
        """Download artifact from Modal."""
        raise NotImplementedError("Modal artifact download not yet implemented")

    async def download_all_artifacts(
        self,
        job_id: str,
        dest: Path,
    ) -> List[Path]:
        """Download all artifacts from Modal."""
        return []

    def estimate_cost(
        self,
        config: Dict[str, Any],
        duration_hours: Optional[float] = None,
    ) -> Optional[float]:
        """Estimate training cost on Modal."""
        gpu_type = config.get("compute", {}).get("gpu", self._default_gpu)
        hourly_rate = MODAL_GPU_PRICING.get(gpu_type, 0.59)

        if duration_hours is None:
            # Estimate based on epochs and batch size
            epochs = config.get("training", {}).get("epochs", 100)
            # Rough estimate: 0.02 hours per epoch for small models
            duration_hours = epochs * 0.02

        return duration_hours * hourly_rate

    async def get_available_instances(self) -> List[Dict[str, Any]]:
        """Get available Modal GPU types."""
        return [
            {
                "name": gpu,
                "cost_per_hour": price,
                "available": True,
                "provider": "modal",
            }
            for gpu, price in MODAL_GPU_PRICING.items()
        ]

    async def cleanup(self, job_id: str) -> None:
        """Clean up Modal job resources."""
        if job_id in self._jobs:
            del self._jobs[job_id]
