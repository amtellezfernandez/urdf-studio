"""Experiment Tracker Protocol - Plug-and-play interface for experiment tracking.

This module defines the ExperimentTracker protocol that allows URDF Studio to work
with any experiment tracking backend (MLflow, W&B, Neptune, etc.) through a unified
interface.

Usage:
    from backend.robotops import get_tracker

    tracker = get_tracker(TrackerConfig(type="wandb", project="my-project"))
    run_id = tracker.init_run("my-experiment", config={"lr": 1e-4})
    tracker.log_metrics({"loss": 0.5}, step=100)
    tracker.finish_run()
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Protocol, runtime_checkable


@runtime_checkable
class ExperimentTracker(Protocol):
    """Plug-and-play experiment tracking interface.

    Implement this protocol to add support for any tracking backend.
    All methods should be safe to call even if the tracker is not initialized.

    Example implementation:
        class MyTracker:
            name = "my_tracker"

            def init_run(self, run_name: str, config: Dict[str, Any], tags: Dict[str, str] = None) -> str:
                # Initialize tracking run
                return "run_123"

            def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
                # Log metrics at step
                pass

            # ... implement other methods
    """

    @property
    def name(self) -> str:
        """Tracker identifier (e.g., 'mlflow', 'wandb', 'neptune')."""
        ...

    def init_run(
        self,
        run_name: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None,
    ) -> str:
        """Initialize a tracking run.

        Args:
            run_name: Human-readable name for the run
            config: Full configuration dict (hyperparams, dataset info, etc.)
            tags: Optional tags for filtering/grouping runs

        Returns:
            Run ID that can be used to resume or reference the run
        """
        ...

    def log_params(self, params: Dict[str, Any]) -> None:
        """Log hyperparameters.

        Args:
            params: Dictionary of parameter names to values.
                    Values can be nested dicts (will be flattened with '/' separator).
        """
        ...

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics at a given step.

        Args:
            metrics: Dictionary of metric names to values
            step: Training step or epoch number
        """
        ...

    def log_artifact(self, path: Path, artifact_name: Optional[str] = None) -> None:
        """Log a file artifact (checkpoint, config, video, etc.).

        Args:
            path: Path to the file to log
            artifact_name: Optional name for the artifact (defaults to filename)
        """
        ...

    # Robot-specific extensions

    def log_dataset_lineage(
        self,
        dataset_id: str,
        version: str,
        source: str,
    ) -> None:
        """Log the dataset used for training.

        This is a robot-learning-specific extension that ensures dataset
        provenance is always tracked.

        Args:
            dataset_id: Dataset identifier (e.g., "lerobot/aloha_sim_insertion")
            version: Dataset version (e.g., "v1.6" or commit hash)
            source: Source type ("huggingface", "local", etc.)
        """
        ...

    def log_model_config(
        self,
        architecture: str,
        config: Dict[str, Any],
    ) -> None:
        """Log the model architecture and configuration.

        Args:
            architecture: Model architecture name (e.g., "act", "diffusion_policy")
            config: Model-specific configuration dictionary
        """
        ...

    def log_urdf(self, urdf_path: Path, robot_name: Optional[str] = None) -> None:
        """Log the URDF file used for training.

        Args:
            urdf_path: Path to the URDF file
            robot_name: Optional robot name (defaults to filename)
        """
        ...

    def finish_run(self, status: str = "completed") -> None:
        """Finalize the tracking run.

        Args:
            status: Final status ("completed", "failed", "cancelled")
        """
        ...

    def get_run_url(self) -> Optional[str]:
        """Get URL to view the run in the tracker's UI.

        Returns:
            URL string or None if not available
        """
        ...

    def get_run_id(self) -> Optional[str]:
        """Get the current run ID.

        Returns:
            Run ID string or None if no run is active
        """
        ...
