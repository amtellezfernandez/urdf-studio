"""No-op tracker for local-only runs.

This tracker logs to console and optionally to a local JSON file,
but does not send data to any external service. Useful for:
- Local development and testing
- Offline environments
- Users who don't want external tracking
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class NoopTracker:
    """No-op experiment tracker that logs locally only.

    Logs are printed to console and optionally saved to a JSON file
    in the output directory.
    """

    name = "none"

    def __init__(
        self,
        output_dir: Optional[str] = None,
        log_to_file: bool = True,
        verbose: bool = False,
        **kwargs: Any,
    ) -> None:
        """Initialize the no-op tracker.

        Args:
            output_dir: Directory to save lineage JSON (defaults to ./outputs)
            log_to_file: Whether to save a lineage JSON file
            verbose: Whether to print logs to console
            **kwargs: Ignored (for compatibility with other trackers)
        """
        self._output_dir = Path(output_dir) if output_dir else Path("./outputs")
        self._log_to_file = log_to_file
        self._verbose = verbose
        self._run_id: Optional[str] = None
        self._run_data: Dict[str, Any] = {}

    @property
    def name(self) -> str:
        return "none"

    def init_run(
        self,
        run_name: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None,
    ) -> str:
        """Initialize a local tracking run."""
        self._run_id = f"local_{uuid.uuid4().hex[:8]}"
        self._run_data = {
            "run_id": self._run_id,
            "run_name": run_name,
            "config": config,
            "tags": tags or {},
            "params": {},
            "metrics": [],
            "artifacts": [],
            "dataset_lineage": None,
            "model_config": None,
            "urdf": None,
            "started_at": datetime.now().isoformat(),
            "finished_at": None,
            "status": "running",
        }

        if self._verbose:
            logger.info(f"[NoopTracker] Started run: {run_name} ({self._run_id})")

        return self._run_id

    def log_params(self, params: Dict[str, Any]) -> None:
        """Log parameters locally."""
        if self._run_data:
            self._run_data["params"].update(params)
            if self._verbose:
                logger.info(f"[NoopTracker] Logged params: {list(params.keys())}")

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics locally."""
        if self._run_data:
            self._run_data["metrics"].append({
                "step": step,
                "metrics": metrics,
                "timestamp": datetime.now().isoformat(),
            })
            if self._verbose:
                metrics_str = ", ".join(f"{k}={v:.4f}" for k, v in metrics.items())
                logger.info(f"[NoopTracker] Step {step}: {metrics_str}")

    def log_artifact(self, path: Path, artifact_name: Optional[str] = None) -> None:
        """Log artifact path locally."""
        if self._run_data:
            artifact_info = {
                "path": str(path),
                "name": artifact_name or path.name,
                "logged_at": datetime.now().isoformat(),
            }
            self._run_data["artifacts"].append(artifact_info)
            if self._verbose:
                logger.info(f"[NoopTracker] Logged artifact: {path}")

    def log_dataset_lineage(
        self,
        dataset_id: str,
        version: str,
        source: str,
    ) -> None:
        """Log dataset lineage locally."""
        if self._run_data:
            self._run_data["dataset_lineage"] = {
                "dataset_id": dataset_id,
                "version": version,
                "source": source,
            }
            if self._verbose:
                logger.info(f"[NoopTracker] Dataset: {dataset_id} ({version})")

    def log_model_config(
        self,
        architecture: str,
        config: Dict[str, Any],
    ) -> None:
        """Log model config locally."""
        if self._run_data:
            self._run_data["model_config"] = {
                "architecture": architecture,
                "config": config,
            }
            if self._verbose:
                logger.info(f"[NoopTracker] Model: {architecture}")

    def log_urdf(self, urdf_path: Path, robot_name: Optional[str] = None) -> None:
        """Log URDF info locally."""
        if self._run_data:
            self._run_data["urdf"] = {
                "path": str(urdf_path),
                "robot_name": robot_name or urdf_path.stem,
            }
            if self._verbose:
                logger.info(f"[NoopTracker] URDF: {urdf_path}")

    def finish_run(self, status: str = "completed") -> None:
        """Finalize the run and optionally save to JSON."""
        if self._run_data:
            self._run_data["finished_at"] = datetime.now().isoformat()
            self._run_data["status"] = status

            if self._log_to_file:
                self._save_lineage()

            if self._verbose:
                logger.info(f"[NoopTracker] Finished run with status: {status}")

    def _save_lineage(self) -> None:
        """Save run data to JSON file."""
        if not self._run_data or not self._run_id:
            return

        self._output_dir.mkdir(parents=True, exist_ok=True)
        lineage_file = self._output_dir / f"lineage_{self._run_id}.json"

        with open(lineage_file, "w") as f:
            json.dump(self._run_data, f, indent=2, default=str)

        if self._verbose:
            logger.info(f"[NoopTracker] Saved lineage to: {lineage_file}")

    def get_run_url(self) -> Optional[str]:
        """Return None (no external URL for local tracking)."""
        return None

    def get_run_id(self) -> Optional[str]:
        """Return the current run ID."""
        return self._run_id
