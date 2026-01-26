"""Pydantic models for evaluations API.

These models define the request/response schema for the evaluation endpoints,
ensuring type safety and validation.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ============================================================================
# Enums
# ============================================================================


class EvaluationStatus(str, Enum):
    """Evaluation job status."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# ============================================================================
# Episode Models
# ============================================================================


class EpisodeStep(BaseModel):
    """Single step within an episode."""

    timestamp: float = Field(description="Step timestamp")
    observation: Optional[Dict[str, Any]] = Field(
        default=None, description="Observation at this step"
    )
    action: List[float] = Field(description="Action taken")
    reward: Optional[float] = Field(default=None, description="Reward received")
    info: Optional[Dict[str, Any]] = Field(
        default=None, description="Additional info"
    )


class EpisodeResult(BaseModel):
    """Result from a single evaluation episode."""

    episode_index: int = Field(description="Episode index")
    actions: List[List[float]] = Field(description="Action sequence")
    observations: Optional[List[Any]] = Field(
        default=None, description="Observation sequence (may include images)"
    )
    rewards: Optional[List[float]] = Field(default=None, description="Reward sequence")
    timestamps: Optional[List[float]] = Field(default=None, description="Timestamps")
    success: Optional[bool] = Field(default=None, description="Episode success flag")
    total_reward: Optional[float] = Field(default=None, description="Total episode reward")
    episode_length: Optional[int] = Field(default=None, description="Number of steps")
    info: Optional[Dict[str, Any]] = Field(default=None, description="Additional info")


# ============================================================================
# Request Models
# ============================================================================


class EvaluationCreate(BaseModel):
    """Request to create a new evaluation."""

    checkpoint_name: str = Field(
        default="final_model",
        description="Name of checkpoint to evaluate (e.g., 'final_model', 'best_model', 'checkpoint_50')"
    )
    num_episodes: int = Field(
        default=5,
        ge=1,
        le=100,
        description="Number of episodes to run"
    )
    seed: Optional[int] = Field(
        default=42,
        description="Random seed for reproducibility"
    )
    max_steps: int = Field(
        default=1000,
        ge=1,
        le=10000,
        description="Maximum steps per episode"
    )
    environment_config: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional environment configuration overrides"
    )
    render_video: bool = Field(
        default=True,
        description="Whether to render video from image observations"
    )


class EvaluationUpdate(BaseModel):
    """Request to update an evaluation status."""

    status: Optional[EvaluationStatus] = Field(default=None, description="New status")
    metrics: Optional[Dict[str, float]] = Field(default=None, description="Evaluation metrics")
    error: Optional[str] = Field(default=None, description="Error message")


# ============================================================================
# Response Models
# ============================================================================


class EvaluationResponse(BaseModel):
    """Evaluation summary response."""

    id: str = Field(description="Evaluation ID")
    run_id: str = Field(description="Training run ID this evaluation belongs to")
    experiment_id: Optional[str] = Field(default=None, description="Experiment ID")
    checkpoint_name: str = Field(description="Checkpoint name evaluated")
    checkpoint_path: Optional[str] = Field(default=None, description="Path to checkpoint")
    num_episodes: int = Field(description="Number of episodes")
    seed: Optional[int] = Field(default=None, description="Random seed used")
    max_steps: int = Field(description="Max steps per episode")
    status: str = Field(description="Current status (queued, running, completed, failed)")
    metrics: Optional[Dict[str, float]] = Field(
        default=None, description="Evaluation metrics (success_rate, avg_return, etc.)"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")
    episodes_artifact_path: Optional[str] = Field(
        default=None, description="Path to episodes JSON artifact"
    )
    video_artifact_paths: Optional[List[str]] = Field(
        default=None, description="Paths to rendered video files"
    )
    created_at: str = Field(description="Creation timestamp")
    started_at: Optional[str] = Field(default=None, description="Start timestamp")
    completed_at: Optional[str] = Field(default=None, description="Completion timestamp")

    class Config:
        from_attributes = True


class EvaluationDetail(EvaluationResponse):
    """Detailed evaluation response including episode data."""

    episodes: Optional[List[EpisodeResult]] = Field(
        default=None, description="Episode results (loaded from artifact)"
    )
    environment_config: Optional[Dict[str, Any]] = Field(
        default=None, description="Environment configuration used"
    )


class EvaluationListResponse(BaseModel):
    """List of evaluations."""

    evaluations: List[EvaluationResponse] = Field(default_factory=list)
    total: int = Field(default=0, description="Total count")


# ============================================================================
# Aggregate Metrics
# ============================================================================


class AggregateMetrics(BaseModel):
    """Aggregate evaluation metrics."""

    success_rate: float = Field(default=0.0, description="Success rate (0-1)")
    avg_return: float = Field(default=0.0, description="Average episode return")
    std_return: float = Field(default=0.0, description="Standard deviation of returns")
    min_return: float = Field(default=0.0, description="Minimum episode return")
    max_return: float = Field(default=0.0, description="Maximum episode return")
    avg_episode_length: float = Field(default=0.0, description="Average episode length")
    total_episodes: int = Field(default=0, description="Total episodes evaluated")
    total_steps: int = Field(default=0, description="Total steps across all episodes")
    custom: Optional[Dict[str, float]] = Field(
        default=None, description="Additional custom metrics"
    )
