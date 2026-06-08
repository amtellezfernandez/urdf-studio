"""SSH Docker compute backend for bring-your-own training machines."""

from __future__ import annotations

import asyncio
import json
import shlex
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


class SSHDockerCompute:
    """Run trainer containers on an existing SSH-accessible Docker machine."""

    name = "ssh"

    def __init__(
        self,
        output_dir: str = "/tmp/robotops-outputs",
        host: Optional[str] = None,
        user: Optional[str] = None,
        port: int = 22,
        key_path: Optional[str] = None,
        docker_image: str = "urdf-studio:robotops-training",
        docker_args: Optional[str] = None,
        use_gpu: bool = True,
        ssh_options: Optional[str] = None,
        **_: Any,
    ) -> None:
        if not host:
            raise ValueError("SSH compute requires host")
        if not user:
            raise ValueError("SSH compute requires user")

        self.host = host
        self.user = user
        self.port = int(port or 22)
        self.key_path = key_path
        self.output_dir = output_dir.rstrip("/") or "/tmp/robotops-outputs"
        self.docker_image = docker_image
        self.docker_args = docker_args or ""
        self.use_gpu = use_gpu
        self.ssh_options = ssh_options or ""
        self._jobs: Dict[str, Dict[str, Any]] = {}

    @property
    def _target(self) -> str:
        return f"{self.user}@{self.host}"

    def _ssh_base(self) -> List[str]:
        cmd = [
            "ssh",
            "-F",
            "/dev/null",
            "-p",
            str(self.port),
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ]
        if self.key_path:
            cmd.extend(["-i", str(Path(self.key_path).expanduser())])
            cmd.extend(["-o", "IdentitiesOnly=yes"])
        if self.ssh_options:
            cmd.extend(shlex.split(self.ssh_options))
        cmd.append(self._target)
        return cmd

    def _scp_base(self) -> List[str]:
        cmd = [
            "scp",
            "-F",
            "/dev/null",
            "-P",
            str(self.port),
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ]
        if self.key_path:
            cmd.extend(["-i", str(Path(self.key_path).expanduser())])
            cmd.extend(["-o", "IdentitiesOnly=yes"])
        if self.ssh_options:
            cmd.extend(shlex.split(self.ssh_options))
        return cmd

    def _ensure_job(self, job_id: str) -> Dict[str, Any]:
        if job_id not in self._jobs:
            self._jobs[job_id] = {
                "state": JobState.RUNNING,
                "remote_job_dir": f"{self.output_dir}/{job_id}",
                "container": f"robotops-{job_id}",
            }
        return self._jobs[job_id]

    async def _run_ssh(self, command: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        cmd = [*self._ssh_base(), command]
        return await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    async def _scp_to_remote(self, local_path: Path, remote_path: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        cmd = [*self._scp_base(), str(local_path), f"{self._target}:{remote_path}"]
        return await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    async def launch(
        self,
        script: str,
        config: Dict[str, Any],
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        job_id = f"ssh_{uuid.uuid4().hex[:8]}"
        container_name = f"robotops-{job_id}"
        remote_job_dir = f"{self.output_dir}/{job_id}"
        remote_config = f"{remote_job_dir}/config.json"

        mkdir = await self._run_ssh(f"mkdir -p {shlex.quote(remote_job_dir)}", timeout=30)
        if mkdir.returncode != 0:
            self._jobs[job_id] = {
                "state": JobState.FAILED,
                "error": mkdir.stderr.strip() or "Failed to create remote job directory",
                "remote_job_dir": remote_job_dir,
                "container": container_name,
            }
            return job_id

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(config, tmp, indent=2)
            tmp_path = Path(tmp.name)

        try:
            copied = await self._scp_to_remote(tmp_path, remote_config, timeout=60)
        finally:
            tmp_path.unlink(missing_ok=True)

        if copied.returncode != 0:
            self._jobs[job_id] = {
                "state": JobState.FAILED,
                "error": copied.stderr.strip() or "Failed to copy config to remote host",
                "remote_job_dir": remote_job_dir,
                "container": container_name,
            }
            return job_id

        env_args = {
            "URDF_STUDIO_JOB_ID": job_id,
            "URDF_STUDIO_JOB_DIR": f"/app/outputs/{job_id}",
            "PYTHONUNBUFFERED": "1",
        }
        if env:
            env_args.update({key: value for key, value in env.items() if value is not None})

        env_flags = " ".join(
            f"-e {shlex.quote(key)}={shlex.quote(str(value))}" for key, value in env_args.items()
        )
        gpu_flags = "--gpus all" if self.use_gpu and config.get("device") == "cuda" else ""
        docker_args = self.docker_args.strip()
        command = (
            f"docker rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true; "
            "docker run -d "
            f"--name {shlex.quote(container_name)} "
            f"{gpu_flags} "
            f"{docker_args} "
            f"-v {shlex.quote(self.output_dir)}:/app/outputs "
            f"{env_flags} "
            f"{shlex.quote(self.docker_image)} "
            "python /app/backend/scripts/train_policy.py "
            f"--config /app/outputs/{shlex.quote(job_id)}/config.json"
        )
        launched = await self._run_ssh(command, timeout=120)
        state = JobState.RUNNING if launched.returncode == 0 else JobState.FAILED
        self._jobs[job_id] = {
            "state": state,
            "error": launched.stderr.strip() if launched.returncode != 0 else None,
            "remote_job_dir": remote_job_dir,
            "container": container_name,
            "started_at": datetime.now().isoformat(),
        }
        return job_id

    async def status(self, job_id: str) -> JobStatus:
        job = self._ensure_job(job_id)

        if job.get("state") == JobState.FAILED:
            return JobStatus(job_id=job_id, state=JobState.FAILED, error_message=job.get("error"), compute_backend=self.name)

        container = job["container"]
        inspect_cmd = (
            f"docker inspect -f '{{{{.State.Status}}}} {{{{.State.ExitCode}}}} {{{{.State.Error}}}}' "
            f"{shlex.quote(container)}"
        )
        result = await self._run_ssh(inspect_cmd, timeout=30)
        state = JobState.RUNNING
        error = None
        if result.returncode != 0:
            state = JobState.FAILED
            error = result.stderr.strip() or result.stdout.strip()
        else:
            parts = result.stdout.strip().split(" ", 2)
            docker_state = parts[0] if parts else "unknown"
            exit_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            if docker_state == "running":
                state = JobState.RUNNING
            elif docker_state == "exited" and exit_code == 0:
                state = JobState.COMPLETED
            elif docker_state == "exited":
                state = JobState.FAILED
                error = f"Container exited with code {exit_code}"
            elif docker_state in {"created", "restarting"}:
                state = JobState.PENDING
            else:
                state = JobState.FAILED
                error = f"Unexpected container state: {docker_state}"

        logs_tail = await self._read_remote_tail(f"{job['remote_job_dir']}/train.log", 20)
        progress, metrics = await self._read_remote_progress(f"{job['remote_job_dir']}/progress.json")

        if state in {JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED} and not job.get("finished_at"):
            job["finished_at"] = datetime.now().isoformat()
            job["state"] = state

        return JobStatus(
            job_id=job_id,
            state=state,
            progress=progress,
            metrics=metrics,
            logs_tail=logs_tail,
            error_message=error or job.get("error"),
            started_at=job.get("started_at"),
            finished_at=job.get("finished_at"),
            compute_backend=self.name,
        )

    async def _read_remote_tail(self, remote_path: str, lines: int) -> Optional[str]:
        result = await self._run_ssh(f"test -f {shlex.quote(remote_path)} && tail -n {int(lines)} {shlex.quote(remote_path)} || true", timeout=30)
        if result.returncode != 0:
            return None
        return result.stdout or None

    async def read_job_file(self, job_id: str, relative_path: str, tail: Optional[int] = None) -> Optional[str]:
        job = self._ensure_job(job_id)
        remote_path = f"{job['remote_job_dir']}/{relative_path.lstrip('/')}"
        if tail:
            return await self._read_remote_tail(remote_path, tail)
        result = await self._run_ssh(f"test -f {shlex.quote(remote_path)} && cat {shlex.quote(remote_path)} || true", timeout=60)
        if result.returncode != 0:
            return None
        return result.stdout or None

    async def _read_remote_progress(self, remote_path: str) -> tuple[Optional[JobProgress], Dict[str, float]]:
        result = await self._run_ssh(f"test -f {shlex.quote(remote_path)} && cat {shlex.quote(remote_path)} || true", timeout=30)
        if result.returncode != 0 or not result.stdout.strip():
            return None, {}
        try:
            data = json.loads(result.stdout)
            return (
                JobProgress(
                    current_epoch=int(data.get("current_epoch", 0) or 0),
                    total_epochs=int(data.get("total_epochs", 0) or 0),
                    current_step=int(data.get("current_step", 0) or 0),
                    total_steps=int(data.get("total_steps", 0) or 0),
                ),
                data.get("metrics", {}) or {},
            )
        except (ValueError, json.JSONDecodeError):
            return None, {}

    async def logs(self, job_id: str, follow: bool = False) -> AsyncIterator[str]:
        job = self._ensure_job(job_id)
        logs = await self._read_remote_tail(f"{job['remote_job_dir']}/train.log", 200)
        if logs:
            yield logs

    async def cancel(self, job_id: str) -> bool:
        job = self._ensure_job(job_id)
        result = await self._run_ssh(f"docker rm -f {shlex.quote(job['container'])}", timeout=30)
        if result.returncode == 0:
            job["state"] = JobState.CANCELLED
            job["finished_at"] = datetime.now().isoformat()
            return True
        return False

    async def list_artifacts(self, job_id: str) -> List[JobArtifact]:
        job = self._ensure_job(job_id)
        remote_dir = job["remote_job_dir"]
        command = (
            f"test -d {shlex.quote(remote_dir)} && "
            f"find {shlex.quote(remote_dir)} -type f -printf '%P\\t%s\\t%T@\\n' || true"
        )
        result = await self._run_ssh(command, timeout=60)
        if result.returncode != 0:
            return []

        suffix_types = {
            ".safetensors": "model",
            ".pt": "checkpoint",
            ".pth": "checkpoint",
            ".ckpt": "checkpoint",
            ".json": "config",
            ".jsonl": "metrics",
            ".log": "log",
            ".mp4": "video",
        }
        artifacts: List[JobArtifact] = []
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            rel_path, size, modified = parts[0], parts[1], parts[2]
            path = Path(rel_path)
            artifacts.append(JobArtifact(
                name=path.name,
                path=rel_path,
                size_bytes=int(size),
                artifact_type=suffix_types.get(path.suffix.lower(), "file"),
                created_at=datetime.fromtimestamp(float(modified)).isoformat(),
            ))
        return sorted(artifacts, key=lambda artifact: artifact.path)

    async def download_artifact(self, job_id: str, artifact_name: str, dest: Path) -> Path:
        raise FileNotFoundError("Remote artifact download is not implemented yet")

    async def download_all_artifacts(self, job_id: str, dest: Path) -> List[Path]:
        return []

    def estimate_cost(self, config: Dict[str, Any], duration_hours: Optional[float] = None) -> Optional[float]:
        return None

    async def get_available_instances(self) -> List[Dict[str, Any]]:
        return [{"name": self.host, "device": "Remote Docker host", "available": True, "provider": "ssh", "cost_per_hour": 0}]

    async def cleanup(self, job_id: str) -> None:
        await self.cancel(job_id)
