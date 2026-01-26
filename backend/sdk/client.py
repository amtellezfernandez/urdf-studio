"""URDF Studio SDK Client - Main entry point for programmatic access.

This module provides the URDFStudioClient class which is the main interface
for AI agents and automation scripts to interact with URDF Studio.

Example:
    from backend.sdk import URDFStudioClient

    async with URDFStudioClient("http://localhost:8000") as client:
        # Check health
        health = await client.health.check()

        # Run forward kinematics
        fk = await client.kinematics.forward_kinematics(urdf_xml, {"joint1": 0.5})

        # Start training
        job = await client.training.start(
            dataset="lerobot/pusht",
            model="act",
            epochs=100,
        )

        # Wait for completion
        result = await client.training.wait_for_completion(job.job_id)
"""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import httpx

from backend.sdk.models import (
    Artifact,
    ComputeBackend,
    DatasetInfo,
    EpisodeResult,
    EvaluationResult,
    FKResult,
    IKResult,
    JointSolution,
    JobStatus,
    LinkPose,
    ModelArchitecture,
    ModelInfo,
    Sample,
    SampleFile,
    SampleFiles,
    TrainingJob,
    TrainingLineage,
    TrainingMetrics,
    TrainingProgress,
    TrainingStatus,
)


class SDKError(Exception):
    """Base SDK exception."""

    pass


class ConnectionError(SDKError):
    """Failed to connect to server."""

    pass


class APIError(SDKError):
    """API returned an error."""

    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


class TimeoutError(SDKError):
    """Operation timed out."""

    pass


# ============================================================================
# Domain Clients
# ============================================================================


class HealthClient:
    """Health check operations."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def check(self) -> Dict[str, Any]:
        """Check server health.

        Returns:
            Health status dict with component availability
        """
        resp = await self._http.get("/health")
        resp.raise_for_status()
        return resp.json()

    async def is_healthy(self) -> bool:
        """Quick health check.

        Returns:
            True if server is responding
        """
        try:
            health = await self.check()
            return health.get("status") == "ok"
        except Exception:
            return False


class KinematicsClient:
    """Forward and inverse kinematics operations."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def forward_kinematics(
        self,
        urdf: str,
        joint_values: Dict[str, float],
    ) -> FKResult:
        """Compute forward kinematics.

        Args:
            urdf: URDF XML content
            joint_values: Joint name to angle mapping

        Returns:
            FKResult with link poses
        """
        resp = await self._http.post(
            "/pyroki/fk",
            json={"urdf": urdf, "joint_values": joint_values},
        )

        if resp.status_code != 200:
            return FKResult(links=[], success=False, error=resp.text)

        data = resp.json()
        links = [
            LinkPose(
                name=link["name"],
                position=link["position"],
                quaternion_wxyz=link["quaternion_wxyz"],
            )
            for link in data.get("links", [])
        ]

        return FKResult(links=links, success=True)

    async def inverse_kinematics(
        self,
        urdf: str,
        joint_values: Dict[str, float],
        target_link: str,
        target_position: List[float],
        target_orientation: Optional[List[float]] = None,
        solver: str = "pyroki",
    ) -> IKResult:
        """Compute inverse kinematics.

        Args:
            urdf: URDF XML content
            joint_values: Initial joint configuration
            target_link: Name of link to position
            target_position: Target [x, y, z] position
            target_orientation: Optional target quaternion [w, x, y, z]
            solver: IK solver to use ("pyroki" or "lerobot")

        Returns:
            IKResult with solved joint configuration
        """
        endpoint = "/lerobot/ik" if solver == "lerobot" else "/pyroki/ik"

        payload = {
            "urdf": urdf,
            "joint_values": joint_values,
            "target_link": target_link,
            "target_position": target_position,
        }
        if target_orientation:
            payload["target_orientation"] = target_orientation

        resp = await self._http.post(endpoint, json=payload)

        if resp.status_code != 200:
            return IKResult(solution=None, success=False, error=resp.text)

        data = resp.json()
        solution = None
        if data.get("solution"):
            solution = JointSolution(
                joint_values=data["solution"],
                cost=data.get("diagnostics", {}).get("cost", 0.0),
                converged=data.get("diagnostics", {}).get("converged", True),
                iterations=data.get("diagnostics", {}).get("iterations", 0),
            )

        return IKResult(
            solution=solution,
            success=data.get("success", False),
            diagnostics=data.get("diagnostics", {}),
        )

    async def list_solvers(self) -> List[Dict[str, Any]]:
        """List available IK solvers.

        Returns:
            List of solver info dicts
        """
        resp = await self._http.get("/ik/solvers")
        resp.raise_for_status()
        return resp.json().get("solvers", [])


class TrainingClient:
    """Training job management."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def list_models(self) -> List[ModelInfo]:
        """List available model architectures.

        Returns:
            List of ModelInfo for each architecture
        """
        resp = await self._http.get("/training/models")
        resp.raise_for_status()

        return [
            ModelInfo(
                name=m["name"],
                display_name=m["display_name"],
                description=m["description"],
                default_config=m.get("default_config", {}),
                config_schema=m.get("config_schema", {}),
                recommended_for=m.get("recommended_for", []),
            )
            for m in resp.json().get("models", [])
        ]

    async def get_model(self, architecture: str) -> Optional[ModelInfo]:
        """Get info for a specific model architecture.

        Args:
            architecture: Model name (e.g., "act", "diffusion_policy")

        Returns:
            ModelInfo or None if not found
        """
        resp = await self._http.get(f"/training/models/{architecture}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()

        m = resp.json()
        return ModelInfo(
            name=m["name"],
            display_name=m["display_name"],
            description=m["description"],
            default_config=m.get("default_config", {}),
            config_schema=m.get("config_schema", {}),
            recommended_for=m.get("recommended_for", []),
        )

    async def start(
        self,
        dataset: str,
        model: Union[str, ModelArchitecture] = "act",
        *,
        # Training params
        epochs: int = 100,
        batch_size: int = 32,
        learning_rate: float = 1e-4,
        # Model config
        model_config: Optional[Dict[str, Any]] = None,
        # Compute
        compute: Union[str, ComputeBackend] = "local",
        device: str = "cuda",
        gpu: Optional[str] = None,
        # Tracking
        tracker: str = "none",
        tracker_project: Optional[str] = None,
        # Output
        output_dir: str = "./outputs",
        run_name: Optional[str] = None,
        # Metadata
        robot_name: Optional[str] = None,
        urdf: Optional[str] = None,
    ) -> TrainingJob:
        """Start a training job.

        This is the main method for launching training. It provides sensible
        defaults for most parameters while allowing full customization.

        Args:
            dataset: HuggingFace dataset ID (e.g., "lerobot/pusht") or local path
            model: Model architecture name
            epochs: Number of training epochs
            batch_size: Training batch size
            learning_rate: Learning rate
            model_config: Architecture-specific configuration
            compute: Compute backend ("local", "modal", "runpod")
            device: Device for local training ("cuda", "cpu", "mps")
            gpu: GPU type for cloud training (e.g., "A100-40GB")
            tracker: Experiment tracker ("none", "mlflow", "wandb")
            tracker_project: Project name for tracker
            output_dir: Directory for checkpoints
            run_name: Optional name for this run
            robot_name: Robot name for lineage tracking
            urdf: URDF content for lineage tracking

        Returns:
            TrainingJob with job_id for status tracking

        Example:
            job = await client.training.start(
                dataset="lerobot/pusht",
                model="act",
                epochs=50,
                compute="modal",
                gpu="T4",
            )
        """
        # Determine dataset source
        is_local = dataset.startswith("/") or dataset.startswith(".")
        dataset_config = {
            "source": "local" if is_local else "huggingface",
            "repo_id": None if is_local else dataset,
            "local_path": dataset if is_local else None,
        }

        # Build request
        payload = {
            "dataset": dataset_config,
            "model": {
                "architecture": str(model.value if isinstance(model, ModelArchitecture) else model),
                "config": model_config or {},
            },
            "training": {
                "epochs": epochs,
                "batch_size": batch_size,
                "learning_rate": learning_rate,
                "output_dir": output_dir,
                "run_name": run_name,
            },
            "compute": {
                "type": str(compute.value if isinstance(compute, ComputeBackend) else compute),
                "device": device,
                "gpu": gpu,
            },
            "tracker": {
                "type": tracker,
                "project": tracker_project,
            },
            "robot_name": robot_name,
            "urdf": urdf,
        }

        resp = await self._http.post("/training/start", json=payload)

        if resp.status_code != 200:
            raise APIError(f"Failed to start training: {resp.text}", resp.status_code)

        data = resp.json()
        lineage = None
        if data.get("lineage"):
            ln = data["lineage"]
            lineage = TrainingLineage(
                dataset_source=ln["dataset_source"],
                dataset_id=ln["dataset_id"],
                model_architecture=ln["model_architecture"],
                model_config_hash=ln["model_config_hash"],
                training_config_hash=ln["training_config_hash"],
                started_at=ln["started_at"],
                dataset_version=ln.get("dataset_version"),
                robot_name=ln.get("robot_name"),
            )

        return TrainingJob(
            job_id=data["job_id"],
            success=data["success"],
            message=data["message"],
            tracker_url=data.get("tracker_url"),
            lineage=lineage,
        )

    async def get_status(self, job_id: str) -> TrainingStatus:
        """Get status of a training job.

        Args:
            job_id: Job ID from start() response

        Returns:
            TrainingStatus with current progress and metrics
        """
        resp = await self._http.get(f"/training/status/{job_id}")
        resp.raise_for_status()

        data = resp.json()

        # Parse progress
        progress = None
        if data.get("progress"):
            p = data["progress"]
            progress = TrainingProgress(
                current_epoch=p["current_epoch"],
                total_epochs=p["total_epochs"],
                current_step=p["current_step"],
                total_steps=p["total_steps"],
                epoch_progress=p.get("epoch_progress", 0.0),
                overall_progress=p.get("overall_progress", 0.0),
            )

        # Parse metrics
        metrics = None
        if data.get("metrics"):
            m = data["metrics"]
            metrics = TrainingMetrics(
                loss=m.get("loss"),
                learning_rate=m.get("learning_rate"),
                grad_norm=m.get("grad_norm"),
                additional=m.get("additional", {}),
            )

        # Parse lineage
        lineage = None
        if data.get("lineage"):
            ln = data["lineage"]
            lineage = TrainingLineage(
                dataset_source=ln["dataset_source"],
                dataset_id=ln["dataset_id"],
                model_architecture=ln["model_architecture"],
                model_config_hash=ln["model_config_hash"],
                training_config_hash=ln["training_config_hash"],
                started_at=ln["started_at"],
                dataset_version=ln.get("dataset_version"),
                robot_name=ln.get("robot_name"),
                completed_at=ln.get("completed_at"),
            )

        return TrainingStatus(
            job_id=data["job_id"],
            status=JobStatus(data["status"]),
            progress=progress,
            metrics=metrics,
            lineage=lineage,
            error=data.get("error"),
            logs_tail=data.get("logs_tail"),
            compute_backend=data.get("compute_backend", "local"),
            cost_estimate_usd=data.get("cost_estimate_usd"),
            tracker_url=data.get("tracker_url"),
        )

    async def cancel(self, job_id: str, reason: Optional[str] = None) -> bool:
        """Cancel a running training job.

        Args:
            job_id: Job ID to cancel
            reason: Optional cancellation reason

        Returns:
            True if cancelled successfully
        """
        resp = await self._http.post(
            f"/training/cancel/{job_id}",
            json={"reason": reason} if reason else {},
        )
        return resp.status_code == 200

    async def list_jobs(
        self,
        limit: int = 50,
        status: Optional[JobStatus] = None,
    ) -> List[Dict[str, Any]]:
        """List training jobs.

        Args:
            limit: Maximum jobs to return
            status: Optional status filter

        Returns:
            List of job summaries
        """
        params = {"limit": limit}
        if status:
            params["status"] = status.value

        resp = await self._http.get("/training/jobs", params=params)
        resp.raise_for_status()
        return resp.json().get("jobs", [])

    async def wait_for_completion(
        self,
        job_id: str,
        poll_interval: float = 5.0,
        timeout: Optional[float] = None,
        on_progress: Optional[callable] = None,
    ) -> TrainingStatus:
        """Wait for a training job to complete.

        This method polls the job status until it reaches a terminal state
        (completed, failed, or cancelled).

        Args:
            job_id: Job ID to monitor
            poll_interval: Seconds between status checks
            timeout: Maximum seconds to wait (None = unlimited)
            on_progress: Optional callback called with each status update

        Returns:
            Final TrainingStatus

        Raises:
            TimeoutError: If timeout exceeded

        Example:
            def show_progress(status):
                if status.progress:
                    print(f"Progress: {status.progress.percent_complete:.1f}%")

            final = await client.training.wait_for_completion(
                job.job_id,
                on_progress=show_progress,
            )
        """
        elapsed = 0.0

        while True:
            status = await self.get_status(job_id)

            if on_progress:
                on_progress(status)

            if status.is_terminal:
                return status

            if timeout and elapsed >= timeout:
                raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

    async def evaluate(
        self,
        checkpoint_path: str,
        num_episodes: int = 1,
        max_steps: int = 1000,
        urdf: Optional[str] = None,
        initial_state: Optional[Dict[str, float]] = None,
    ) -> EvaluationResult:
        """Evaluate a trained policy.

        Args:
            checkpoint_path: Path to model checkpoint
            num_episodes: Number of episodes to run
            max_steps: Maximum steps per episode
            urdf: Optional URDF for visualization
            initial_state: Optional initial joint positions

        Returns:
            EvaluationResult with action sequences
        """
        payload = {
            "checkpoint_path": checkpoint_path,
            "num_episodes": num_episodes,
            "max_steps": max_steps,
        }
        if urdf:
            payload["urdf"] = urdf
        if initial_state:
            payload["initial_state"] = initial_state

        resp = await self._http.post("/training/evaluate", json=payload)
        resp.raise_for_status()

        data = resp.json()
        episodes = [
            EpisodeResult(
                episode_index=ep["episode_index"],
                actions=ep["actions"],
                observations=ep.get("observations"),
                rewards=ep.get("rewards"),
                timestamps=ep.get("timestamps"),
            )
            for ep in data.get("episodes", [])
        ]

        return EvaluationResult(
            success=data.get("success", False),
            episodes=episodes,
            metrics=data.get("metrics", {}),
            error=data.get("error"),
        )


class SamplesClient:
    """Sample robot access."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def list(self) -> List[Sample]:
        """List available robot samples.

        Returns:
            List of Sample entries
        """
        resp = await self._http.get("/samples")
        resp.raise_for_status()

        return [
            Sample(id=s["id"], label=s["label"], urdf_path=s["urdf_path"])
            for s in resp.json().get("samples", [])
        ]

    async def get(self, sample_id: str) -> SampleFiles:
        """Get sample files by ID.

        Args:
            sample_id: Sample ID (e.g., "panda", "ur5")

        Returns:
            SampleFiles with URDF and related resources
        """
        resp = await self._http.get(f"/samples/{sample_id}")
        resp.raise_for_status()

        data = resp.json()
        files = [
            SampleFile(
                path=f["path"],
                content=base64.b64decode(f["content_base64"]),
                mime_type=f.get("mime", "application/octet-stream"),
            )
            for f in data.get("files", [])
        ]

        return SampleFiles(
            id=data["id"],
            label=data["label"],
            urdf_path=data["urdf_path"],
            files=files,
        )

    async def get_quickstart(self) -> SampleFiles:
        """Get the quickstart sample.

        Returns:
            SampleFiles for the default quickstart robot
        """
        resp = await self._http.get("/samples/quickstart")
        resp.raise_for_status()

        data = resp.json()
        files = [
            SampleFile(
                path=f["path"],
                content=base64.b64decode(f["content_base64"]),
                mime_type=f.get("mime", "application/octet-stream"),
            )
            for f in data.get("files", [])
        ]

        return SampleFiles(
            id=data["id"],
            label=data["label"],
            urdf_path=data["urdf_path"],
            files=files,
        )


class DatasetsClient:
    """Dataset operations."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def browse(self, limit: int = 20) -> List[DatasetInfo]:
        """Browse available LeRobot datasets.

        Args:
            limit: Maximum datasets to return

        Returns:
            List of DatasetInfo for available datasets
        """
        resp = await self._http.get("/datasets/browse", params={"limit": limit})

        if resp.status_code == 404:
            # Endpoint not implemented, return empty list
            return []

        resp.raise_for_status()
        data = resp.json()

        return [
            DatasetInfo(
                repo_id=d["repo_id"],
                description=d.get("description"),
                downloads=d.get("downloads"),
                likes=d.get("likes"),
                robot_type=d.get("robot_type"),
                num_episodes=d.get("num_episodes"),
                total_frames=d.get("total_frames"),
                fps=d.get("fps"),
                features=d.get("features"),
                created_at=d.get("created_at"),
                updated_at=d.get("updated_at"),
            )
            for d in data.get("datasets", [])
        ]

    async def search(self, query: str, limit: int = 20) -> List[DatasetInfo]:
        """Search for datasets by query.

        Args:
            query: Search query string
            limit: Maximum datasets to return

        Returns:
            List of matching DatasetInfo
        """
        resp = await self._http.get(
            "/datasets/search",
            params={"query": query, "limit": limit},
        )

        if resp.status_code == 404:
            # Endpoint not implemented, return empty list
            return []

        resp.raise_for_status()
        data = resp.json()

        return [
            DatasetInfo(
                repo_id=d["repo_id"],
                description=d.get("description"),
                downloads=d.get("downloads"),
                likes=d.get("likes"),
                robot_type=d.get("robot_type"),
                num_episodes=d.get("num_episodes"),
                total_frames=d.get("total_frames"),
                fps=d.get("fps"),
                features=d.get("features"),
                created_at=d.get("created_at"),
                updated_at=d.get("updated_at"),
            )
            for d in data.get("datasets", [])
        ]

    async def info(self, repo_id: str) -> Optional[DatasetInfo]:
        """Get detailed info about a dataset.

        Args:
            repo_id: HuggingFace dataset repo ID (e.g., "lerobot/pusht")

        Returns:
            DatasetInfo or None if not found
        """
        # URL encode the repo_id since it contains a slash
        resp = await self._http.get(f"/datasets/info/{repo_id}")

        if resp.status_code == 404:
            return None

        resp.raise_for_status()
        d = resp.json()

        return DatasetInfo(
            repo_id=d["repo_id"],
            description=d.get("description"),
            downloads=d.get("downloads"),
            likes=d.get("likes"),
            robot_type=d.get("robot_type"),
            num_episodes=d.get("num_episodes"),
            total_frames=d.get("total_frames"),
            fps=d.get("fps"),
            features=d.get("features"),
            created_at=d.get("created_at"),
            updated_at=d.get("updated_at"),
        )

    async def mix(
        self,
        datasets: List[str],
        output_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Mix multiple datasets together.

        Args:
            datasets: List of HuggingFace repo IDs or local paths
            output_path: Optional output directory

        Returns:
            Result dict with output_path
        """
        # Separate HF repos from local paths
        repo_ids = [d for d in datasets if not d.startswith("/")]
        local_paths = [d for d in datasets if d.startswith("/")]

        payload = {
            "repo_ids": repo_ids,
            "local_paths": local_paths,
        }
        if output_path:
            payload["output_path"] = output_path

        resp = await self._http.post("/datasets/mix", json=payload)
        resp.raise_for_status()
        return resp.json()


class ArtifactsClient:
    """Artifact management operations."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def list(self, job_id: str) -> List[Artifact]:
        """List artifacts for a training job.

        Args:
            job_id: Training job ID

        Returns:
            List of Artifact for the job
        """
        resp = await self._http.get(f"/training/artifacts/{job_id}")

        if resp.status_code == 404:
            return []

        resp.raise_for_status()
        data = resp.json()

        return [
            Artifact(
                name=a["name"],
                path=a["path"],
                size_bytes=a.get("size_bytes"),
                artifact_type=a.get("artifact_type"),
                created_at=a.get("created_at"),
                checksum=a.get("checksum"),
            )
            for a in data.get("artifacts", [])
        ]

    async def download(
        self,
        job_id: str,
        artifact_path: str,
        dest: str,
    ) -> Path:
        """Download an artifact.

        Args:
            job_id: Training job ID
            artifact_path: Path to artifact within job
            dest: Local destination directory or file path

        Returns:
            Path to downloaded file
        """
        resp = await self._http.get(
            f"/training/artifacts/{job_id}/download",
            params={"path": artifact_path},
        )

        if resp.status_code == 404:
            raise APIError(f"Artifact not found: {artifact_path}", 404)

        resp.raise_for_status()

        # Determine output path
        dest_path = Path(dest)
        if dest_path.is_dir():
            # Use artifact filename
            filename = artifact_path.split("/")[-1]
            dest_path = dest_path / filename

        # Write content
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(resp.content)

        return dest_path

    async def upload(
        self,
        job_id: str,
        artifact_path: str,
        src: str,
    ) -> Artifact:
        """Upload an artifact.

        Args:
            job_id: Training job ID
            artifact_path: Path for artifact within job
            src: Local source file path

        Returns:
            Created Artifact
        """
        src_path = Path(src)
        if not src_path.exists():
            raise SDKError(f"Source file not found: {src}")

        # Read file content
        content = src_path.read_bytes()
        content_b64 = base64.b64encode(content).decode("utf-8")

        resp = await self._http.post(
            f"/training/artifacts/{job_id}/upload",
            json={
                "path": artifact_path,
                "content_base64": content_b64,
                "filename": src_path.name,
            },
        )

        if resp.status_code == 404:
            raise APIError(f"Job not found: {job_id}", 404)

        resp.raise_for_status()
        data = resp.json()

        return Artifact(
            name=data.get("name", artifact_path),
            path=data.get("path", artifact_path),
            size_bytes=data.get("size_bytes", len(content)),
            artifact_type=data.get("artifact_type"),
            created_at=data.get("created_at"),
            checksum=data.get("checksum"),
        )


class VisualizationClient:
    """Visualization operations."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def visualize(
        self,
        episode: Dict[str, Any],
        urdf: Optional[str] = None,
        recording_name: str = "episode",
        spawn_viewer: bool = True,
        web_port: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Visualize an episode using Rerun.

        Args:
            episode: Episode data with actions/observations
            urdf: Optional URDF content
            recording_name: Name for the recording
            spawn_viewer: Whether to open desktop viewer
            web_port: Port for web viewer (if not spawning)

        Returns:
            Result dict with mode and port info
        """
        payload = {
            "episode": episode,
            "recording_name": recording_name,
            "spawn": spawn_viewer,
        }
        if urdf:
            payload["urdf"] = urdf
        if web_port:
            payload["web_port"] = web_port
            payload["serve"] = True

        resp = await self._http.post("/rerun/visualize", json=payload)
        resp.raise_for_status()
        return resp.json()


# ============================================================================
# Main Client
# ============================================================================


class URDFStudioClient:
    """URDF Studio SDK client.

    This is the main entry point for AI agents and automation scripts.
    Use the domain-specific clients for different operations.

    Example:
        async with URDFStudioClient("http://localhost:8000") as client:
            # Health check
            healthy = await client.health.is_healthy()

            # Kinematics
            fk = await client.kinematics.forward_kinematics(urdf, joints)

            # Training
            job = await client.training.start(dataset="lerobot/pusht")
            result = await client.training.wait_for_completion(job.job_id)

            # Samples
            samples = await client.samples.list()

    Attributes:
        health: Health check operations
        kinematics: Forward/inverse kinematics
        training: Training job management
        samples: Sample robot access
        datasets: Dataset operations
        artifacts: Artifact management
        visualization: Rerun visualization
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout: float = 30.0,
    ):
        """Initialize SDK client.

        Args:
            base_url: URDF Studio server URL
            timeout: Request timeout in seconds
        """
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._http: Optional[httpx.AsyncClient] = None

        # Domain clients (initialized on connect)
        self._health: Optional[HealthClient] = None
        self._kinematics: Optional[KinematicsClient] = None
        self._training: Optional[TrainingClient] = None
        self._samples: Optional[SamplesClient] = None
        self._datasets: Optional[DatasetsClient] = None
        self._artifacts: Optional[ArtifactsClient] = None
        self._visualization: Optional[VisualizationClient] = None

    async def connect(self) -> "URDFStudioClient":
        """Connect to the URDF Studio server.

        Returns:
            self for chaining

        Raises:
            ConnectionError: If server is not reachable
        """
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        )

        # Initialize domain clients
        self._health = HealthClient(self._http)
        self._kinematics = KinematicsClient(self._http)
        self._training = TrainingClient(self._http)
        self._samples = SamplesClient(self._http)
        self._datasets = DatasetsClient(self._http)
        self._artifacts = ArtifactsClient(self._http)
        self._visualization = VisualizationClient(self._http)

        # Verify connection
        try:
            if not await self._health.is_healthy():
                raise ConnectionError(f"Server at {self._base_url} is not healthy")
        except httpx.ConnectError as e:
            raise ConnectionError(f"Cannot connect to {self._base_url}: {e}")

        return self

    async def close(self) -> None:
        """Close the connection."""
        if self._http:
            await self._http.aclose()
            self._http = None

    async def __aenter__(self) -> "URDFStudioClient":
        """Async context manager entry."""
        return await self.connect()

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()

    @property
    def health(self) -> HealthClient:
        """Health check operations."""
        if not self._health:
            raise SDKError("Client not connected. Call connect() first.")
        return self._health

    @property
    def kinematics(self) -> KinematicsClient:
        """Forward/inverse kinematics operations."""
        if not self._kinematics:
            raise SDKError("Client not connected. Call connect() first.")
        return self._kinematics

    @property
    def training(self) -> TrainingClient:
        """Training job management."""
        if not self._training:
            raise SDKError("Client not connected. Call connect() first.")
        return self._training

    @property
    def samples(self) -> SamplesClient:
        """Sample robot access."""
        if not self._samples:
            raise SDKError("Client not connected. Call connect() first.")
        return self._samples

    @property
    def datasets(self) -> DatasetsClient:
        """Dataset operations."""
        if not self._datasets:
            raise SDKError("Client not connected. Call connect() first.")
        return self._datasets

    @property
    def artifacts(self) -> ArtifactsClient:
        """Artifact management operations."""
        if not self._artifacts:
            raise SDKError("Client not connected. Call connect() first.")
        return self._artifacts

    @property
    def visualization(self) -> VisualizationClient:
        """Rerun visualization."""
        if not self._visualization:
            raise SDKError("Client not connected. Call connect() first.")
        return self._visualization
