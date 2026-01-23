"""Tracker factory for creating experiment trackers from configuration.

This module provides a simple factory function to instantiate trackers
based on configuration, making it easy to switch between backends.

Usage:
    from backend.robotops import get_tracker
    from backend.robotops.tracker_factory import TrackerConfig

    config = TrackerConfig(type="wandb", project="my-project")
    tracker = get_tracker(config)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field

from backend.robotops.tracker_protocol import ExperimentTracker
from backend.robotops.trackers.mlflow_tracker import MLflowTracker
from backend.robotops.trackers.noop_tracker import NoopTracker
from backend.robotops.trackers.wandb_tracker import WandBTracker

logger = logging.getLogger(__name__)


TrackerType = Literal["mlflow", "wandb", "none"]


class TrackerConfig(BaseModel):
    """Configuration for experiment tracker.

    Attributes:
        type: Tracker type - "mlflow", "wandb", or "none"

        MLflow-specific:
            tracking_uri: MLflow tracking server URI
            experiment_name: MLflow experiment name

        W&B-specific:
            project: W&B project name
            entity: W&B team/user entity

        Common:
            output_dir: Directory for local artifacts
    """

    type: TrackerType = Field(default="none", description="Tracker type")

    # MLflow config
    tracking_uri: Optional[str] = Field(
        default=None,
        description="MLflow tracking URI (e.g., http://localhost:5000)",
    )
    experiment_name: Optional[str] = Field(
        default=None,
        description="MLflow experiment name",
    )

    # W&B config
    project: Optional[str] = Field(
        default=None,
        description="W&B project name",
    )
    entity: Optional[str] = Field(
        default=None,
        description="W&B team/user entity",
    )

    # Common config
    output_dir: Optional[str] = Field(
        default="./outputs",
        description="Directory for local artifacts and lineage files",
    )

    class Config:
        extra = "allow"  # Allow extra fields for future tracker options


# Registry of available trackers
TRACKER_REGISTRY: Dict[str, type] = {
    "mlflow": MLflowTracker,
    "wandb": WandBTracker,
    "none": NoopTracker,
}


def get_tracker(
    config: Union[TrackerConfig, Dict[str, Any], None] = None,
) -> ExperimentTracker:
    """Create an experiment tracker from configuration.

    Args:
        config: Tracker configuration. Can be:
            - TrackerConfig instance
            - Dictionary with tracker settings
            - None (returns NoopTracker)

    Returns:
        An ExperimentTracker instance

    Examples:
        # Using TrackerConfig
        tracker = get_tracker(TrackerConfig(type="wandb", project="my-project"))

        # Using dict
        tracker = get_tracker({"type": "mlflow", "tracking_uri": "http://localhost:5000"})

        # Default (no tracking)
        tracker = get_tracker()
    """
    if config is None:
        return NoopTracker()

    if isinstance(config, dict):
        config = TrackerConfig(**config)

    tracker_type = config.type
    tracker_cls = TRACKER_REGISTRY.get(tracker_type)

    if tracker_cls is None:
        logger.warning(f"Unknown tracker type: {tracker_type}, using NoopTracker")
        return NoopTracker(output_dir=config.output_dir)

    # Extract relevant kwargs based on tracker type
    kwargs: Dict[str, Any] = {"output_dir": config.output_dir}

    if tracker_type == "mlflow":
        kwargs.update({
            "tracking_uri": config.tracking_uri,
            "experiment_name": config.experiment_name,
        })
    elif tracker_type == "wandb":
        if not config.project:
            logger.warning("W&B project not specified, using 'urdf-studio-training'")
        kwargs.update({
            "project": config.project or "urdf-studio-training",
            "entity": config.entity,
        })

    # Include any extra config fields
    extra_fields = set(config.model_dump().keys()) - set(TrackerConfig.model_fields.keys())
    for field in extra_fields:
        kwargs[field] = getattr(config, field)

    logger.info(f"Creating {tracker_type} tracker")
    return tracker_cls(**kwargs)


def register_tracker(name: str, tracker_cls: type) -> None:
    """Register a custom tracker implementation.

    Args:
        name: Tracker type name (used in config)
        tracker_cls: Tracker class implementing ExperimentTracker protocol

    Example:
        class NeptuneTracker:
            name = "neptune"
            # ... implement ExperimentTracker protocol

        register_tracker("neptune", NeptuneTracker)
    """
    if not isinstance(tracker_cls, type):
        raise TypeError(f"tracker_cls must be a class, got {type(tracker_cls)}")

    TRACKER_REGISTRY[name] = tracker_cls
    logger.info(f"Registered tracker: {name}")


def list_available_trackers() -> list[str]:
    """Return list of available tracker types."""
    return list(TRACKER_REGISTRY.keys())
