from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Protocol
import logging

logger = logging.getLogger(__name__)

@dataclass
class PolicyInfo:
    """Information about an available policy."""
    id: str
    name: str
    description: str
    source: str  # "lerobot", "custom"
    default_config: Dict[str, Any] = field(default_factory=dict)
    config_schema: Optional[Dict[str, Any]] = None
    input_modalities: List[str] = field(default_factory=lambda: ["state"])
    version: Optional[str] = None

class PolicyAdapter(Protocol):
    """Protocol for policy discovery adapters."""

    def discover(self) -> List[PolicyInfo]:
        """Discover available policies."""
        ...

    def get_default_config(self, policy_id: str) -> Dict[str, Any]:
        """Get default configuration for a policy."""
        ...

class PolicyRegistry:
    """Registry for policy adapters and discovered policies."""

    _adapters: Dict[str, PolicyAdapter] = {}
    _policies_cache: Optional[List[PolicyInfo]] = None

    @classmethod
    def register_adapter(cls, name: str, adapter: PolicyAdapter) -> None:
        """Register a policy adapter."""
        cls._adapters[name] = adapter
        cls._policies_cache = None  # Invalidate cache
        logger.info(f"Registered policy adapter: {name}")

    @classmethod
    def list_policies(cls, refresh: bool = False) -> List[PolicyInfo]:
        """List all available policies from all adapters."""
        if cls._policies_cache is not None and not refresh:
            return cls._policies_cache

        policies = []
        for name, adapter in cls._adapters.items():
            try:
                discovered = adapter.discover()
                policies.extend(discovered)
                logger.info(f"Discovered {len(discovered)} policies from {name}")
            except Exception as e:
                logger.warning(f"Failed to discover policies from {name}: {e}")

        # Fallback if no policies discovered
        if not policies:
            policies = cls._get_fallback_policies()
            logger.warning("Using fallback policy list")

        cls._policies_cache = policies
        return policies

    @classmethod
    def _get_fallback_policies(cls) -> List[PolicyInfo]:
        """Fallback minimal policy list."""
        return [
            PolicyInfo(
                id="act",
                name="ACT",
                description="Action Chunking Transformer",
                source="lerobot",
                default_config={"chunk_size": 100},
            ),
            PolicyInfo(
                id="diffusion",
                name="Diffusion Policy",
                description="Diffusion-based policy",
                source="lerobot",
                default_config={"n_diffusion_steps": 100},
            ),
        ]

def get_policy_registry() -> PolicyRegistry:
    return PolicyRegistry

def list_policies(refresh: bool = False) -> List[PolicyInfo]:
    return PolicyRegistry.list_policies(refresh)
