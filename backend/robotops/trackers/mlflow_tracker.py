"""MLflow experiment tracker implementation.

This tracker integrates with MLflow for experiment tracking, supporting
both local file-based tracking and remote MLflow tracking servers.

Usage:
    tracker = MLflowTracker(
        tracking_uri="http://localhost:5000",
        experiment_name="robot-training"
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


class MLflowTracker:
    """MLflow experiment tracker.

    Supports:
    - Local file-based tracking (mlruns directory)
    - Remote MLflow tracking server
    - Artifact logging to local or S3/GCS/Azure
    """

    name = "mlflow"

    def __init__(
        self,
        tracking_uri: Optional[str] = None,
        experiment_name: Optional[str] = None,
        artifact_location: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Initialize MLflow tracker.

        Args:
            tracking_uri: MLflow tracking server URI (default: local ./mlruns)
            experiment_name: Name of the experiment to log to
            artifact_location: Where to store artifacts (S3/GCS/local path)
            **kwargs: Additional MLflow configuration
        """
        self._tracking_uri = tracking_uri
        self._experiment_name = experiment_name or "urdf-studio-training"
        self._artifact_location = artifact_location
        self._run = None
        self._run_id: Optional[str] = None
        self._mlflow = None

        self._init_mlflow()

    def _init_mlflow(self) -> None:
        """Lazily initialize MLflow."""
        try:
            import mlflow

            self._mlflow = mlflow

            if self._tracking_uri:
                mlflow.set_tracking_uri(self._tracking_uri)
                logger.info(f"MLflow tracking URI: {self._tracking_uri}")

            # Create or get experiment
            experiment = mlflow.get_experiment_by_name(self._experiment_name)
            if experiment is None:
                experiment_id = mlflow.create_experiment(
                    self._experiment_name,
                    artifact_location=self._artifact_location,
                )
                logger.info(f"Created MLflow experiment: {self._experiment_name}")
            else:
                experiment_id = experiment.experiment_id

            mlflow.set_experiment(experiment_id=experiment_id)

        except ImportError:
            logger.warning(
                "MLflow not installed. Install with: pip install mlflow"
            )
            self._mlflow = None

    @property
    def name(self) -> str:
        return "mlflow"

    def init_run(
        self,
        run_name: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None,
    ) -> str:
        """Start an MLflow run."""
        if not self._mlflow:
            return "mlflow_not_available"

        # Start the run
        self._run = self._mlflow.start_run(run_name=run_name)
        self._run_id = self._run.info.run_id

        # Log tags
        if tags:
            self._mlflow.set_tags(tags)

        # Log config as params (flatten nested dicts)
        flat_config = self._flatten_dict(config)
        self._mlflow.log_params(flat_config)

        logger.info(f"Started MLflow run: {run_name} ({self._run_id})")
        return self._run_id

    def _flatten_dict(
        self,
        d: Dict[str, Any],
        parent_key: str = "",
        sep: str = "/",
    ) -> Dict[str, Any]:
        """Flatten nested dictionary for MLflow params."""
        items: list = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(self._flatten_dict(v, new_key, sep=sep).items())
            else:
                # MLflow has a 500 char limit on param values
                str_val = str(v)
                if len(str_val) > 500:
                    str_val = str_val[:497] + "..."
                items.append((new_key, str_val))
        return dict(items)

    def log_params(self, params: Dict[str, Any]) -> None:
        """Log parameters to MLflow."""
        if not self._mlflow or not self._run:
            return

        flat_params = self._flatten_dict(params)
        self._mlflow.log_params(flat_params)

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics to MLflow."""
        if not self._mlflow or not self._run:
            return

        self._mlflow.log_metrics(metrics, step=step)

    def log_artifact(self, path: Path, artifact_name: Optional[str] = None) -> None:
        """Log artifact to MLflow."""
        if not self._mlflow or not self._run:
            return

        if path.is_file():
            self._mlflow.log_artifact(str(path))
        elif path.is_dir():
            self._mlflow.log_artifacts(str(path), artifact_path=artifact_name)

        logger.debug(f"Logged artifact: {path}")

    def log_dataset_lineage(
        self,
        dataset_id: str,
        version: str,
        source: str,
    ) -> None:
        """Log dataset lineage as MLflow tags and params."""
        if not self._mlflow or not self._run:
            return

        self._mlflow.set_tags({
            "dataset.id": dataset_id,
            "dataset.version": version,
            "dataset.source": source,
        })

        self._mlflow.log_params({
            "dataset/id": dataset_id,
            "dataset/version": version,
            "dataset/source": source,
        })

    def log_model_config(
        self,
        architecture: str,
        config: Dict[str, Any],
    ) -> None:
        """Log model configuration."""
        if not self._mlflow or not self._run:
            return

        self._mlflow.set_tag("model.architecture", architecture)

        flat_config = self._flatten_dict({"model": config})
        self._mlflow.log_params(flat_config)

    def log_urdf(self, urdf_path: Path, robot_name: Optional[str] = None) -> None:
        """Log URDF file and metadata."""
        if not self._mlflow or not self._run:
            return

        robot = robot_name or urdf_path.stem
        self._mlflow.set_tag("robot.name", robot)
        self._mlflow.set_tag("robot.urdf", str(urdf_path))

        if urdf_path.exists():
            self._mlflow.log_artifact(str(urdf_path))

    def finish_run(self, status: str = "completed") -> None:
        """End the MLflow run."""
        if not self._mlflow or not self._run:
            return

        # Map status to MLflow run status
        mlflow_status_map = {
            "completed": "FINISHED",
            "failed": "FAILED",
            "cancelled": "KILLED",
        }
        mlflow_status = mlflow_status_map.get(status, "FINISHED")

        self._mlflow.end_run(status=mlflow_status)
        logger.info(f"Ended MLflow run with status: {status}")
        self._run = None

    def get_run_url(self) -> Optional[str]:
        """Get URL to view the run in MLflow UI."""
        if not self._run_id or not self._tracking_uri:
            return None

        # Construct MLflow UI URL
        # Format: {tracking_uri}/#/experiments/{exp_id}/runs/{run_id}
        if self._mlflow:
            experiment = self._mlflow.get_experiment_by_name(self._experiment_name)
            if experiment:
                base = self._tracking_uri.rstrip("/")
                return f"{base}/#/experiments/{experiment.experiment_id}/runs/{self._run_id}"

        return None

    def get_run_id(self) -> Optional[str]:
        """Get the current run ID."""
        return self._run_id
