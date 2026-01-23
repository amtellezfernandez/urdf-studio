"""Pydantic models for training API.

These models define the request/response schema for the training endpoints,
ensuring type safety and validation.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ============================================================================
# Enums
# ============================================================================


class DatasetSource(str, Enum):
    """Source of training dataset."""

    HUGGINGFACE = "huggingface"
    LOCAL = "local"


class ModelArchitecture(str, Enum):
    """Supported policy architectures (LeRobot native)."""

    ACT = "act"
    DIFFUSION_POLICY = "diffusion_policy"
    TDMPC = "tdmpc"
    VQ_BET = "vq_bet"
    CUSTOM = "custom"


class TrackerType(str, Enum):
    """Experiment tracking backend."""

    MLFLOW = "mlflow"
    WANDB = "wandb"
    NONE = "none"


class ComputeType(str, Enum):
    """Compute backend for training."""

    LOCAL = "local"
    MODAL = "modal"
    RUNPOD = "runpod"


class JobStatus(str, Enum):
    """Training job status."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ============================================================================
# Configuration Models
# ============================================================================


class DatasetConfig(BaseModel):
    """Dataset configuration for training."""

    source: DatasetSource = Field(
        default=DatasetSource.HUGGINGFACE,
        description="Dataset source type",
    )
    repo_id: Optional[str] = Field(
        default=None,
        description="HuggingFace dataset ID (e.g., 'lerobot/aloha_sim_insertion')",
    )
    local_path: Optional[str] = Field(
        default=None,
        description="Path to local dataset directory",
    )
    version: Optional[str] = Field(
        default=None,
        description="Dataset version or commit hash",
    )
    episodes: Optional[List[int]] = Field(
        default=None,
        description="Specific episodes to use (None = all)",
    )

    class Config:
        use_enum_values = True


class ModelConfig(BaseModel):
    """Model architecture configuration."""

    architecture: ModelArchitecture = Field(
        default=ModelArchitecture.ACT,
        description="Policy architecture",
    )
    config: Dict[str, Any] = Field(
        default_factory=dict,
        description="Architecture-specific configuration",
    )
    pretrained_path: Optional[str] = Field(
        default=None,
        description="Path to pretrained checkpoint for fine-tuning",
    )
    custom_config_path: Optional[str] = Field(
        default=None,
        description="Path to custom model config YAML",
    )

    class Config:
        use_enum_values = True


class TrainingParams(BaseModel):
    """Training hyperparameters."""

    # Basic params
    batch_size: int = Field(default=32, ge=1, description="Batch size")
    learning_rate: float = Field(default=1e-4, gt=0, description="Learning rate")
    epochs: int = Field(default=100, ge=1, description="Number of epochs")
    seed: int = Field(default=42, description="Random seed")

    # Optimization
    gradient_accumulation_steps: int = Field(
        default=1, ge=1, description="Gradient accumulation steps"
    )
    max_grad_norm: Optional[float] = Field(
        default=1.0, description="Max gradient norm for clipping"
    )
    weight_decay: float = Field(default=0.01, ge=0, description="Weight decay")

    # Scheduler
    lr_scheduler: str = Field(
        default="cosine", description="LR scheduler type"
    )
    warmup_steps: int = Field(default=500, ge=0, description="Warmup steps")

    # Checkpointing
    checkpoint_interval: int = Field(
        default=10, ge=1, description="Save checkpoint every N epochs"
    )
    keep_last_n_checkpoints: int = Field(
        default=3, ge=1, description="Number of recent checkpoints to keep"
    )

    # Early stopping
    early_stopping_patience: Optional[int] = Field(
        default=None, description="Stop if no improvement for N epochs"
    )
    early_stopping_metric: str = Field(
        default="loss", description="Metric for early stopping"
    )

    # Output
    output_dir: str = Field(
        default="./outputs", description="Output directory for checkpoints"
    )
    run_name: Optional[str] = Field(
        default=None, description="Run name (auto-generated if None)"
    )


class TrackerConfig(BaseModel):
    """Experiment tracking configuration."""

    type: TrackerType = Field(
        default=TrackerType.NONE,
        description="Tracker type",
    )

    # MLflow
    tracking_uri: Optional[str] = Field(
        default=None,
        description="MLflow tracking URI",
    )
    experiment_name: Optional[str] = Field(
        default=None,
        description="MLflow experiment name",
    )

    # W&B
    project: Optional[str] = Field(
        default=None,
        description="W&B project name",
    )
    entity: Optional[str] = Field(
        default=None,
        description="W&B team/user entity",
    )

    class Config:
        use_enum_values = True


class ComputeConfig(BaseModel):
    """Compute backend configuration."""

    type: ComputeType = Field(
        default=ComputeType.LOCAL,
        description="Compute backend type",
    )

    # GPU selection
    gpu: Optional[str] = Field(
        default=None,
        description="GPU type (e.g., 'T4', 'A100-40GB')",
    )
    device: str = Field(
        default="cuda",
        description="Device for local training (cuda, mps, cpu)",
    )

    # Cloud credentials
    api_key: Optional[str] = Field(
        default=None,
        description="API key for cloud provider",
    )

    # Cloud options
    use_spot: bool = Field(
        default=True,
        description="Use spot/preemptible instances",
    )
    timeout_hours: float = Field(
        default=4.0,
        description="Maximum training duration",
    )

    class Config:
        use_enum_values = True


# ============================================================================
# Request Models
# ============================================================================


class TrainingStartRequest(BaseModel):
    """Request to start a training job."""

    dataset: DatasetConfig = Field(
        default_factory=DatasetConfig,
        description="Dataset configuration",
    )
    model: ModelConfig = Field(
        default_factory=ModelConfig,
        description="Model configuration",
    )
    training: TrainingParams = Field(
        default_factory=TrainingParams,
        description="Training parameters",
    )
    tracker: TrackerConfig = Field(
        default_factory=TrackerConfig,
        description="Experiment tracking configuration",
    )
    compute: ComputeConfig = Field(
        default_factory=ComputeConfig,
        description="Compute backend configuration",
    )

    # Optional: URDF for robot context
    urdf: Optional[str] = Field(
        default=None,
        description="URDF content (for lineage tracking)",
    )
    robot_name: Optional[str] = Field(
        default=None,
        description="Robot name (for lineage tracking)",
    )


class TrainingCancelRequest(BaseModel):
    """Request to cancel a training job."""

    reason: Optional[str] = Field(
        default=None,
        description="Reason for cancellation",
    )


# ============================================================================
# Response Models
# ============================================================================


class TrainingProgress(BaseModel):
    """Training progress information."""

    current_epoch: int = Field(default=0, description="Current epoch")
    total_epochs: int = Field(default=0, description="Total epochs")
    current_step: int = Field(default=0, description="Current step within epoch")
    total_steps: int = Field(default=0, description="Total steps per epoch")
    epoch_progress: float = Field(
        default=0.0, ge=0, le=1, description="Progress within epoch (0-1)"
    )
    overall_progress: float = Field(
        default=0.0, ge=0, le=1, description="Overall progress (0-1)"
    )


class TrainingMetrics(BaseModel):
    """Current training metrics."""

    loss: Optional[float] = Field(default=None, description="Training loss")
    learning_rate: Optional[float] = Field(default=None, description="Current LR")
    grad_norm: Optional[float] = Field(default=None, description="Gradient norm")
    additional: Dict[str, float] = Field(
        default_factory=dict, description="Additional metrics"
    )


class TrainingLineage(BaseModel):
    """Training lineage for reproducibility."""

    dataset_source: str = Field(description="Dataset source type")
    dataset_id: str = Field(description="Dataset identifier")
    dataset_version: Optional[str] = Field(default=None, description="Dataset version")
    model_architecture: str = Field(description="Model architecture")
    model_config_hash: str = Field(description="Hash of model config")
    training_config_hash: str = Field(description="Hash of training config")
    robot_name: Optional[str] = Field(default=None, description="Robot name")
    urdf_hash: Optional[str] = Field(default=None, description="Hash of URDF")
    started_at: str = Field(description="Start timestamp")
    completed_at: Optional[str] = Field(default=None, description="Completion timestamp")


class TrainingStartResponse(BaseModel):
    """Response after starting a training job."""

    success: bool = Field(description="Whether job started successfully")
    job_id: str = Field(description="Job ID for tracking")
    message: str = Field(description="Status message")
    tracker_url: Optional[str] = Field(
        default=None, description="URL to experiment tracker"
    )
    lineage: Optional[TrainingLineage] = Field(
        default=None, description="Training lineage"
    )


class TrainingStatusResponse(BaseModel):
    """Training job status."""

    job_id: str = Field(description="Job ID")
    status: JobStatus = Field(description="Current status")
    progress: Optional[TrainingProgress] = Field(
        default=None, description="Progress info"
    )
    metrics: Optional[TrainingMetrics] = Field(
        default=None, description="Current metrics"
    )
    tracker_url: Optional[str] = Field(
        default=None, description="Experiment tracker URL"
    )
    lineage: Optional[TrainingLineage] = Field(
        default=None, description="Training lineage"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")
    logs_tail: Optional[str] = Field(
        default=None, description="Last few lines of logs"
    )

    # Cloud info
    compute_backend: str = Field(default="local", description="Compute backend used")
    cost_estimate_usd: Optional[float] = Field(
        default=None, description="Estimated cost so far"
    )

    class Config:
        use_enum_values = True


class TrainingJobSummary(BaseModel):
    """Summary of a training job for listing."""

    job_id: str
    status: JobStatus
    run_name: Optional[str]
    model_architecture: str
    dataset_id: str
    started_at: str
    finished_at: Optional[str]
    compute_backend: str

    class Config:
        use_enum_values = True


class TrainingJobsListResponse(BaseModel):
    """List of training jobs."""

    jobs: List[TrainingJobSummary] = Field(default_factory=list)
    total: int = Field(default=0)


# ============================================================================
# Model Info
# ============================================================================


class ModelArchitectureInfo(BaseModel):
    """Information about a model architecture."""

    name: str = Field(description="Architecture name")
    display_name: str = Field(description="Human-readable name")
    description: str = Field(description="Brief description")
    default_config: Dict[str, Any] = Field(
        default_factory=dict, description="Default configuration"
    )
    config_schema: Dict[str, Any] = Field(
        default_factory=dict, description="Configuration schema"
    )
    recommended_for: List[str] = Field(
        default_factory=list, description="Recommended use cases"
    )


class ModelsListResponse(BaseModel):
    """List of available model architectures."""

    models: List[ModelArchitectureInfo] = Field(default_factory=list)


# ============================================================================
# Evaluation Models
# ============================================================================


class EvaluateRequest(BaseModel):
    """Request to evaluate a trained policy."""

    checkpoint_path: str = Field(description="Path to checkpoint file")
    num_episodes: int = Field(default=1, ge=1, description="Number of episodes to run")
    max_steps: int = Field(default=1000, ge=1, description="Max steps per episode")
    urdf: Optional[str] = Field(default=None, description="URDF content")
    initial_state: Optional[Dict[str, float]] = Field(
        default=None, description="Initial joint positions"
    )


class EpisodeResult(BaseModel):
    """Result from a single evaluation episode."""

    episode_index: int = Field(description="Episode index")
    actions: List[List[float]] = Field(description="Action sequence")
    observations: Optional[List[List[float]]] = Field(
        default=None, description="Observation sequence"
    )
    rewards: Optional[List[float]] = Field(
        default=None, description="Reward sequence"
    )
    timestamps: Optional[List[float]] = Field(
        default=None, description="Timestamps"
    )


class EvaluateResponse(BaseModel):
    """Response from policy evaluation."""

    success: bool = Field(description="Whether evaluation succeeded")
    episodes: List[EpisodeResult] = Field(
        default_factory=list, description="Episode action sequences"
    )
    metrics: Dict[str, float] = Field(
        default_factory=dict, description="Evaluation metrics"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")
