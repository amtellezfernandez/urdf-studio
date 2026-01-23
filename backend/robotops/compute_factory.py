"""Compute factory for creating compute backends from configuration.

This module provides a simple factory function to instantiate compute backends
based on configuration, making it easy to switch between local and cloud.

Usage:
    from backend.robotops.compute_factory import get_compute, ComputeConfig

    config = ComputeConfig(type="modal", api_key="...")
    compute = get_compute(config)
    job_id = await compute.launch("train.py", {...})
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field

from backend.robotops.compute_protocol import ComputeBackend
from backend.robotops.compute.local_compute import LocalCompute
from backend.robotops.compute.modal_compute import ModalCompute
from backend.robotops.compute.runpod_compute import RunPodCompute

logger = logging.getLogger(__name__)


ComputeType = Literal["local", "modal", "runpod"]


class ComputeConfig(BaseModel):
    """Configuration for compute backend.

    Attributes:
        type: Compute type - "local", "modal", or "runpod"

        Local-specific:
            python_path: Path to Python interpreter

        Modal-specific:
            api_key: Modal API key
            default_gpu: Default GPU type

        RunPod-specific:
            api_key: RunPod API key
            default_gpu: Default GPU type
            use_spot: Whether to use spot instances

        Common:
            output_dir: Directory for outputs
    """

    type: ComputeType = Field(default="local", description="Compute type")

    # API keys (for cloud providers)
    api_key: Optional[str] = Field(
        default=None,
        description="API key for cloud provider",
    )

    # GPU config
    default_gpu: Optional[str] = Field(
        default=None,
        description="Default GPU type (e.g., 'T4', 'A100-40GB')",
    )

    # Local-specific
    python_path: Optional[str] = Field(
        default=None,
        description="Path to Python interpreter (local only)",
    )

    # RunPod-specific
    use_spot: bool = Field(
        default=True,
        description="Use spot instances for cost savings (RunPod)",
    )

    # Common
    output_dir: str = Field(
        default="./outputs",
        description="Directory for job outputs",
    )

    class Config:
        extra = "allow"


# Registry of available compute backends
COMPUTE_REGISTRY: Dict[str, type] = {
    "local": LocalCompute,
    "modal": ModalCompute,
    "runpod": RunPodCompute,
}

# Cache of compute backend instances (to preserve job state)
_COMPUTE_INSTANCES: Dict[str, ComputeBackend] = {}


def get_compute(
    config: Union[ComputeConfig, Dict[str, Any], None] = None,
) -> ComputeBackend:
    """Get or create a compute backend from configuration.

    Compute backends are cached to preserve job state between calls.

    Args:
        config: Compute configuration. Can be:
            - ComputeConfig instance
            - Dictionary with compute settings
            - None (returns LocalCompute)

    Returns:
        A ComputeBackend instance (cached)

    Examples:
        # Using ComputeConfig
        compute = get_compute(ComputeConfig(type="modal", api_key="..."))

        # Using dict
        compute = get_compute({"type": "runpod", "api_key": "...", "use_spot": True})

        # Default (local)
        compute = get_compute()
    """
    if config is None:
        config = ComputeConfig(type="local")
    elif isinstance(config, dict):
        config = ComputeConfig(**config)

    compute_type = config.type

    # Return cached instance if available
    if compute_type in _COMPUTE_INSTANCES:
        return _COMPUTE_INSTANCES[compute_type]

    compute_cls = COMPUTE_REGISTRY.get(compute_type)

    if compute_cls is None:
        logger.warning(f"Unknown compute type: {compute_type}, using local")
        compute_type = "local"
        if compute_type in _COMPUTE_INSTANCES:
            return _COMPUTE_INSTANCES[compute_type]
        compute_cls = LocalCompute

    # Build kwargs based on compute type
    kwargs: Dict[str, Any] = {"output_dir": config.output_dir}

    if compute_type == "local":
        if config.python_path:
            kwargs["python_path"] = config.python_path

    elif compute_type == "modal":
        if config.api_key:
            kwargs["api_key"] = config.api_key
        if config.default_gpu:
            kwargs["default_gpu"] = config.default_gpu

    elif compute_type == "runpod":
        if config.api_key:
            kwargs["api_key"] = config.api_key
        if config.default_gpu:
            kwargs["default_gpu"] = config.default_gpu
        kwargs["use_spot"] = config.use_spot

    # Include any extra config fields
    extra_fields = set(config.model_dump().keys()) - set(ComputeConfig.model_fields.keys())
    for field in extra_fields:
        kwargs[field] = getattr(config, field)

    logger.info(f"Creating {compute_type} compute backend (cached)")
    instance = compute_cls(**kwargs)
    _COMPUTE_INSTANCES[compute_type] = instance
    return instance


def register_compute(name: str, compute_cls: type) -> None:
    """Register a custom compute backend implementation.

    Args:
        name: Compute type name (used in config)
        compute_cls: Compute class implementing ComputeBackend protocol

    Example:
        class LambdaLabsCompute:
            name = "lambda"
            # ... implement ComputeBackend protocol

        register_compute("lambda", LambdaLabsCompute)
    """
    if not isinstance(compute_cls, type):
        raise TypeError(f"compute_cls must be a class, got {type(compute_cls)}")

    COMPUTE_REGISTRY[name] = compute_cls
    logger.info(f"Registered compute backend: {name}")


def list_available_compute() -> list[str]:
    """Return list of available compute types."""
    return list(COMPUTE_REGISTRY.keys())


async def get_all_available_instances() -> Dict[str, list]:
    """Get available GPU instances from all backends.

    Returns:
        Dict mapping backend name to list of available instances
    """
    results = {}

    # Local
    local = LocalCompute()
    results["local"] = await local.get_available_instances()

    # Cloud providers (if available)
    for name in ["modal", "runpod"]:
        try:
            compute = get_compute(ComputeConfig(type=name))
            results[name] = await compute.get_available_instances()
        except Exception as e:
            logger.debug(f"Could not get instances from {name}: {e}")
            results[name] = []

    return results
