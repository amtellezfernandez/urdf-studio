"""Training orchestration service.

This service manages training jobs, coordinating between:
- Compute backends (local, Modal, RunPod)
- Experiment trackers (MLflow, W&B)
- Job state management
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.models.training import (
    ComputeConfig,
    DatasetConfig,
    EpisodeResult,
    EvaluateRequest,
    EvaluateResponse,
    JobStatus,
    ModelArchitecture,
    ModelArchitectureInfo,
    ModelConfig,
    ModelsListResponse,
    TrackerConfig,
    TrainingJobsListResponse,
    TrainingJobSummary,
    TrainingLineage,
    TrainingMetrics,
    TrainingParams,
    TrainingPreflightCheck,
    TrainingPreflightResponse,
    TrainingProgress,
    TrainingStartRequest,
    TrainingStartResponse,
    TrainingStatusResponse,
)
from backend.robotops import get_compute
from backend.robotops.compute_protocol import JobState
from backend.services.job_store import get_job_store, JobRecord
from backend.services.hf_resolver import resolve_dataset_revision

logger = logging.getLogger(__name__)

# Flag to track if we've loaded jobs from the store
_jobs_loaded = False


# ============================================================================
# Model Architecture Definitions
# ============================================================================

MODEL_ARCHITECTURES: Dict[str, ModelArchitectureInfo] = {
    "act": ModelArchitectureInfo(
        name="act",
        display_name="ACT (Action Chunking Transformer)",
        description="Transformer-based policy that predicts action chunks. Good for manipulation tasks.",
        default_config={
            "chunk_size": 100,
            "hidden_dim": 512,
            "dim_feedforward": 3200,
            "n_heads": 8,
            "n_encoder_layers": 4,
            "n_decoder_layers": 7,
            "dropout": 0.1,
        },
        config_schema={
            "chunk_size": {"type": "int", "min": 1, "max": 1000, "default": 100},
            "hidden_dim": {"type": "int", "options": [256, 512, 768, 1024]},
            "n_encoder_layers": {"type": "int", "min": 1, "max": 12},
            "n_decoder_layers": {"type": "int", "min": 1, "max": 12},
        },
        recommended_for=["manipulation", "bimanual", "precise tasks"],
    ),
    "diffusion_policy": ModelArchitectureInfo(
        name="diffusion_policy",
        display_name="Diffusion Policy",
        description="Denoising diffusion for action prediction. Robust to multimodal demonstrations.",
        default_config={
            "horizon": 16,
            "n_obs_steps": 2,
            "n_action_steps": 8,
            "num_inference_steps": 10,
            "noise_scheduler": "ddpm",
        },
        config_schema={
            "horizon": {"type": "int", "min": 1, "max": 64},
            "n_obs_steps": {"type": "int", "min": 1, "max": 16},
            "n_action_steps": {"type": "int", "min": 1, "max": 32},
            "num_inference_steps": {"type": "int", "min": 1, "max": 100},
        },
        recommended_for=["diverse demonstrations", "multimodal behavior"],
    ),
    "tdmpc": ModelArchitectureInfo(
        name="tdmpc",
        display_name="TD-MPC",
        description="Temporal Difference Model Predictive Control. Good for complex dynamics.",
        default_config={
            "horizon": 5,
            "latent_dim": 512,
            "mlp_dim": 512,
            "num_q": 5,
        },
        config_schema={
            "horizon": {"type": "int", "min": 1, "max": 20},
            "latent_dim": {"type": "int", "options": [256, 512, 1024]},
        },
        recommended_for=["long-horizon tasks", "model-based control"],
    ),
    "vq_bet": ModelArchitectureInfo(
        name="vq_bet",
        display_name="VQ-BeT",
        description="Vector-Quantized Behavior Transformer. Discrete action space learning.",
        default_config={
            "n_clusters": 512,
            "hidden_dim": 384,
            "n_heads": 8,
            "n_layers": 6,
        },
        config_schema={
            "n_clusters": {"type": "int", "options": [256, 512, 1024]},
            "hidden_dim": {"type": "int", "options": [256, 384, 512]},
        },
        recommended_for=["discrete actions", "behavior cloning"],
    ),
}


# ============================================================================
# Job Storage (In-memory cache backed by SQLite persistence)
# ============================================================================

_jobs: Dict[str, Dict[str, Any]] = {}


async def _ensure_jobs_loaded() -> None:
    """Load active jobs from persistent store on first access."""
    global _jobs_loaded

    if _jobs_loaded:
        return

    try:
        store = get_job_store()
        # Load running and pending jobs from database
        active_statuses = [JobStatus.RUNNING, JobStatus.PENDING, JobStatus.QUEUED]

        for status in active_statuses:
            jobs = await store.list_jobs(status=status, limit=100)
            for job_record in jobs:
                if job_record.job_id not in _jobs:
                    _jobs[job_record.job_id] = {
                        "compute_job_id": job_record.compute_job_id,
                        "compute_backend": job_record.compute_backend,
                        "tracker": None,  # Cannot restore tracker state
                        "tracker_url": job_record.tracker_url,
                        "lineage": None,  # Would need to restore from config
                        "request": None,  # Would need to restore from config
                        "status": job_record.status,
                        "started_at": job_record.started_at,
                        "config": job_record.config,
                    }
                    logger.info(f"Loaded job from store: {job_record.job_id} (status: {job_record.status})")

        _jobs_loaded = True
        logger.info(f"Loaded {len(_jobs)} active jobs from persistent store")

    except Exception as e:
        logger.warning(f"Failed to load jobs from store: {e}")
        _jobs_loaded = True  # Don't retry on failure


async def _persist_job(job_id: str, job_info: Dict[str, Any]) -> None:
    """Persist job state to the store."""
    try:
        store = get_job_store()

        # Check if job exists
        existing = await store.get_job(job_id)

        if existing is None:
            # Create new job record
            request = job_info.get("request")
            lineage = job_info.get("lineage")

            config = {}
            if request:
                config = {
                    "dataset": request.dataset.model_dump() if hasattr(request.dataset, 'model_dump') else {},
                    "model": request.model.model_dump() if hasattr(request.model, 'model_dump') else {},
                    "training": request.training.model_dump() if hasattr(request.training, 'model_dump') else {},
                }
                # Include resolved dataset revision if available
                if job_info.get("resolved_revision"):
                    config["dataset"]["resolved_revision"] = job_info.get("resolved_revision")

            await store.create_job(
                job_id=job_id,
                config=config,
                compute_backend=job_info.get("compute_backend", "local"),
                compute_job_id=job_info.get("compute_job_id"),
                run_name=request.training.run_name if request and request.training else None,
                model_architecture=lineage.model_architecture if lineage else None,
                dataset_id=lineage.dataset_id if lineage else None,
            )

            status = job_info.get("status")
            if status:
                await store.update_job(job_id, status=status, error=job_info.get("error"))

            # Update with tracker URL if available
            if job_info.get("tracker_url"):
                await store.update_job(job_id, tracker_url=job_info.get("tracker_url"))

            # Link to experiment if specified
            experiment_id = job_info.get("experiment_id")
            if experiment_id:
                await _link_job_to_experiment(job_id, experiment_id)

        else:
            # Update existing job
            status = job_info.get("status")
            await store.update_job(
                job_id=job_id,
                status=status,
                error=job_info.get("error"),
                finished_at=job_info.get("finished_at"),
                tracker_url=job_info.get("tracker_url"),
                compute_job_id=job_info.get("compute_job_id"),
            )

    except Exception as e:
        logger.error(f"Failed to persist job {job_id}: {e}")


async def _link_job_to_experiment(job_id: str, experiment_id: str) -> None:
    """Link a job to an experiment in the database."""
    try:
        from backend.services.experiments import get_experiments_service
        service = get_experiments_service()
        await service.link_job_to_experiment(job_id, experiment_id)
        logger.info(f"Linked job {job_id} to experiment {experiment_id}")
    except Exception as e:
        logger.warning(f"Failed to link job {job_id} to experiment {experiment_id}: {e}")


# ============================================================================
# Service Functions
# ============================================================================


def _hash_config(config: Dict[str, Any]) -> str:
    """Create a hash of configuration for lineage tracking."""
    config_str = json.dumps(config, sort_keys=True, default=str)
    return hashlib.sha256(config_str.encode()).hexdigest()[:12]


def _get_enum_value(value) -> str:
    """Get string value from enum or string."""
    return value.value if hasattr(value, "value") else str(value)


def _coerce_job_status(status: Any, default: JobStatus = JobStatus.RUNNING) -> JobStatus:
    """Convert stored enum/string status values into the API enum."""
    if isinstance(status, JobStatus):
        return status
    try:
        return JobStatus(status)
    except (TypeError, ValueError):
        return default


def _get_training_output_dir(job_info: Dict[str, Any], default: str = "./outputs") -> str:
    """Resolve the configured output directory from live request or persisted config."""
    request = job_info.get("request")
    if request and hasattr(request, "training"):
        return request.training.output_dir

    config = job_info.get("config") or {}
    training_config = config.get("training") or {}
    return training_config.get("output_dir", default)


def _metrics_response(raw_metrics: Dict[str, Any]) -> Optional[TrainingMetrics]:
    """Convert raw metric values to the API shape, ignoring non-numeric metadata."""
    if not raw_metrics:
        return None

    numeric_metrics = {
        k: v
        for k, v in raw_metrics.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    if not numeric_metrics:
        return None

    return TrainingMetrics(
        loss=numeric_metrics.get("loss"),
        learning_rate=numeric_metrics.get("learning_rate"),
        grad_norm=numeric_metrics.get("grad_norm"),
        additional={
            k: v
            for k, v in numeric_metrics.items()
            if k not in ["loss", "learning_rate", "grad_norm"]
        },
    )


def _create_lineage(
    request: TrainingStartRequest,
    started_at: str,
) -> TrainingLineage:
    """Create lineage record for a training job."""
    dataset_id = request.dataset.repo_id or request.dataset.local_path or "unknown"

    return TrainingLineage(
        dataset_source=_get_enum_value(request.dataset.source),
        dataset_id=dataset_id,
        dataset_version=request.dataset.version,
        model_architecture=_get_enum_value(request.model.architecture),
        model_config_hash=_hash_config(request.model.config),
        training_config_hash=_hash_config(request.training.model_dump()),
        robot_name=request.robot_name,
        urdf_hash=_hash_config({"urdf": request.urdf}) if request.urdf else None,
        started_at=started_at,
    )


def _preflight_check(
    name: str,
    label: str,
    status: str,
    message: str,
    details: Optional[Dict[str, Any]] = None,
) -> TrainingPreflightCheck:
    return TrainingPreflightCheck(
        name=name,
        label=label,
        status=status,
        message=message,
        details=details or {},
    )


def _bytes_to_gb(value: int) -> float:
    return round(value / (1024**3), 2)


def _resolve_output_parent(output_dir: str) -> Path:
    output_path = Path(output_dir).expanduser()
    parent = output_path if output_path.exists() and output_path.is_dir() else output_path.parent
    if not str(parent):
        parent = Path(".")
    return parent.resolve()


async def preflight_training(request: TrainingStartRequest) -> TrainingPreflightResponse:
    """Validate whether the selected training configuration can be launched."""
    compute_backend = _get_enum_value(request.compute.type)
    device = request.compute.device
    checks: List[TrainingPreflightCheck] = []

    if compute_backend != "local":
        checks.append(
            _preflight_check(
                "compute_backend",
                "Compute backend",
                "fail",
                (
                    f"{compute_backend} launch is not production-ready in this release. "
                    "Run RobotOps on the target GPU machine and select local compute, "
                    "or wait for the SSH/EC2 Docker adapter."
                ),
                {"requested_backend": compute_backend},
            )
        )
        return TrainingPreflightResponse(
            compute_backend=compute_backend,
            device=device,
            ready=False,
            can_train_locally=False,
            cloud_required=True,
            recommendation="Use local compute on the machine running RobotOps, or configure the planned SSH/EC2 adapter in a later release.",
            checks=checks,
        )

    checks.append(
        _preflight_check(
            "compute_backend",
            "Compute backend",
            "pass",
            "Training will run on the machine that is running the RobotOps backend.",
            {"backend": compute_backend},
        )
    )

    checks.append(
        _preflight_check(
            "python",
            "Python runtime",
            "pass",
            f"Using {sys.executable}",
            {"python": sys.executable, "version": sys.version.split()[0]},
        )
    )

    docker_path = shutil.which("docker")
    if docker_path:
        docker_status = "pass"
        docker_message = f"Docker found at {docker_path}"
        docker_details: Dict[str, Any] = {"path": docker_path}
        try:
            result = subprocess.run(
                [docker_path, "info", "--format", "{{.DockerRootDir}}"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if result.returncode == 0:
                docker_details["root_dir"] = result.stdout.strip()
            else:
                docker_status = "warn"
                docker_message = "Docker is installed but the daemon is not reachable."
                docker_details["stderr"] = result.stderr.strip()
        except Exception as exc:
            docker_status = "warn"
            docker_message = f"Docker is installed but could not be inspected: {exc}"
        checks.append(
            _preflight_check(
                "docker",
                "Docker runtime",
                docker_status,
                docker_message,
                docker_details,
            )
        )
    else:
        checks.append(
            _preflight_check(
                "docker",
                "Docker runtime",
                "warn",
                "Docker is not installed on this backend machine. Current local launch can still run as a subprocess, but production local/cloud training should use Docker.",
            )
        )

    try:
        import torch

        torch_details: Dict[str, Any] = {"torch_version": torch.__version__}
        if device == "cuda":
            if torch.cuda.is_available():
                gpu_names = []
                total_memory_gb = []
                for index in range(torch.cuda.device_count()):
                    props = torch.cuda.get_device_properties(index)
                    gpu_names.append(props.name)
                    total_memory_gb.append(_bytes_to_gb(props.total_memory))
                checks.append(
                    _preflight_check(
                        "device",
                        "Training device",
                        "pass",
                        f"CUDA is available with {torch.cuda.device_count()} GPU(s).",
                        {
                            **torch_details,
                            "device_count": torch.cuda.device_count(),
                            "gpu_names": gpu_names,
                            "memory_gb": total_memory_gb,
                        },
                    )
                )
            else:
                checks.append(
                    _preflight_check(
                        "device",
                        "Training device",
                        "fail",
                        "CUDA was selected but no CUDA GPU is visible to PyTorch.",
                        torch_details,
                    )
                )
        elif device == "mps":
            mps_available = bool(
                hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            )
            checks.append(
                _preflight_check(
                    "device",
                    "Training device",
                    "pass" if mps_available else "fail",
                    "Apple MPS is available." if mps_available else "MPS was selected but is not available.",
                    torch_details,
                )
            )
        elif device == "cpu":
            checks.append(
                _preflight_check(
                    "device",
                    "Training device",
                    "warn",
                    "CPU training is available but may be slow for embodied policy training.",
                    torch_details,
                )
            )
        else:
            checks.append(
                _preflight_check(
                    "device",
                    "Training device",
                    "fail",
                    f"Unsupported device '{device}'.",
                    torch_details,
                )
            )
    except Exception as exc:
        checks.append(
            _preflight_check(
                "torch",
                "PyTorch runtime",
                "fail",
                f"PyTorch could not be imported: {exc}",
            )
        )

    try:
        import lerobot  # noqa: F401

        checks.append(
            _preflight_check(
                "lerobot",
                "LeRobot runtime",
                "pass",
                "LeRobot is importable in the backend runtime.",
            )
        )
    except Exception as exc:
        checks.append(
            _preflight_check(
                "lerobot",
                "LeRobot runtime",
                "fail",
                f"LeRobot could not be imported: {exc}",
            )
        )

    dataset_source = _get_enum_value(request.dataset.source)
    if dataset_source == "huggingface":
        if request.dataset.repo_id:
            checks.append(
                _preflight_check(
                    "dataset",
                    "Dataset",
                    "pass",
                    f"HuggingFace dataset selected: {request.dataset.repo_id}",
                    {"repo_id": request.dataset.repo_id, "version": request.dataset.version},
                )
            )
        else:
            checks.append(
                _preflight_check(
                    "dataset",
                    "Dataset",
                    "fail",
                    "HuggingFace dataset source requires a repo ID.",
                )
            )
    elif dataset_source == "local":
        if request.dataset.local_path and Path(request.dataset.local_path).expanduser().exists():
            checks.append(
                _preflight_check(
                    "dataset",
                    "Dataset",
                    "pass",
                    f"Local dataset path exists: {request.dataset.local_path}",
                    {"local_path": request.dataset.local_path},
                )
            )
        else:
            checks.append(
                _preflight_check(
                    "dataset",
                    "Dataset",
                    "fail",
                    "Local dataset path does not exist on the backend machine.",
                    {"local_path": request.dataset.local_path},
                )
            )

    try:
        output_parent = _resolve_output_parent(request.training.output_dir)
        if output_parent.exists():
            usage = shutil.disk_usage(output_parent)
            free_gb = _bytes_to_gb(usage.free)
            status = "pass"
            message = f"{free_gb} GB free at {output_parent}"
            if free_gb < 5:
                status = "fail"
                message = f"Only {free_gb} GB free at {output_parent}."
            elif free_gb < 20:
                status = "warn"
                message = f"{free_gb} GB free at {output_parent}; checkpoints can fill this quickly."
            checks.append(
                _preflight_check(
                    "storage",
                    "Artifact storage",
                    status,
                    message,
                    {
                        "path": str(output_parent),
                        "free_gb": free_gb,
                        "total_gb": _bytes_to_gb(usage.total),
                    },
                )
            )
        else:
            checks.append(
                _preflight_check(
                    "storage",
                    "Artifact storage",
                    "fail",
                    f"Output parent directory does not exist: {output_parent}",
                    {"path": str(output_parent)},
                )
            )
    except Exception as exc:
        checks.append(
            _preflight_check(
                "storage",
                "Artifact storage",
                "fail",
                f"Could not inspect output storage: {exc}",
            )
        )

    tracker_type = _get_enum_value(request.tracker.type)
    if tracker_type == "none":
        checks.append(
            _preflight_check(
                "tracker",
                "Experiment tracker",
                "pass",
                "Tracker disabled; metrics and artifacts will remain RobotOps-native.",
            )
        )
    elif tracker_type == "mlflow":
        status = "pass" if request.tracker.tracking_uri else "warn"
        checks.append(
            _preflight_check(
                "tracker",
                "Experiment tracker",
                status,
                "MLflow tracking URI configured." if request.tracker.tracking_uri else "MLflow selected without a tracking URI; environment defaults will be used if available.",
                {"tracking_uri": request.tracker.tracking_uri},
            )
        )
    elif tracker_type == "wandb":
        has_key = bool(os.environ.get("WANDB_API_KEY"))
        checks.append(
            _preflight_check(
                "tracker",
                "Experiment tracker",
                "pass" if has_key else "warn",
                "W&B API key is available." if has_key else "W&B selected but WANDB_API_KEY is not set in the backend environment.",
                {"project": request.tracker.project, "entity": request.tracker.entity},
            )
        )

    has_failures = any(check.status == "fail" for check in checks)
    can_train_locally = not has_failures
    recommendation = (
        "Ready to launch on this backend machine."
        if can_train_locally
        else "Fix failed checks or run RobotOps on a machine with suitable compute."
    )

    return TrainingPreflightResponse(
        compute_backend=compute_backend,
        device=device,
        ready=can_train_locally,
        can_train_locally=can_train_locally,
        cloud_required=False,
        recommendation=recommendation,
        checks=checks,
    )


async def start_training(request: TrainingStartRequest) -> TrainingStartResponse:
    """Start a new training job.

    Args:
        request: Training configuration

    Returns:
        Response with job ID and status
    """
    # Ensure jobs are loaded from persistent store
    await _ensure_jobs_loaded()

    job_id = f"train_{uuid.uuid4().hex[:8]}"
    started_at = datetime.now().isoformat()

    logger.info(f"Starting training job {job_id}")

    try:
        compute_backend = _get_enum_value(request.compute.type)
        preflight = await preflight_training(request)
        if not preflight.ready:
            failed_checks = [
                f"{check.label}: {check.message}"
                for check in preflight.checks
                if check.status == "fail"
            ]
            detail = "; ".join(failed_checks) or preflight.recommendation
            raise ValueError(f"Training preflight failed. {detail}")

        # Create lineage
        lineage = _create_lineage(request, started_at)

        # Prepare experiment tracker config for the training process. The
        # subprocess owns tracker initialization so metrics and artifacts land in
        # one run instead of splitting orchestration and training into duplicates.
        tracker_config = {
            "type": _get_enum_value(request.tracker.type),
            "tracking_uri": request.tracker.tracking_uri,
            "experiment_name": request.tracker.experiment_name,
            "project": request.tracker.project,
            "entity": request.tracker.entity,
            "output_dir": request.training.output_dir,
        }
        # Initialize compute backend
        compute_config = {
            "type": _get_enum_value(request.compute.type),
            "api_key": request.compute.api_key,
            "default_gpu": request.compute.gpu,
            "output_dir": request.training.output_dir,
        }
        compute = get_compute(compute_config)

        # Prepare training config for script
        training_config = {
            "job_id": job_id,
            "dataset": request.dataset.model_dump(),
            "model": request.model.model_dump(),
            "training": request.training.model_dump(),
            "tracker": tracker_config,
            "compute": request.compute.model_dump(),
            "device": request.compute.device,
        }

        # Launch training job
        from backend.core.paths import SCRIPTS_DIR

        script_path = SCRIPTS_DIR / "train_policy.py"

        # For local compute, we'll use subprocess
        # For cloud, this would submit to Modal/RunPod
        compute_job_id = await compute.launch(
            script=str(script_path),
            config=training_config,
            env={
                "URDF_STUDIO_JOB_ID": job_id,
                "PYTHONUNBUFFERED": "1",
                "HF_TOKEN": os.environ.get("HF_TOKEN", ""),
                "HUGGINGFACE_TOKEN": os.environ.get("HUGGINGFACE_TOKEN", ""),
            },
        )

        # Store job info in memory
        _jobs[job_id] = {
            "compute_job_id": compute_job_id,
            "compute_backend": compute_backend,
            "tracker": None,
            "tracker_url": None,
            "lineage": lineage,
            "request": request,
            "status": JobStatus.RUNNING,
            "started_at": started_at,
            "experiment_id": request.experiment_id,
        }

        # Persist to database
        await _persist_job(job_id, _jobs[job_id])

        return TrainingStartResponse(
            success=True,
            job_id=job_id,
            message=f"Training started on {compute_backend}",
            tracker_url=None,
            lineage=lineage,
        )

    except Exception as e:
        logger.error(f"Failed to start training: {e}")

        _jobs[job_id] = {
            "status": JobStatus.FAILED,
            "error": str(e),
            "started_at": started_at,
            "finished_at": datetime.now().isoformat(),
            "experiment_id": request.experiment_id,
        }

        # Persist failed job
        await _persist_job(job_id, _jobs[job_id])

        return TrainingStartResponse(
            success=False,
            job_id=job_id,
            message=f"Failed to start training: {e}",
        )


async def _status_from_artifacts(
    job_id: str,
    job_info: Dict[str, Any],
    default_status: JobStatus,
    error: Optional[str] = None,
) -> TrainingStatusResponse:
    """Build status from persisted training artifacts when process state is unavailable."""
    job_dir = await _resolve_job_dir(job_id)
    progress_path = job_dir / "progress.json"
    final_model_dir = job_dir / "final_model"

    progress = None
    metrics = None
    raw_metrics: Dict[str, Any] = {}
    status = default_status

    if progress_path.exists():
        try:
            with open(progress_path) as f:
                progress_data = json.load(f)

            current_step = int(progress_data.get("current_step", 0) or 0)
            total_steps = int(progress_data.get("total_steps", 0) or 0)
            current_epoch = int(progress_data.get("current_epoch", 0) or 0)
            total_epochs = int(progress_data.get("total_epochs", 0) or 0)

            progress = TrainingProgress(
                current_epoch=current_epoch,
                total_epochs=total_epochs,
                current_step=current_step,
                total_steps=total_steps,
                epoch_progress=(current_step / total_steps) if total_steps else 0.0,
                overall_progress=(current_step / total_steps) if total_steps else 0.0,
            )
            raw_metrics = progress_data.get("metrics", {}) or {}
            metrics = _metrics_response(raw_metrics)

            if total_steps and current_step >= total_steps and final_model_dir.exists():
                status = JobStatus.COMPLETED
                error = None
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            logger.debug(f"Failed to read artifact progress for {job_id}: {exc}")

    logs_info = await get_job_logs(job_id, tail=20)
    logs_tail = logs_info.get("logs", "")
    if "Training completed successfully" in logs_tail and final_model_dir.exists():
        status = JobStatus.COMPLETED
        error = None

    old_status = _coerce_job_status(job_info.get("status"), default_status)
    if status != old_status:
        job_info["status"] = status
        if status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            job_info["finished_at"] = job_info.get("finished_at") or datetime.now().isoformat()
        await _persist_job(job_id, job_info)

    return TrainingStatusResponse(
        job_id=job_id,
        status=status,
        progress=progress,
        metrics=metrics,
        tracker_url=job_info.get("tracker_url"),
        lineage=job_info.get("lineage"),
        error=error,
        logs_tail=logs_tail or None,
        compute_backend=job_info.get("compute_backend", "local"),
    )


async def get_training_status(job_id: str) -> TrainingStatusResponse:
    """Get status of a training job.

    Args:
        job_id: Job ID to check

    Returns:
        Current status of the job
    """
    # Ensure jobs are loaded from persistent store
    await _ensure_jobs_loaded()

    # Try to load from store if not in memory
    if job_id not in _jobs:
        try:
            store = get_job_store()
            job_record = await store.get_job(job_id)
            if job_record:
                _jobs[job_id] = {
                    "compute_job_id": job_record.compute_job_id,
                    "compute_backend": job_record.compute_backend,
                    "tracker": None,
                    "tracker_url": job_record.tracker_url,
                    "lineage": None,
                    "request": None,
                    "status": job_record.status,
                    "started_at": job_record.started_at,
                    "finished_at": job_record.finished_at,
                    "error": job_record.error,
                    "config": job_record.config,
                }
        except Exception as e:
            logger.warning(f"Failed to load job {job_id} from store: {e}")

    if job_id not in _jobs:
        return TrainingStatusResponse(
            job_id=job_id,
            status=JobStatus.FAILED,
            error="Job not found",
            compute_backend="unknown",
        )

    job_info = _jobs[job_id]

    # If job failed during startup, still inspect artifacts first. A restarted
    # backend can lose local process memory while the job artifacts show success.
    if _coerce_job_status(job_info.get("status"), JobStatus.RUNNING) == JobStatus.FAILED:
        artifact_status = await _status_from_artifacts(
            job_id,
            job_info,
            default_status=JobStatus.FAILED,
            error=job_info.get("error"),
        )
        if artifact_status.status != JobStatus.FAILED or artifact_status.progress:
            return artifact_status

        return TrainingStatusResponse(
            job_id=job_id,
            status=JobStatus.FAILED,
            error=job_info.get("error"),
            compute_backend=job_info.get("compute_backend", "unknown"),
        )

    # Get status from compute backend
    try:
        compute_config = {
            "type": job_info.get("compute_backend", "local"),
            "output_dir": _get_training_output_dir(job_info),
        }
        compute = get_compute(compute_config)

        compute_status = await compute.status(job_info["compute_job_id"])

        if (
            compute_status.state == JobState.FAILED
            and compute_status.error_message == "Job not found"
        ):
            return await _status_from_artifacts(
                job_id,
                job_info,
                default_status=_coerce_job_status(job_info.get("status"), JobStatus.RUNNING),
                error=compute_status.error_message,
            )

        # Map compute status to job status
        status_map = {
            JobState.PENDING: JobStatus.PENDING,
            JobState.QUEUED: JobStatus.QUEUED,
            JobState.RUNNING: JobStatus.RUNNING,
            JobState.COMPLETED: JobStatus.COMPLETED,
            JobState.FAILED: JobStatus.FAILED,
            JobState.CANCELLED: JobStatus.CANCELLED,
        }
        status = status_map.get(compute_status.state, JobStatus.RUNNING)

        # Update stored status
        old_status = job_info.get("status")
        job_info["status"] = status
        if status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            job_info["finished_at"] = datetime.now().isoformat()
            # Finish tracker run
            tracker = job_info.get("tracker")
            if tracker:
                tracker.finish_run(_get_enum_value(status))

        # Persist status change to database
        if old_status != status:
            await _persist_job(job_id, job_info)

        # Build progress
        progress = None
        if compute_status.progress:
            progress = TrainingProgress(
                current_epoch=compute_status.progress.current_epoch,
                total_epochs=compute_status.progress.total_epochs,
                current_step=compute_status.progress.current_step,
                total_steps=compute_status.progress.total_steps,
                epoch_progress=compute_status.progress.epoch_progress,
                overall_progress=compute_status.progress.overall_progress,
            )

        # Build metrics
        metrics = _metrics_response(compute_status.metrics)

        return TrainingStatusResponse(
            job_id=job_id,
            status=status,
            progress=progress,
            metrics=metrics,
            tracker_url=job_info.get("tracker_url"),
            lineage=job_info.get("lineage"),
            error=compute_status.error_message,
            logs_tail=compute_status.logs_tail,
            compute_backend=job_info.get("compute_backend", "local"),
            cost_estimate_usd=compute_status.cost_estimate_usd,
        )

    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        return TrainingStatusResponse(
            job_id=job_id,
            status=job_info.get("status", JobStatus.RUNNING),
            error=str(e),
            compute_backend=job_info.get("compute_backend", "unknown"),
        )


async def cancel_training(job_id: str, reason: Optional[str] = None) -> bool:
    """Cancel a running training job.

    Args:
        job_id: Job ID to cancel
        reason: Optional cancellation reason

    Returns:
        True if cancelled successfully
    """
    if job_id not in _jobs:
        return False

    job_info = _jobs[job_id]

    try:
        compute_config = {"type": job_info.get("compute_backend", "local")}
        compute = get_compute(compute_config)

        cancelled = await compute.cancel(job_info["compute_job_id"])

        if cancelled:
            job_info["status"] = JobStatus.CANCELLED
            job_info["finished_at"] = datetime.now().isoformat()
            job_info["cancel_reason"] = reason

            # Finish tracker run
            tracker = job_info.get("tracker")
            if tracker:
                tracker.finish_run("cancelled")

            # Persist cancellation
            await _persist_job(job_id, job_info)

            logger.info(f"Cancelled job {job_id}: {reason}")

        return cancelled

    except Exception as e:
        logger.error(f"Error cancelling job: {e}")
        return False


async def list_jobs(
    limit: int = 50,
    status_filter: Optional[JobStatus] = None,
) -> TrainingJobsListResponse:
    """List training jobs.

    Args:
        limit: Maximum jobs to return
        status_filter: Optional status filter

    Returns:
        List of job summaries
    """
    # First, load from persistent store
    try:
        store = get_job_store()
        stored_jobs = await store.list_jobs(status=status_filter, limit=limit)

        jobs = []
        for job_record in stored_jobs:
            jobs.append(
                TrainingJobSummary(
                    job_id=job_record.job_id,
                    status=job_record.status,
                    run_name=job_record.run_name,
                    model_architecture=job_record.model_architecture or "unknown",
                    dataset_id=job_record.dataset_id or "unknown",
                    started_at=job_record.started_at or "",
                    finished_at=job_record.finished_at,
                    compute_backend=job_record.compute_backend,
                )
            )

        return TrainingJobsListResponse(
            jobs=jobs[:limit],
            total=len(jobs),
        )

    except Exception as e:
        logger.warning(f"Failed to list jobs from store: {e}, falling back to memory")

    # Fallback to in-memory jobs
    jobs = []

    for job_id, job_info in _jobs.items():
        status = job_info.get("status", JobStatus.PENDING)

        if status_filter and status != status_filter:
            continue

        lineage = job_info.get("lineage")
        request = job_info.get("request")

        run_name = None
        if request and hasattr(request, "training") and request.training:
            run_name = request.training.run_name

        jobs.append(
            TrainingJobSummary(
                job_id=job_id,
                status=status,
                run_name=run_name,
                model_architecture=lineage.model_architecture if lineage else "unknown",
                dataset_id=lineage.dataset_id if lineage else "unknown",
                started_at=job_info.get("started_at", ""),
                finished_at=job_info.get("finished_at"),
                compute_backend=job_info.get("compute_backend", "local"),
            )
        )

    # Sort by start time (newest first)
    jobs.sort(key=lambda j: j.started_at, reverse=True)

    return TrainingJobsListResponse(
        jobs=jobs[:limit],
        total=len(jobs),
    )


def list_models() -> ModelsListResponse:
    """List available model architectures.

    Returns:
        List of model architecture info
    """
    return ModelsListResponse(models=list(MODEL_ARCHITECTURES.values()))


def get_model_info(architecture: str) -> Optional[ModelArchitectureInfo]:
    """Get info for a specific model architecture.

    Args:
        architecture: Architecture name

    Returns:
        Architecture info or None
    """
    return MODEL_ARCHITECTURES.get(architecture)


async def evaluate_policy(request: EvaluateRequest) -> EvaluateResponse:
    """Run policy evaluation.

    Args:
        request: Evaluation configuration

    Returns:
        Evaluation results with action sequences
    """
    import asyncio
    import subprocess

    from backend.core.paths import SCRIPTS_DIR

    script_path = SCRIPTS_DIR / "eval_policy.py"

    # Build command
    cmd = [
        "python3",
        str(script_path),
        "--checkpoint",
        request.checkpoint_path,
        "--num-episodes",
        str(request.num_episodes),
        "--max-steps",
        str(request.max_steps),
    ]

    if request.initial_state:
        cmd.extend(["--initial-state", json.dumps(request.initial_state)])

    if request.urdf:
        # Write URDF to temp file
        import tempfile

        urdf_file = Path(tempfile.mktemp(suffix=".urdf"))
        urdf_file.write_text(request.urdf)
        cmd.extend(["--urdf", str(urdf_file)])

    logger.info(f"Running evaluation: {' '.join(cmd)}")

    try:
        # Run evaluation script
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
            ),
        )

        if result.returncode != 0:
            logger.error(f"Evaluation failed: {result.stderr}")
            return EvaluateResponse(
                success=False,
                error=f"Evaluation script failed: {result.stderr}",
            )

        # Parse output
        output = json.loads(result.stdout)

        # Convert to response model
        episodes = [
            EpisodeResult(
                episode_index=ep["episode_index"],
                actions=ep["actions"],
                observations=ep.get("observations"),
                timestamps=ep.get("timestamps"),
            )
            for ep in output.get("episodes", [])
        ]

        return EvaluateResponse(
            success=output.get("success", False),
            episodes=episodes,
            metrics=output.get("metrics", {}),
            error=output.get("error"),
        )

    except subprocess.TimeoutExpired:
        logger.error("Evaluation timed out")
        return EvaluateResponse(
            success=False,
            error="Evaluation timed out after 5 minutes",
        )

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse evaluation output: {e}")
        return EvaluateResponse(
            success=False,
            error=f"Invalid evaluation output: {e}",
        )

    except Exception as e:
        logger.error(f"Evaluation error: {e}")
        return EvaluateResponse(
            success=False,
            error=str(e),
        )


async def get_job_metrics(job_id: str) -> dict:
    """Get metrics history for a training job for visualization.

    Reads from outputs/{job_id}/metrics.jsonl (one JSON per line) or
    outputs/{job_id}/progress.json as a fallback.

    Args:
        job_id: Job ID to get metrics for

    Returns:
        Dictionary with metrics grouped by metric name, each containing
        a list of data points with step, epoch, value, and timestamp.
    """
    metrics: Dict[str, List[Dict[str, Any]]] = {}

    job_dir = await _resolve_job_dir(job_id)

    # Try metrics.jsonl first (preferred format)
    metrics_jsonl_path = job_dir / "metrics.jsonl"
    progress_json_path = job_dir / "progress.json"

    try:
        if metrics_jsonl_path.exists():
            with open(metrics_jsonl_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        # Each entry should have metric name and value
                        # Expected format: {"step": 1, "epoch": 0, "loss": 0.5, "learning_rate": 0.001, "timestamp": 123}
                        step = entry.get("step", 0)
                        epoch = entry.get("epoch", 0)
                        timestamp = entry.get("timestamp")

                        # Extract all metrics from the entry
                        for key, value in entry.items():
                            if key in ("step", "epoch", "timestamp"):
                                continue
                            if isinstance(value, (int, float)):
                                if key not in metrics:
                                    metrics[key] = []
                                metrics[key].append({
                                    "step": step,
                                    "epoch": epoch,
                                    "value": value,
                                    "timestamp": timestamp,
                                })
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse metrics line: {line[:100]}")
                        continue

        elif progress_json_path.exists():
            # Fallback to progress.json
            with open(progress_json_path, "r") as f:
                progress_data = json.load(f)

            # Extract metrics from progress.json structure
            if "metrics_history" in progress_data:
                # If there's a metrics_history field, use it directly
                for metric_name, values in progress_data["metrics_history"].items():
                    metrics[metric_name] = values
            elif "metrics" in progress_data:
                # Single snapshot of metrics - wrap in list
                current_metrics = progress_data["metrics"]
                step = progress_data.get("current_step", 0)
                epoch = progress_data.get("current_epoch", 0)

                for key, value in current_metrics.items():
                    if isinstance(value, (int, float)):
                        metrics[key] = [{
                            "step": step,
                            "epoch": epoch,
                            "value": value,
                            "timestamp": None,
                        }]

    except FileNotFoundError:
        logger.debug(f"No metrics file found for job {job_id}")
    except Exception as e:
        logger.error(f"Error reading metrics for job {job_id}: {e}")

    return {"metrics": metrics}


async def get_job_logs(job_id: str, tail: int = 100) -> dict:
    """Get training logs (last N lines).

    Reads from outputs/{job_id}/train.log.

    Args:
        job_id: Job ID to get logs for
        tail: Number of lines to return (default 100)

    Returns:
        Dictionary with logs string and total line count.
    """
    job_dir = await _resolve_job_dir(job_id)
    candidate_logs = [
        job_dir / "train.log",
        job_dir / "stdout.log",
        job_dir / "stderr.log",
    ]

    log_path = next((path for path in candidate_logs if path.exists()), candidate_logs[0])

    try:
        if not log_path.exists():
            return {"logs": "", "total_lines": 0}

        with open(log_path, "r") as f:
            all_lines = f.readlines()

        total_lines = len(all_lines)

        # Get last N lines
        tail_lines = all_lines[-tail:] if tail < total_lines else all_lines
        logs = "".join(tail_lines)

        return {"logs": logs, "total_lines": total_lines}

    except FileNotFoundError:
        logger.debug(f"No log file found for job {job_id}")
        return {"logs": "", "total_lines": 0}
    except Exception as e:
        logger.error(f"Error reading logs for job {job_id}: {e}")
        return {"logs": f"Error reading logs: {e}", "total_lines": 0}


async def get_job_artifacts(job_id: str) -> dict:
    """List filesystem artifacts produced by a training job.

    This reads the resolved compute job directory directly so artifacts remain
    visible after backend restarts and when outputs are Docker-mounted.
    """
    job_dir = await _resolve_job_dir(job_id)
    artifacts: List[Dict[str, Any]] = []

    if not job_dir.exists():
        return {"job_id": job_id, "artifacts": [], "total": 0}

    artifact_types = {
        ".safetensors": "model",
        ".pt": "checkpoint",
        ".pth": "checkpoint",
        ".ckpt": "checkpoint",
        ".json": "config",
        ".jsonl": "metrics",
        ".log": "log",
        ".mp4": "video",
    }

    for path in sorted(job_dir.rglob("*")):
        if not path.is_file():
            continue

        rel_path = path.relative_to(job_dir).as_posix()
        stat = path.stat()
        artifacts.append({
            "path": rel_path,
            "name": path.name,
            "type": artifact_types.get(path.suffix.lower(), "file"),
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })

    return {"job_id": job_id, "artifacts": artifacts, "total": len(artifacts)}


async def _resolve_job_dir(job_id: str) -> Path:
    """Resolve the filesystem output directory for a RobotOps job."""
    await _ensure_jobs_loaded()

    job_info = _jobs.get(job_id)
    compute_job_id = job_info.get("compute_job_id") if job_info else None
    output_dir = "./outputs"

    request = job_info.get("request") if job_info else None
    if request and hasattr(request, "training"):
        output_dir = request.training.output_dir
    elif job_info and job_info.get("config"):
        training_config = job_info["config"].get("training", {})
        output_dir = training_config.get("output_dir", output_dir)

    if not compute_job_id:
        try:
            store = get_job_store()
            record = await store.get_job(job_id)
            if record:
                compute_job_id = record.compute_job_id
                output_dir = record.config.get("training", {}).get("output_dir", output_dir)
        except Exception as e:
            logger.debug(f"Failed to resolve persisted job dir for {job_id}: {e}")

    return Path(output_dir) / (compute_job_id or job_id)
