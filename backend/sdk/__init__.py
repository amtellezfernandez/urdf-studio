"""URDF Studio SDK - Programmatic access for AI agents and automation.

This SDK provides a typed Python interface for all URDF Studio capabilities,
designed for AI agents and automated workflows.

Usage:
    from backend.sdk import URDFStudioClient

    # Connect to local or remote URDF Studio server
    client = URDFStudioClient("http://localhost:8000")

    # Forward/Inverse Kinematics
    fk_result = await client.kinematics.forward_kinematics(urdf, joints)
    ik_result = await client.kinematics.inverse_kinematics(urdf, target_link, target_pos)

    # Training
    job = await client.training.start(dataset="lerobot/pusht", model="act")
    status = await client.training.wait_for_completion(job.job_id)

    # Datasets
    datasets = await client.datasets.browse()
    results = await client.datasets.search("aloha")
    info = await client.datasets.info("lerobot/pusht")

    # Artifacts
    artifacts = await client.artifacts.list(job.job_id)
    await client.artifacts.download(job.job_id, "checkpoint.pt", "./local/")

    # Samples
    samples = await client.samples.list()
    sample = await client.samples.get("panda")

Quick Start for AI Agents:
    1. Check health: `await client.health.check()`
    2. List models: `models = await client.training.list_models()`
    3. Start training: `job = await client.training.start(...)`
    4. Monitor: `status = await client.training.get_status(job.job_id)`

CLI Usage:
    urdf-studio train --dataset lerobot/pusht --model act --epochs 1
    urdf-studio status JOB_ID
    urdf-studio datasets browse
    urdf-studio artifacts list JOB_ID
    urdf-studio eval --checkpoint ./outputs/checkpoint.pt
"""

from backend.sdk.client import URDFStudioClient, APIError, SDKError
from backend.sdk.cli import cli
from backend.sdk.models import (
    # Kinematics
    FKResult,
    IKResult,
    JointSolution,
    LinkPose,
    # Training
    TrainingJob,
    TrainingStatus,
    TrainingProgress,
    TrainingMetrics,
    TrainingLineage,
    ModelInfo,
    ComputeBackend,
    JobStatus,
    # Datasets
    DatasetInfo,
    # Artifacts
    Artifact,
    # Evaluation
    EvaluationResult,
    EpisodeResult,
    # Samples
    Sample,
    SampleFiles,
)

__all__ = [
    # Main client
    "URDFStudioClient",
    # CLI
    "cli",
    # Exceptions
    "APIError",
    "SDKError",
    # Kinematics
    "FKResult",
    "IKResult",
    "JointSolution",
    "LinkPose",
    # Training
    "TrainingJob",
    "TrainingStatus",
    "TrainingProgress",
    "TrainingMetrics",
    "TrainingLineage",
    "ModelInfo",
    "ComputeBackend",
    "JobStatus",
    # Datasets
    "DatasetInfo",
    # Artifacts
    "Artifact",
    # Evaluation
    "EvaluationResult",
    "EpisodeResult",
    # Samples
    "Sample",
    "SampleFiles",
]

__version__ = "0.1.0"
