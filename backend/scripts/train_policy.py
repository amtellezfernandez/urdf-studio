#!/usr/bin/env python3
"""Training script for robot policies.

This script is launched as a subprocess by the training service.
It handles the actual training loop using LeRobot.

Usage:
    python train_policy.py --config config.json

The script:
1. Loads configuration from JSON
2. Sets up dataset and model using LeRobot
3. Initializes experiment tracking
4. Runs training loop with progress reporting
5. Saves checkpoints and final model

Requirements:
    - LeRobot >= 0.4.0 must be installed
    - PyTorch with CUDA support recommended
    - HuggingFace token for most datasets
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import torch
from torch.utils.data import DataLoader

# LeRobot 0.4.x imports
from lerobot.datasets.factory import make_dataset
from lerobot.policies.factory import make_policy
from lerobot.configs.default import DatasetConfig
from lerobot.configs.policies import PreTrainedConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


POLICY_ID_ALIASES = {
    "act": "act",
    "diffusion": "diffusion",
    "diffusion_policy": "diffusion",
    "tdmpc": "tdmpc",
    "vqbet": "vqbet",
    "vq_bet": "vqbet",
}


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Train robot policy")
    parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to training config JSON",
    )
    return parser.parse_args()


def load_config(config_path: str) -> Dict[str, Any]:
    """Load configuration from JSON file."""
    with open(config_path) as f:
        return json.load(f)


def set_seed(seed: int) -> None:
    """Set random seeds for reproducibility.

    Args:
        seed: Random seed value
    """
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    # Make CuDNN deterministic (may impact performance)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    logger.info(f"Set random seed: {seed}")


def get_tracker(tracker_config: Optional[Dict[str, Any]]) -> Optional[Any]:
    """Initialize experiment tracker from config.

    Args:
        tracker_config: Tracker configuration dict with 'type' key

    Returns:
        Initialized tracker or None if disabled
    """
    if not tracker_config:
        return None

    tracker_type = tracker_config.get("type", "none")
    if tracker_type == "none":
        return None

    try:
        from backend.robotops import get_tracker as _get_tracker
        tracker = _get_tracker(tracker_config)
        logger.info(f"Initialized {tracker_type} tracker")
        return tracker
    except ImportError:
        logger.warning("Could not import tracker backend, metrics will not be logged")
        return None
    except Exception as e:
        logger.warning(f"Failed to initialize tracker: {e}")
        return None


def write_progress(
    job_dir: Path,
    current_epoch: int,
    total_epochs: int,
    current_step: int,
    total_steps: int,
    metrics: Dict[str, float],
) -> None:
    """Write progress to file for status polling."""
    progress = {
        "current_epoch": current_epoch,
        "total_epochs": total_epochs,
        "current_step": current_step,
        "total_steps": total_steps,
        "metrics": metrics,
        "updated_at": datetime.now().isoformat(),
    }

    progress_file = job_dir / "progress.json"
    with open(progress_file, "w") as f:
        json.dump(progress, f, indent=2)


def append_metrics(
    job_dir: Path,
    step: int,
    epoch: int,
    metrics: Dict[str, float],
) -> None:
    """Append a metrics snapshot for charting and log replay."""
    entry = {
        "step": step,
        "epoch": epoch,
        "timestamp": datetime.now().isoformat(),
        **metrics,
    }

    metrics_file = job_dir / "metrics.jsonl"
    with open(metrics_file, "a") as f:
        f.write(json.dumps(entry) + "\n")


def normalize_policy_id(architecture: str) -> str:
    """Normalize public policy IDs to LeRobot implementation IDs."""
    normalized = POLICY_ID_ALIASES.get(architecture)
    if not normalized:
        raise ValueError(f"Unknown architecture: {architecture}")
    return normalized


def get_policy_config_class(architecture: str):
    """Get the config class for a given policy architecture."""
    architecture = normalize_policy_id(architecture)
    if architecture == "act":
        from lerobot.policies import ACTConfig
        return ACTConfig
    elif architecture == "diffusion":
        from lerobot.policies import DiffusionConfig
        return DiffusionConfig
    elif architecture == "tdmpc":
        from lerobot.policies import TDMPCConfig
        return TDMPCConfig
    elif architecture == "vqbet":
        from lerobot.policies import VQBeTConfig
        return VQBeTConfig
    else:
        raise ValueError(f"Unknown architecture: {architecture}")


def get_policy_class(architecture: str):
    """Get the policy class for a given architecture."""
    architecture = normalize_policy_id(architecture)
    if architecture == "act":
        from lerobot.policies.act.modeling_act import ACTPolicy
        return ACTPolicy
    elif architecture == "diffusion":
        from lerobot.policies.diffusion.modeling_diffusion import DiffusionPolicy
        return DiffusionPolicy
    elif architecture == "tdmpc":
        from lerobot.policies.tdmpc.modeling_tdmpc import TDMPCPolicy
        return TDMPCPolicy
    elif architecture == "vqbet":
        from lerobot.policies.vqbet.modeling_vqbet import VQBeTPolicy
        return VQBeTPolicy
    else:
        raise ValueError(f"Unknown architecture: {architecture}")


def train_with_lerobot(config: Dict[str, Any], job_dir: Path) -> None:
    """Train using LeRobot library.

    Args:
        config: Training configuration dictionary containing:
            - dataset: Dataset configuration (source, repo_id or local_path)
            - model: Model configuration (architecture, config)
            - training: Training parameters (epochs, batch_size, learning_rate, etc.)
            - tracker: Tracker configuration (type, tracking_uri, etc.)
        job_dir: Directory for saving outputs

    Raises:
        ValueError: If dataset configuration is invalid
        RuntimeError: If training fails
    """
    logger.info("Starting LeRobot training")

    # Extract configs
    dataset_config = config.get("dataset", {})
    model_config = config.get("model", {})
    training_config = config.get("training", {})
    tracker_config = config.get("tracker", {})

    # =========================================================================
    # 0. Set seed for reproducibility
    # =========================================================================
    seed = training_config.get("seed", 42)
    set_seed(seed)

    # =========================================================================
    # 0b. Initialize experiment tracker
    # =========================================================================
    tracker = get_tracker(tracker_config)
    job_id = os.environ.get("URDF_STUDIO_JOB_ID", "unknown")

    if tracker:
        try:
            run_name = training_config.get("run_name") or f"{model_config.get('architecture', 'policy')}_{job_id}"
            tracker.init_run(
                run_name=run_name,
                config={
                    "dataset": dataset_config,
                    "model": model_config,
                    "training": training_config,
                    "seed": seed,
                },
                tags={"job_id": job_id},
            )
            dataset_id = dataset_config.get("repo_id") or dataset_config.get("local_path") or "unknown"
            tracker.log_dataset_lineage(
                dataset_id=dataset_id,
                version=dataset_config.get("version", "latest"),
                source=dataset_config.get("source", "huggingface"),
            )
            tracker.log_model_config(
                architecture=model_config.get("architecture", "act"),
                config=model_config.get("config", {}),
            )
        except Exception as e:
            logger.warning(f"Tracker initialization failed; continuing without tracker: {e}")
            tracker = None

    # =========================================================================
    # 1. Setup configs
    # =========================================================================
    repo_id = dataset_config.get("repo_id")
    if dataset_config.get("source") == "huggingface" and repo_id:
        logger.info(f"Loading dataset from HuggingFace: {repo_id}")
    elif dataset_config.get("source") == "local":
        repo_id = dataset_config.get("local_path")
        logger.info(f"Loading dataset from local path: {repo_id}")
    else:
        raise ValueError(f"Invalid dataset config: {dataset_config}")

    # Determine architecture and device
    architecture = normalize_policy_id(model_config.get("architecture", "act"))
    policy_overrides = model_config.get("config", {})
    device_str = config.get("device", "cuda" if torch.cuda.is_available() else "cpu")

    logger.info(f"Creating {architecture} policy on {device_str}")

    # Get policy config class
    PolicyConfigClass = get_policy_config_class(architecture)

    # Create policy config
    policy_cfg = PolicyConfigClass(
        device=device_str,
        push_to_hub=False,
        repo_id=f"local/{job_dir.name}",
        **policy_overrides,
    )

    # Create dataset config for LeRobot
    from lerobot.configs.train import TrainPipelineConfig

    ds_cfg = DatasetConfig(repo_id=repo_id)

    # Create training pipeline config with policy
    configured_steps = training_config.get("max_steps") or training_config.get("steps")
    train_cfg = TrainPipelineConfig(
        dataset=ds_cfg,
        policy=policy_cfg,
        output_dir=job_dir,
        batch_size=training_config.get("batch_size", 8),
        num_workers=training_config.get("num_workers", 4),
        steps=configured_steps or training_config.get("epochs", 100) * 1000,
    )

    # =========================================================================
    # 2. Load dataset
    # =========================================================================
    dataset = make_dataset(train_cfg)
    logger.info(f"Dataset loaded: {len(dataset)} samples")
    logger.info(f"Dataset meta: {dataset.meta}")

    # =========================================================================
    # 3. Create policy
    # =========================================================================
    policy = make_policy(policy_cfg, ds_meta=dataset.meta)

    device = torch.device(device_str)
    logger.info(f"Using device: {device}")
    logger.info(f"Policy parameters: {sum(p.numel() for p in policy.parameters()):,}")

    # =========================================================================
    # 3. Setup training
    # =========================================================================
    # Optimizer
    learning_rate = training_config.get("learning_rate", 1e-5)
    weight_decay = training_config.get("weight_decay", 1e-4)
    grad_clip_norm = training_config.get("max_grad_norm", training_config.get("grad_clip_norm", 10.0))

    optimizer = torch.optim.AdamW(
        policy.parameters(),
        lr=learning_rate,
        weight_decay=weight_decay,
    )

    # DataLoader
    batch_size = training_config.get("batch_size", 8)
    num_workers = training_config.get("num_workers", 4)

    dataloader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True if device.type == "cuda" else False,
    )

    # Calculate total steps
    total_epochs = training_config.get("epochs", 1)
    steps_per_epoch = len(dataloader)
    requested_max_steps = training_config.get("max_steps") or training_config.get("steps")
    full_total_steps = total_epochs * steps_per_epoch
    total_steps = min(full_total_steps, requested_max_steps) if requested_max_steps else full_total_steps

    logger.info(f"Training config: {total_epochs} epochs, {steps_per_epoch} steps/epoch, batch_size={batch_size}")
    if requested_max_steps:
        logger.info(f"Max steps enabled: {requested_max_steps} (full epoch plan would be {full_total_steps})")
    logger.info(f"Total optimizer steps: {total_steps}")

    # =========================================================================
    # 4. Training loop
    # =========================================================================
    checkpoint_interval = training_config.get("checkpoint_interval", 10)
    log_interval = training_config.get("log_interval", 100)

    global_step = 0

    for epoch in range(total_epochs):
        policy.train()
        epoch_loss = 0.0
        epoch_steps = 0

        for step, batch in enumerate(dataloader):
            if global_step >= total_steps:
                break

            # Move batch to device
            batch = {k: v.to(device) if isinstance(v, torch.Tensor) else v for k, v in batch.items()}

            # Forward pass - returns (loss, info_dict)
            loss, info = policy.forward(batch)

            # Backward pass
            optimizer.zero_grad()
            loss.backward()

            # Gradient clipping
            if grad_clip_norm > 0:
                torch.nn.utils.clip_grad_norm_(policy.parameters(), grad_clip_norm)

            optimizer.step()

            # Accumulate metrics
            loss_val = loss.item()
            epoch_loss += loss_val
            epoch_steps += 1
            global_step += 1

            # Write progress to file (for status polling)
            metrics_dict = {
                "loss": loss_val,
                "learning_rate": learning_rate,
                "epoch_avg_loss": epoch_loss / epoch_steps,
            }
            write_progress(
                job_dir=job_dir,
                current_epoch=epoch,
                total_epochs=total_epochs,
                current_step=global_step,
                total_steps=total_steps,
                metrics=metrics_dict,
            )
            append_metrics(
                job_dir=job_dir,
                step=global_step,
                epoch=epoch,
                metrics=metrics_dict,
            )

            # Log metrics to experiment tracker (real-time)
            if tracker:
                try:
                    tracker.log_metrics(
                        metrics={
                            "train/loss": loss_val,
                            "train/learning_rate": learning_rate,
                            "train/epoch_avg_loss": epoch_loss / epoch_steps,
                            "train/epoch": epoch,
                        },
                        step=global_step,
                    )
                except Exception as e:
                    logger.warning(f"Tracker metric logging failed: {e}")

            # Log periodically
            if (step + 1) % log_interval == 0:
                logger.info(
                    f"Epoch {epoch + 1}/{total_epochs} - Step {step + 1}/{steps_per_epoch} - "
                    f"Loss: {loss_val:.4f} - Avg: {epoch_loss / epoch_steps:.4f}"
                )

        # Epoch summary
        if epoch_steps == 0:
            break

        avg_loss = epoch_loss / epoch_steps
        logger.info(f"Epoch {epoch + 1}/{total_epochs} completed - Avg Loss: {avg_loss:.4f}")

        # Save checkpoint
        if (epoch + 1) % checkpoint_interval == 0:
            checkpoint_dir = job_dir / f"checkpoint_epoch_{epoch + 1}"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            # Save using LeRobot's format
            policy.save_pretrained(str(checkpoint_dir))

            # Also save optimizer state
            torch.save(
                {
                    "epoch": epoch,
                    "global_step": global_step,
                    "optimizer_state_dict": optimizer.state_dict(),
                    "config": config,
                    "loss": avg_loss,
                },
                checkpoint_dir / "training_state.pt",
            )
            logger.info(f"Saved checkpoint: {checkpoint_dir}")

        if global_step >= total_steps:
            logger.info(f"Reached configured training step limit: {total_steps}")
            break

    # =========================================================================
    # 5. Save final model
    # =========================================================================
    final_model_dir = job_dir / "final_model"
    final_model_dir.mkdir(parents=True, exist_ok=True)

    # Save using LeRobot's format
    policy.save_pretrained(str(final_model_dir))
    logger.info(f"Saved final model: {final_model_dir}")

    # Save training config
    config_path = job_dir / "training_config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    # Final progress
    write_progress(
        job_dir=job_dir,
        current_epoch=total_epochs,
        total_epochs=total_epochs,
        current_step=total_steps,
        total_steps=total_steps,
        metrics={"loss": avg_loss, "learning_rate": 0},
    )

    # Log final metrics and finish tracker
    if tracker:
        try:
            tracker.log_metrics(
                metrics={
                    "train/final_loss": avg_loss,
                    "train/total_steps": total_steps,
                    "train/total_epochs": total_epochs,
                },
                step=total_steps,
            )
            tracker.log_artifact(final_model_dir, "model")
            tracker.finish_run("completed")
            logger.info(f"Logged training results to tracker: {tracker.get_run_url()}")
        except Exception as e:
            logger.warning(f"Tracker finalization failed: {e}")

    logger.info("Training completed successfully!")


def main() -> int:
    """Main entry point."""
    args = parse_args()

    logger.info(f"Starting training with config: {args.config}")

    try:
        config = load_config(args.config)
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return 1

    # Get job directory from environment or config
    job_id = os.environ.get("URDF_STUDIO_JOB_ID", "unknown")
    job_dir = Path(os.environ.get("URDF_STUDIO_JOB_DIR", "."))

    # Ensure job directory exists
    job_dir.mkdir(parents=True, exist_ok=True)

    train_log = job_dir / "train.log"
    file_handler = logging.FileHandler(train_log)
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logging.getLogger().addHandler(file_handler)

    logger.info(f"Job ID: {job_id}")
    logger.info(f"Job directory: {job_dir}")

    try:
        # Run training
        train_with_lerobot(config, job_dir)
        return 0

    except KeyboardInterrupt:
        logger.info("Training interrupted by user")
        return 130

    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
