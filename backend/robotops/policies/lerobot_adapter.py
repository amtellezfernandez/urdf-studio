from typing import Dict, List, Any
import logging
from .registry import PolicyInfo, PolicyAdapter

logger = logging.getLogger(__name__)

class LeRobotPolicyAdapter:
    """Adapter for discovering LeRobot policies."""

    # Known LeRobot policies with their metadata
    KNOWN_POLICIES = {
        "act": {
            "name": "ACT",
            "description": "Action Chunking Transformer - Predicts action sequences using transformer architecture",
            "default_config": {
                "chunk_size": 100,
                "dim_model": 512,
                "n_heads": 8,
                "n_encoder_layers": 4,
                "n_decoder_layers": 1,
                "dim_feedforward": 3200,
            },
            "input_modalities": ["state", "image"],
        },
        "diffusion": {
            "name": "Diffusion Policy",
            "description": "Diffusion-based policy using denoising score matching for action prediction",
            "default_config": {
                "num_train_timesteps": 100,
                "horizon": 16,
                "n_obs_steps": 2,
                "n_action_steps": 8,
            },
            "input_modalities": ["state", "image"],
        },
        "tdmpc": {
            "name": "TD-MPC",
            "description": "Temporal Difference Model Predictive Control",
            "default_config": {
                "horizon": 5,
                "iterations": 6,
                "num_samples": 512,
            },
            "input_modalities": ["state"],
        },
        "vqbet": {
            "name": "VQ-BeT",
            "description": "Vector Quantized Behavior Transformer",
            "default_config": {
                "n_clusters": 512,
                "chunk_size": 10,
            },
            "input_modalities": ["state", "image"],
        },
    }

    def discover(self) -> List[PolicyInfo]:
        """Discover available LeRobot policies."""
        policies = []

        # Try to import LeRobot to verify policies exist
        try:
            from lerobot.policies import ACTConfig, DiffusionConfig
            lerobot_available = True
        except ImportError:
            lerobot_available = False
            logger.warning("LeRobot not installed, using static policy list")

        for policy_id, meta in self.KNOWN_POLICIES.items():
            policies.append(PolicyInfo(
                id=policy_id,
                name=meta["name"],
                description=meta["description"],
                source="lerobot",
                default_config=meta["default_config"],
                input_modalities=meta["input_modalities"],
                version="0.4.0" if lerobot_available else None,
            ))

        return policies

    def get_default_config(self, policy_id: str) -> Dict[str, Any]:
        """Get default config for a policy."""
        if policy_id in self.KNOWN_POLICIES:
            return self.KNOWN_POLICIES[policy_id]["default_config"].copy()
        return {}

# Auto-register on import
def _auto_register():
    from .registry import PolicyRegistry
    PolicyRegistry.register_adapter("lerobot", LeRobotPolicyAdapter())

_auto_register()
