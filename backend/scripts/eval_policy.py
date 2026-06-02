#!/usr/bin/env python3
"""Policy evaluation script.

This script loads a trained policy checkpoint and runs inference to generate
action sequences that can be visualized in the URDF Studio 3D viewer.

Usage:
    python eval_policy.py --checkpoint path/to/checkpoint.pt --num-episodes 5

The script outputs JSON with action sequences for each episode.

Requirements:
    - LeRobot must be installed
    - A valid checkpoint file is required
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from lerobot.policies.factory import PreTrainedPolicy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def load_checkpoint(checkpoint_path: str) -> Dict[str, Any]:
    """Load a trained policy checkpoint.

    Args:
        checkpoint_path: Path to checkpoint file (.pt or .safetensors)

    Returns:
        Checkpoint data including model state and config

    Raises:
        FileNotFoundError: If checkpoint file doesn't exist
        ValueError: If checkpoint format is unsupported
    """
    checkpoint_path = Path(checkpoint_path)

    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    if checkpoint_path.is_dir():
        return {"pretrained_path": str(checkpoint_path), "config": {}}

    if checkpoint_path.suffix == ".safetensors":
        from safetensors.torch import load_file

        state_dict = load_file(str(checkpoint_path))
        # Try to load config from adjacent file
        config_path = checkpoint_path.with_suffix(".json")
        config = json.loads(config_path.read_text()) if config_path.exists() else {}
        return {"state_dict": state_dict, "config": config}
    elif checkpoint_path.suffix == ".pt":
        checkpoint = torch.load(checkpoint_path, map_location="cpu")
        return checkpoint
    else:
        raise ValueError(f"Unsupported checkpoint format: {checkpoint_path.suffix}")


def create_policy(architecture: str, config: Dict[str, Any], state_dict: Dict[str, Any]):
    """Create and load a policy model.

    Args:
        architecture: Model architecture name
        config: Model configuration
        state_dict: Model weights

    Returns:
        Loaded policy model

    Raises:
        ValueError: If architecture is unknown
        RuntimeError: If model loading fails
    """
    logger.info(f"Creating {architecture} policy")

    pretrained_path = config.get("pretrained_path")
    if pretrained_path:
        return PreTrainedPolicy.from_pretrained(pretrained_path, local_files_only=True)

    # Get dataset stats from config if available
    dataset_stats = config.get("dataset_stats", {})

    policy = PreTrainedPolicy.from_pretrained(
        architecture,
        dataset_stats=dataset_stats,
        local_files_only=True,
        **config.get("config", {}),
    )
    policy.load_state_dict(state_dict)
    return policy


def run_inference(
    policy,
    initial_state: Optional[Dict[str, float]] = None,
    num_episodes: int = 1,
    max_steps: int = 1000,
    action_dim: int = 7,
) -> List[Dict[str, Any]]:
    """Run policy inference to generate action sequences.

    Args:
        policy: Loaded policy model
        initial_state: Optional initial joint state
        num_episodes: Number of episodes to run
        max_steps: Maximum steps per episode
        action_dim: Action dimension (number of joints)

    Returns:
        List of episode results with action sequences
    """
    policy.eval()
    device = next(policy.parameters()).device
    episodes = []

    with torch.no_grad():
        for ep_idx in range(num_episodes):
            logger.info(f"Running episode {ep_idx + 1}/{num_episodes}")

            actions = []
            observations = []
            timestamps = []

            # Create initial observation
            obs = torch.zeros(1, action_dim, device=device)
            if initial_state:
                for i, (name, value) in enumerate(initial_state.items()):
                    if i < action_dim:
                        obs[0, i] = value

            for step in range(max_steps):
                # Run policy inference
                action = policy.select_action({"observation.state": obs})

                if isinstance(action, torch.Tensor):
                    action = action.cpu().numpy()
                if action.ndim > 1:
                    action = action[0]  # Take first action if batched

                actions.append(action.tolist())
                observations.append(obs[0].cpu().tolist())
                timestamps.append(step * 0.02)  # 50Hz

                # Update observation with action (simple forward model)
                obs = torch.tensor(action, device=device).unsqueeze(0).float()

            episodes.append(
                {
                    "episode_index": ep_idx,
                    "actions": actions,
                    "observations": observations,
                    "timestamps": timestamps,
                }
            )

    return episodes


def evaluate(
    checkpoint_path: str,
    num_episodes: int = 1,
    max_steps: int = 1000,
    initial_state: Optional[Dict[str, float]] = None,
    urdf: Optional[str] = None,
) -> Dict[str, Any]:
    """Main evaluation function.

    Args:
        checkpoint_path: Path to checkpoint
        num_episodes: Number of episodes to run
        max_steps: Max steps per episode
        initial_state: Optional initial joint state
        urdf: Optional URDF content for context

    Returns:
        Evaluation results

    Raises:
        FileNotFoundError: If checkpoint doesn't exist
        RuntimeError: If evaluation fails
    """
    # Load checkpoint
    logger.info(f"Loading checkpoint from {checkpoint_path}")
    checkpoint = load_checkpoint(checkpoint_path)
    if checkpoint.get("pretrained_path"):
        checkpoint["config"] = {
            **checkpoint.get("config", {}),
            "pretrained_path": checkpoint["pretrained_path"],
        }

    # Get architecture and config from checkpoint
    config = checkpoint.get("config", {})
    architecture = config.get("architecture", "act")
    state_dict = checkpoint.get("model_state_dict", checkpoint.get("state_dict", checkpoint))

    # Determine action dimension from state dict or config
    action_dim = config.get("action_dim", 7)

    # Create and load policy
    logger.info(f"Creating {architecture} policy")
    policy = create_policy(architecture, config, state_dict)

    # Set device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    policy.to(device)

    # Run inference
    logger.info(f"Running inference for {num_episodes} episodes")
    episodes = run_inference(
        policy,
        initial_state=initial_state,
        num_episodes=num_episodes,
        max_steps=max_steps,
        action_dim=action_dim,
    )

    # Calculate metrics
    total_steps = sum(len(ep["actions"]) for ep in episodes)
    metrics = {
        "total_episodes": len(episodes),
        "total_steps": total_steps,
        "avg_episode_length": total_steps / len(episodes) if episodes else 0,
    }

    return {
        "success": True,
        "episodes": episodes,
        "metrics": metrics,
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate trained policy")
    parser.add_argument(
        "--checkpoint",
        type=str,
        required=True,
        help="Path to checkpoint file",
    )
    parser.add_argument(
        "--num-episodes",
        type=int,
        default=1,
        help="Number of episodes to run",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=1000,
        help="Maximum steps per episode",
    )
    parser.add_argument(
        "--initial-state",
        type=str,
        default=None,
        help="Initial joint state as JSON",
    )
    parser.add_argument(
        "--urdf",
        type=str,
        default=None,
        help="URDF file path for context",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output JSON file path",
    )

    args = parser.parse_args()

    # Parse initial state if provided
    initial_state = None
    if args.initial_state:
        initial_state = json.loads(args.initial_state)

    # Load URDF if provided
    urdf = None
    if args.urdf:
        urdf_path = Path(args.urdf)
        if urdf_path.exists():
            urdf = urdf_path.read_text()

    # Run evaluation
    try:
        result = evaluate(
            checkpoint_path=args.checkpoint,
            num_episodes=args.num_episodes,
            max_steps=args.max_steps,
            initial_state=initial_state,
            urdf=urdf,
        )
    except FileNotFoundError as e:
        logger.error(f"Checkpoint not found: {e}")
        result = {"success": False, "error": str(e), "episodes": [], "metrics": {}}
    except Exception as e:
        logger.error(f"Evaluation failed: {e}", exc_info=True)
        result = {"success": False, "error": str(e), "episodes": [], "metrics": {}}

    # Output results
    output_json = json.dumps(result, indent=2)

    if args.output:
        Path(args.output).write_text(output_json)
        logger.info(f"Results written to {args.output}")
    else:
        print(output_json)

    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
