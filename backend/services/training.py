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
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.models.training import (
    ComputeConfig,
    DatasetConfig,
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
    TrainingProgress,
    TrainingStartRequest,
    TrainingStartResponse,
    TrainingStatusResponse,
)
from backend.robotops import get_compute, get_tracker
from backend.robotops.compute_protocol import JobState

logger = logging.getLogger(__name__)


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
# Job Storage (In-memory for now, would be Redis/DB in production)
# ============================================================================

_jobs: Dict[str, Dict[str, Any]] = {}


# ============================================================================
# Service Functions
# ============================================================================


def _hash_config(config: Dict[str, Any]) -> str:
    """Create a hash of configuration for lineage tracking."""
    config_str = json.dumps(config, sort_keys=True, default=str)
    return hashlib.sha256(config_str.encode()).hexdigest()[:12]


def _create_lineage(
    request: TrainingStartRequest,
    started_at: str,
) -> TrainingLineage:
    """Create lineage record for a training job."""
    dataset_id = request.dataset.repo_id or request.dataset.local_path or "unknown"

    return TrainingLineage(
        dataset_source=request.dataset.source.value,
        dataset_id=dataset_id,
        dataset_version=request.dataset.version,
        model_architecture=request.model.architecture.value,
        model_config_hash=_hash_config(request.model.config),
        training_config_hash=_hash_config(request.training.model_dump()),
        robot_name=request.robot_name,
        urdf_hash=_hash_config({"urdf": request.urdf}) if request.urdf else None,
        started_at=started_at,
    )


async def start_training(request: TrainingStartRequest) -> TrainingStartResponse:
    """Start a new training job.

    Args:
        request: Training configuration

    Returns:
        Response with job ID and status
    """
    job_id = f"train_{uuid.uuid4().hex[:8]}"
    started_at = datetime.now().isoformat()

    logger.info(f"Starting training job {job_id}")

    try:
        # Create lineage
        lineage = _create_lineage(request, started_at)

        # Initialize experiment tracker
        tracker_config = {
            "type": request.tracker.type.value,
            "tracking_uri": request.tracker.tracking_uri,
            "experiment_name": request.tracker.experiment_name,
            "project": request.tracker.project,
            "entity": request.tracker.entity,
            "output_dir": request.training.output_dir,
        }
        tracker = get_tracker(tracker_config)

        # Start tracking run
        run_name = request.training.run_name or f"{request.model.architecture.value}_{job_id}"
        tracker.init_run(
            run_name=run_name,
            config={
                "dataset": request.dataset.model_dump(),
                "model": request.model.model_dump(),
                "training": request.training.model_dump(),
                "compute": request.compute.model_dump(),
            },
            tags={
                "job_id": job_id,
                "architecture": request.model.architecture.value,
            },
        )

        # Log lineage
        tracker.log_dataset_lineage(
            dataset_id=lineage.dataset_id,
            version=lineage.dataset_version or "latest",
            source=lineage.dataset_source,
        )
        tracker.log_model_config(
            architecture=lineage.model_architecture,
            config=request.model.config,
        )

        # Initialize compute backend
        compute_config = {
            "type": request.compute.type.value,
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
            },
        )

        # Store job info
        _jobs[job_id] = {
            "compute_job_id": compute_job_id,
            "compute_backend": request.compute.type.value,
            "tracker": tracker,
            "tracker_url": tracker.get_run_url(),
            "lineage": lineage,
            "request": request,
            "status": JobStatus.RUNNING,
            "started_at": started_at,
        }

        return TrainingStartResponse(
            success=True,
            job_id=job_id,
            message=f"Training started on {request.compute.type.value}",
            tracker_url=tracker.get_run_url(),
            lineage=lineage,
        )

    except Exception as e:
        logger.error(f"Failed to start training: {e}")

        _jobs[job_id] = {
            "status": JobStatus.FAILED,
            "error": str(e),
            "started_at": started_at,
            "finished_at": datetime.now().isoformat(),
        }

        return TrainingStartResponse(
            success=False,
            job_id=job_id,
            message=f"Failed to start training: {e}",
        )


async def get_training_status(job_id: str) -> TrainingStatusResponse:
    """Get status of a training job.

    Args:
        job_id: Job ID to check

    Returns:
        Current status of the job
    """
    if job_id not in _jobs:
        return TrainingStatusResponse(
            job_id=job_id,
            status=JobStatus.FAILED,
            error="Job not found",
            compute_backend="unknown",
        )

    job_info = _jobs[job_id]

    # If job failed during startup
    if job_info.get("status") == JobStatus.FAILED:
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
            "output_dir": job_info.get("request", {}).training.output_dir
            if job_info.get("request")
            else "./outputs",
        }
        compute = get_compute(compute_config)

        compute_status = await compute.status(job_info["compute_job_id"])

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
        job_info["status"] = status
        if status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            job_info["finished_at"] = datetime.now().isoformat()
            # Finish tracker run
            tracker = job_info.get("tracker")
            if tracker:
                tracker.finish_run(status.value)

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
        metrics = None
        if compute_status.metrics:
            metrics = TrainingMetrics(
                loss=compute_status.metrics.get("loss"),
                learning_rate=compute_status.metrics.get("learning_rate"),
                grad_norm=compute_status.metrics.get("grad_norm"),
                additional={
                    k: v
                    for k, v in compute_status.metrics.items()
                    if k not in ["loss", "learning_rate", "grad_norm"]
                },
            )

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

            logger.info(f"Cancelled job {job_id}: {reason}")

        return cancelled

    except Exception as e:
        logger.error(f"Error cancelling job: {e}")
        return False


def list_jobs(
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
    jobs = []

    for job_id, job_info in _jobs.items():
        status = job_info.get("status", JobStatus.PENDING)

        if status_filter and status != status_filter:
            continue

        lineage = job_info.get("lineage")
        request = job_info.get("request")

        jobs.append(
            TrainingJobSummary(
                job_id=job_id,
                status=status,
                run_name=request.training.run_name if request else None,
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
    from backend.models.training import EpisodeResult

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
