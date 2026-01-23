"""Local compute backend for running training on the local machine.

This backend runs training jobs as subprocesses on the local machine,
using available GPUs. Suitable for development and single-machine training.

Usage:
    compute = LocalCompute(output_dir="./outputs")
    job_id = await compute.launch("train.py", config={...})
    status = await compute.status(job_id)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import subprocess
import tempfile
import uuid
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


class LocalCompute:
    """Local compute backend using subprocess.

    Runs training jobs as local processes with GPU support.
    Handles job tracking, log streaming, and artifact management.
    """

    name = "local"

    def __init__(
        self,
        output_dir: str = "./outputs",
        python_path: Optional[str] = None,
        default_env: Optional[Dict[str, str]] = None,
        **kwargs: Any,
    ) -> None:
        """Initialize local compute backend.

        Args:
            output_dir: Base directory for job outputs
            python_path: Path to Python interpreter (default: sys.executable)
            default_env: Default environment variables for all jobs
            **kwargs: Additional configuration (ignored)
        """
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)

        self._python_path = python_path or "python3"
        self._default_env = default_env or {}

        # Track running jobs: job_id -> process info
        self._jobs: Dict[str, Dict[str, Any]] = {}

    @property
    def name(self) -> str:
        return "local"

    async def launch(
        self,
        script: str,
        config: Dict[str, Any],
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        """Launch training job as subprocess."""
        job_id = f"local_{uuid.uuid4().hex[:8]}"
        job_dir = self._output_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        # Write config to file
        config_file = job_dir / "config.json"
        with open(config_file, "w") as f:
            json.dump(config, f, indent=2)

        # Prepare log files
        stdout_log = job_dir / "stdout.log"
        stderr_log = job_dir / "stderr.log"

        # Build environment
        job_env = os.environ.copy()
        job_env.update(self._default_env)
        if env:
            job_env.update(env)
        job_env["URDF_STUDIO_JOB_ID"] = job_id
        job_env["URDF_STUDIO_JOB_DIR"] = str(job_dir)

        # Build command
        script_path = Path(script)
        if script_path.exists():
            cmd = [self._python_path, str(script_path), "--config", str(config_file)]
        else:
            # Assume script is a module name
            cmd = [self._python_path, "-m", script, "--config", str(config_file)]

        # Start subprocess
        try:
            with open(stdout_log, "w") as stdout_f, open(stderr_log, "w") as stderr_f:
                process = subprocess.Popen(
                    cmd,
                    stdout=stdout_f,
                    stderr=stderr_f,
                    env=job_env,
                    cwd=job_dir,
                    start_new_session=True,  # Create new process group
                )

            self._jobs[job_id] = {
                "process": process,
                "job_dir": job_dir,
                "config_file": config_file,
                "stdout_log": stdout_log,
                "stderr_log": stderr_log,
                "started_at": datetime.now().isoformat(),
                "state": JobState.RUNNING,
            }

            logger.info(f"Launched local job {job_id} (PID: {process.pid})")
            return job_id

        except Exception as e:
            logger.error(f"Failed to launch job: {e}")
            self._jobs[job_id] = {
                "job_dir": job_dir,
                "started_at": datetime.now().isoformat(),
                "finished_at": datetime.now().isoformat(),
                "state": JobState.FAILED,
                "error": str(e),
            }
            return job_id

    async def status(self, job_id: str) -> JobStatus:
        """Get job status."""
        if job_id not in self._jobs:
            return JobStatus(
                job_id=job_id,
                state=JobState.FAILED,
                error_message="Job not found",
                compute_backend=self.name,
            )

        job_info = self._jobs[job_id]
        process = job_info.get("process")

        # Check if process is still running
        if process:
            return_code = process.poll()
            if return_code is None:
                state = JobState.RUNNING
            elif return_code == 0:
                state = JobState.COMPLETED
                job_info["state"] = state
                job_info["finished_at"] = datetime.now().isoformat()
            else:
                state = JobState.FAILED
                job_info["state"] = state
                job_info["finished_at"] = datetime.now().isoformat()
                job_info["error"] = f"Process exited with code {return_code}"
        else:
            state = job_info.get("state", JobState.FAILED)

        # Try to read progress from progress file
        progress = None
        metrics = {}
        progress_file = job_info["job_dir"] / "progress.json"
        if progress_file.exists():
            try:
                with open(progress_file) as f:
                    progress_data = json.load(f)
                    progress = JobProgress(
                        current_epoch=progress_data.get("current_epoch", 0),
                        total_epochs=progress_data.get("total_epochs", 0),
                        current_step=progress_data.get("current_step", 0),
                        total_steps=progress_data.get("total_steps", 0),
                    )
                    metrics = progress_data.get("metrics", {})
            except (json.JSONDecodeError, IOError):
                pass

        # Read last few lines of logs
        logs_tail = None
        stdout_log = job_info.get("stdout_log")
        if stdout_log and stdout_log.exists():
            try:
                with open(stdout_log) as f:
                    lines = f.readlines()
                    logs_tail = "".join(lines[-20:])  # Last 20 lines
            except IOError:
                pass

        return JobStatus(
            job_id=job_id,
            state=state,
            progress=progress,
            metrics=metrics,
            logs_tail=logs_tail,
            error_message=job_info.get("error"),
            started_at=job_info.get("started_at"),
            finished_at=job_info.get("finished_at"),
            compute_backend=self.name,
        )

    async def logs(self, job_id: str, follow: bool = False) -> AsyncIterator[str]:
        """Stream logs from the job."""
        if job_id not in self._jobs:
            yield f"Job {job_id} not found"
            return

        job_info = self._jobs[job_id]
        stdout_log = job_info.get("stdout_log")

        if not stdout_log or not stdout_log.exists():
            yield "No logs available"
            return

        # Read existing logs
        with open(stdout_log) as f:
            for line in f:
                yield line

        # If following, keep reading
        if follow:
            process = job_info.get("process")
            with open(stdout_log) as f:
                f.seek(0, 2)  # Go to end
                while process and process.poll() is None:
                    line = f.readline()
                    if line:
                        yield line
                    else:
                        await asyncio.sleep(0.1)

                # Read any remaining lines
                for line in f:
                    yield line

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running job."""
        if job_id not in self._jobs:
            return False

        job_info = self._jobs[job_id]
        process = job_info.get("process")

        if not process or process.poll() is not None:
            return False  # Already finished

        try:
            # Send SIGTERM to process group
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)

            # Wait a bit for graceful shutdown
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                process.wait()

            job_info["state"] = JobState.CANCELLED
            job_info["finished_at"] = datetime.now().isoformat()
            logger.info(f"Cancelled job {job_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to cancel job {job_id}: {e}")
            return False

    async def list_artifacts(self, job_id: str) -> List[JobArtifact]:
        """List artifacts in job directory."""
        if job_id not in self._jobs:
            return []

        job_dir = self._jobs[job_id]["job_dir"]
        artifacts = []

        # Look for common artifact patterns
        patterns = {
            "*.pt": "checkpoint",
            "*.pth": "checkpoint",
            "*.safetensors": "checkpoint",
            "*.ckpt": "checkpoint",
            "*.mp4": "video",
            "*.log": "log",
            "*.json": "config",
        }

        for pattern, artifact_type in patterns.items():
            for path in job_dir.rglob(pattern):
                if path.is_file():
                    stat = path.stat()
                    artifacts.append(JobArtifact(
                        name=path.name,
                        path=str(path),
                        size_bytes=stat.st_size,
                        artifact_type=artifact_type,
                        created_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    ))

        return artifacts

    async def download_artifact(
        self,
        job_id: str,
        artifact_name: str,
        dest: Path,
    ) -> Path:
        """Copy artifact to destination (local, so just return path)."""
        if job_id not in self._jobs:
            raise FileNotFoundError(f"Job {job_id} not found")

        job_dir = self._jobs[job_id]["job_dir"]

        # Find artifact
        for path in job_dir.rglob(artifact_name):
            if path.is_file():
                dest_path = dest / artifact_name
                dest.mkdir(parents=True, exist_ok=True)

                # Copy file
                import shutil
                shutil.copy2(path, dest_path)
                return dest_path

        raise FileNotFoundError(f"Artifact {artifact_name} not found in job {job_id}")

    async def download_all_artifacts(
        self,
        job_id: str,
        dest: Path,
    ) -> List[Path]:
        """Copy all artifacts to destination."""
        artifacts = await self.list_artifacts(job_id)
        paths = []

        for artifact in artifacts:
            try:
                path = await self.download_artifact(job_id, artifact.name, dest)
                paths.append(path)
            except FileNotFoundError:
                pass

        return paths

    def estimate_cost(
        self,
        config: Dict[str, Any],
        duration_hours: Optional[float] = None,
    ) -> Optional[float]:
        """Local compute has no cost."""
        return None

    async def get_available_instances(self) -> List[Dict[str, Any]]:
        """Return local GPU info if available."""
        instances = []

        # Check for CUDA
        try:
            import torch
            if torch.cuda.is_available():
                for i in range(torch.cuda.device_count()):
                    props = torch.cuda.get_device_properties(i)
                    instances.append({
                        "name": f"cuda:{i}",
                        "device": props.name,
                        "memory_gb": props.total_memory / (1024**3),
                        "available": True,
                        "cost_per_hour": 0,
                    })
        except ImportError:
            pass

        # Check for MPS (Apple Silicon)
        try:
            import torch
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                instances.append({
                    "name": "mps",
                    "device": "Apple Silicon",
                    "available": True,
                    "cost_per_hour": 0,
                })
        except ImportError:
            pass

        if not instances:
            instances.append({
                "name": "cpu",
                "device": "CPU",
                "available": True,
                "cost_per_hour": 0,
            })

        return instances

    async def cleanup(self, job_id: str) -> None:
        """Clean up job resources."""
        if job_id in self._jobs:
            # Ensure process is terminated
            await self.cancel(job_id)
            del self._jobs[job_id]
