"""Weights & Biases (W&B) experiment tracker implementation.

This tracker integrates with W&B for experiment tracking, visualization,
and artifact management. Popular in robotics research teams (OpenAI, Toyota).

Usage:
    tracker = WandBTracker(
        project="robot-training",
        entity="my-team"
    )
    run_id = tracker.init_run("my-run", config={...})
    tracker.log_metrics({"loss": 0.5}, step=100)
    tracker.finish_run()
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class WandBTracker:
    """Weights & Biases experiment tracker.

    Features:
    - Real-time metrics visualization
    - Hyperparameter tracking and comparison
    - Artifact versioning and lineage
    - Team collaboration features
    """

    name = "wandb"

    def __init__(
        self,
        project: str,
        entity: Optional[str] = None,
        mode: str = "online",
        save_code: bool = True,
        **kwargs: Any,
    ) -> None:
        """Initialize W&B tracker.

        Args:
            project: W&B project name
            entity: W&B team/user name (default: your default entity)
            mode: Run mode - "online", "offline", or "disabled"
            save_code: Whether to save code to W&B
            **kwargs: Additional W&B configuration
        """
        self._project = project
        self._entity = entity
        self._mode = mode
        self._save_code = save_code
        self._extra_config = kwargs
        self._run = None
        self._run_id: Optional[str] = None
        self._wandb = None

        self._init_wandb()

    def _init_wandb(self) -> None:
        """Lazily initialize W&B."""
        try:
            import wandb

            self._wandb = wandb
            logger.info(f"W&B initialized for project: {self._project}")

        except ImportError:
            logger.warning(
                "wandb not installed. Install with: pip install wandb"
            )
            self._wandb = None

    @property
    def name(self) -> str:
        return "wandb"

    def init_run(
        self,
        run_name: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None,
    ) -> str:
        """Start a W&B run."""
        if not self._wandb:
            return "wandb_not_available"

        # Convert tags dict to list for W&B
        tag_list = []
        if tags:
            tag_list = [f"{k}:{v}" for k, v in tags.items()]

        # Initialize the run
        self._run = self._wandb.init(
            project=self._project,
            entity=self._entity,
            name=run_name,
            config=config,
            tags=tag_list,
            mode=self._mode,
            save_code=self._save_code,
            **self._extra_config,
        )

        self._run_id = self._run.id

        logger.info(f"Started W&B run: {run_name} ({self._run_id})")
        return self._run_id

    def log_params(self, params: Dict[str, Any]) -> None:
        """Log parameters (updates W&B config)."""
        if not self._wandb or not self._run:
            return

        self._run.config.update(params)

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics to W&B."""
        if not self._wandb or not self._run:
            return

        self._run.log(metrics, step=step)

    def log_artifact(self, path: Path, artifact_name: Optional[str] = None) -> None:
        """Log artifact to W&B."""
        if not self._wandb or not self._run:
            return

        name = artifact_name or path.name

        # Determine artifact type from extension
        suffix = path.suffix.lower()
        if suffix in [".pt", ".pth", ".safetensors", ".ckpt"]:
            artifact_type = "model"
        elif suffix in [".mp4", ".avi", ".webm"]:
            artifact_type = "video"
        elif suffix in [".urdf", ".xacro"]:
            artifact_type = "robot"
        else:
            artifact_type = "artifact"

        artifact = self._wandb.Artifact(name=name, type=artifact_type)

        if path.is_file():
            artifact.add_file(str(path))
        elif path.is_dir():
            artifact.add_dir(str(path))

        self._run.log_artifact(artifact)
        logger.debug(f"Logged W&B artifact: {path} ({artifact_type})")

    def log_dataset_lineage(
        self,
        dataset_id: str,
        version: str,
        source: str,
    ) -> None:
        """Log dataset lineage as W&B config and summary."""
        if not self._wandb or not self._run:
            return

        # Update config
        self._run.config.update({
            "dataset/id": dataset_id,
            "dataset/version": version,
            "dataset/source": source,
        })

        # Also log to summary for easy filtering
        self._run.summary["dataset_id"] = dataset_id
        self._run.summary["dataset_version"] = version
        self._run.summary["dataset_source"] = source

    def log_model_config(
        self,
        architecture: str,
        config: Dict[str, Any],
    ) -> None:
        """Log model configuration to W&B."""
        if not self._wandb or not self._run:
            return

        self._run.config.update({
            "model/architecture": architecture,
            **{f"model/{k}": v for k, v in config.items()},
        })

        self._run.summary["model_architecture"] = architecture

    def log_urdf(self, urdf_path: Path, robot_name: Optional[str] = None) -> None:
        """Log URDF file as W&B artifact."""
        if not self._wandb or not self._run:
            return

        robot = robot_name or urdf_path.stem

        # Log metadata
        self._run.config.update({
            "robot/name": robot,
            "robot/urdf_path": str(urdf_path),
        })

        # Log URDF as artifact
        if urdf_path.exists():
            artifact = self._wandb.Artifact(
                name=f"urdf-{robot}",
                type="robot",
                description=f"URDF for {robot}",
            )
            artifact.add_file(str(urdf_path))
            self._run.log_artifact(artifact)

    def finish_run(self, status: str = "completed") -> None:
        """End the W&B run."""
        if not self._wandb or not self._run:
            return

        # Log final status
        self._run.summary["final_status"] = status

        # Map status to W&B exit code
        exit_code = 0 if status == "completed" else 1

        self._run.finish(exit_code=exit_code)
        logger.info(f"Ended W&B run with status: {status}")
        self._run = None

    def get_run_url(self) -> Optional[str]:
        """Get URL to view the run in W&B UI."""
        if not self._run:
            return None

        return self._run.get_url()

    def get_run_id(self) -> Optional[str]:
        """Get the current run ID."""
        return self._run_id

    # W&B-specific features

    def log_video(
        self,
        video_path: Path,
        key: str = "video",
        fps: int = 30,
        caption: Optional[str] = None,
    ) -> None:
        """Log video to W&B (robot-learning-specific feature).

        Args:
            video_path: Path to video file
            key: Metric key for the video
            fps: Frames per second
            caption: Optional caption
        """
        if not self._wandb or not self._run:
            return

        self._run.log({
            key: self._wandb.Video(str(video_path), fps=fps, caption=caption)
        })

    def log_table(
        self,
        key: str,
        columns: list,
        data: list,
    ) -> None:
        """Log a table to W&B.

        Args:
            key: Table name
            columns: Column names
            data: List of rows
        """
        if not self._wandb or not self._run:
            return

        table = self._wandb.Table(columns=columns, data=data)
        self._run.log({key: table})

    def watch_model(self, model: Any, log: str = "all", log_freq: int = 100) -> None:
        """Watch a PyTorch model for gradient/parameter logging.

        Args:
            model: PyTorch model to watch
            log: What to log - "gradients", "parameters", or "all"
            log_freq: How often to log
        """
        if not self._wandb or not self._run:
            return

        self._wandb.watch(model, log=log, log_freq=log_freq)
