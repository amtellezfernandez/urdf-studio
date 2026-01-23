"""RobotOps - Robot Learning Operations for URDF Studio.

This package provides plug-and-play abstractions for:
- Experiment tracking (MLflow, W&B, Neptune, etc.)
- Compute backends (Local, Modal, RunPod, etc.)

Usage:
    from backend.robotops import get_tracker, get_compute

    # Experiment tracking
    tracker = get_tracker({"type": "wandb", "project": "my-project"})
    tracker.init_run("my-run", config={...})
    tracker.log_metrics({"loss": 0.5}, step=100)

    # Compute
    compute = get_compute({"type": "local"})
    job_id = await compute.launch("train.py", config={...})
    status = await compute.status(job_id)
"""

from backend.robotops.tracker_protocol import ExperimentTracker
from backend.robotops.tracker_factory import get_tracker, TrackerConfig
from backend.robotops.compute_protocol import ComputeBackend, JobStatus, JobState
from backend.robotops.compute_factory import get_compute, ComputeConfig

__all__ = [
    # Tracker
    "ExperimentTracker",
    "get_tracker",
    "TrackerConfig",
    # Compute
    "ComputeBackend",
    "get_compute",
    "ComputeConfig",
    "JobStatus",
    "JobState",
]
