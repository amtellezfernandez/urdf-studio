"""SDK data models - Simplified types for AI agent consumption.

These models provide a clean interface to URDF Studio responses,
with sensible defaults and documentation suitable for AI agents.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ============================================================================
# Enums
# ============================================================================


class JobStatus(str, Enum):
    """Training job status."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    def is_terminal(self) -> bool:
        """Check if status is terminal (no more updates expected)."""
        return self in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)

    def is_success(self) -> bool:
        """Check if status represents successful completion."""
        return self == JobStatus.COMPLETED


class ComputeBackend(str, Enum):
    """Compute backend for training."""

    LOCAL = "local"
    MODAL = "modal"
    RUNPOD = "runpod"


class ModelArchitecture(str, Enum):
    """Available model architectures."""

    ACT = "act"
    DIFFUSION_POLICY = "diffusion_policy"
    TDMPC = "tdmpc"
    VQ_BET = "vq_bet"
    CUSTOM = "custom"


# ============================================================================
# Kinematics Models
# ============================================================================


@dataclass
class LinkPose:
    """Pose of a robot link in world frame."""

    name: str
    position: List[float]  # [x, y, z]
    quaternion_wxyz: List[float]  # [w, x, y, z]

    @property
    def xyz(self) -> tuple:
        """Position as tuple."""
        return tuple(self.position)

    def __repr__(self) -> str:
        return f"LinkPose({self.name}, pos={self.xyz})"


@dataclass
class FKResult:
    """Forward kinematics result."""

    links: List[LinkPose]
    success: bool = True
    error: Optional[str] = None

    def get_link(self, name: str) -> Optional[LinkPose]:
        """Get pose for a specific link by name."""
        for link in self.links:
            if link.name == name:
                return link
        return None

    @property
    def link_names(self) -> List[str]:
        """List of all link names."""
        return [link.name for link in self.links]


@dataclass
class JointSolution:
    """IK solution for a set of joints."""

    joint_values: Dict[str, float]
    cost: float = 0.0
    converged: bool = True
    iterations: int = 0

    def as_list(self, joint_order: List[str]) -> List[float]:
        """Convert to ordered list of joint values."""
        return [self.joint_values.get(j, 0.0) for j in joint_order]


@dataclass
class IKResult:
    """Inverse kinematics result."""

    solution: Optional[JointSolution]
    success: bool
    error: Optional[str] = None
    diagnostics: Dict[str, Any] = field(default_factory=dict)

    @property
    def converged(self) -> bool:
        """Check if IK converged to a valid solution."""
        return self.success and self.solution is not None and self.solution.converged


# ============================================================================
# Training Models
# ============================================================================


@dataclass
class TrainingProgress:
    """Training progress information."""

    current_epoch: int
    total_epochs: int
    current_step: int
    total_steps: int
    epoch_progress: float  # 0.0 - 1.0
    overall_progress: float  # 0.0 - 1.0

    @property
    def percent_complete(self) -> float:
        """Progress as percentage (0-100)."""
        return self.overall_progress * 100


@dataclass
class TrainingMetrics:
    """Current training metrics."""

    loss: Optional[float] = None
    learning_rate: Optional[float] = None
    grad_norm: Optional[float] = None
    additional: Dict[str, float] = field(default_factory=dict)


@dataclass
class TrainingLineage:
    """Training lineage for reproducibility."""

    dataset_source: str
    dataset_id: str
    model_architecture: str
    model_config_hash: str
    training_config_hash: str
    started_at: str
    dataset_version: Optional[str] = None
    robot_name: Optional[str] = None
    completed_at: Optional[str] = None


@dataclass
class TrainingJob:
    """Started training job reference."""

    job_id: str
    success: bool
    message: str
    tracker_url: Optional[str] = None
    lineage: Optional[TrainingLineage] = None

    def __repr__(self) -> str:
        status = "started" if self.success else "failed"
        return f"TrainingJob({self.job_id}, {status})"


@dataclass
class TrainingStatus:
    """Training job status."""

    job_id: str
    status: JobStatus
    progress: Optional[TrainingProgress] = None
    metrics: Optional[TrainingMetrics] = None
    lineage: Optional[TrainingLineage] = None
    error: Optional[str] = None
    logs_tail: Optional[str] = None
    compute_backend: str = "local"
    cost_estimate_usd: Optional[float] = None
    tracker_url: Optional[str] = None

    @property
    def is_running(self) -> bool:
        """Check if job is still running."""
        return self.status == JobStatus.RUNNING

    @property
    def is_complete(self) -> bool:
        """Check if job completed successfully."""
        return self.status == JobStatus.COMPLETED

    @property
    def is_failed(self) -> bool:
        """Check if job failed."""
        return self.status == JobStatus.FAILED

    @property
    def is_terminal(self) -> bool:
        """Check if job has reached a terminal state."""
        return self.status.is_terminal()


@dataclass
class ModelInfo:
    """Model architecture information."""

    name: str
    display_name: str
    description: str
    default_config: Dict[str, Any]
    config_schema: Dict[str, Any]
    recommended_for: List[str]

    def __repr__(self) -> str:
        return f"ModelInfo({self.name}: {self.display_name})"


# ============================================================================
# Samples Models
# ============================================================================


@dataclass
class Sample:
    """Robot sample entry."""

    id: str
    label: str
    urdf_path: str


@dataclass
class SampleFile:
    """Sample file with content."""

    path: str
    content: bytes
    mime_type: str


@dataclass
class SampleFiles:
    """Complete sample with files."""

    id: str
    label: str
    urdf_path: str
    files: List[SampleFile]

    def get_urdf(self) -> Optional[str]:
        """Get URDF content as string."""
        for f in self.files:
            if f.path == self.urdf_path or f.path.endswith(".urdf"):
                return f.content.decode("utf-8")
        return None


# ============================================================================
# Evaluation Models
# ============================================================================


@dataclass
class EpisodeResult:
    """Result from a single evaluation episode."""

    episode_index: int
    actions: List[List[float]]
    observations: Optional[List[List[float]]] = None
    rewards: Optional[List[float]] = None
    timestamps: Optional[List[float]] = None

    @property
    def num_steps(self) -> int:
        """Number of steps in episode."""
        return len(self.actions)


@dataclass
class EvaluationResult:
    """Policy evaluation result."""

    success: bool
    episodes: List[EpisodeResult]
    metrics: Dict[str, float]
    error: Optional[str] = None

    @property
    def num_episodes(self) -> int:
        """Number of evaluated episodes."""
        return len(self.episodes)


# ============================================================================
# Dataset Models
# ============================================================================


@dataclass
class DatasetInfo:
    """Information about a LeRobot dataset."""

    repo_id: str
    description: Optional[str] = None
    downloads: Optional[int] = None
    likes: Optional[int] = None
    robot_type: Optional[str] = None
    num_episodes: Optional[int] = None
    total_frames: Optional[int] = None
    fps: Optional[float] = None
    features: Optional[List[str]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def __repr__(self) -> str:
        return f"DatasetInfo({self.repo_id})"


# ============================================================================
# Artifact Models
# ============================================================================


@dataclass
class Artifact:
    """Training artifact (checkpoint, log, etc.)."""

    name: str
    path: str
    size_bytes: Optional[int] = None
    artifact_type: Optional[str] = None
    created_at: Optional[str] = None
    checksum: Optional[str] = None

    def __repr__(self) -> str:
        return f"Artifact({self.name}, {self.artifact_type})"
