"""Model Export Service.

This service provides functionality for exporting trained models
to HuggingFace Hub.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class ExportResult:
    """Result of a model export operation."""

    success: bool
    repo_url: Optional[str] = None
    commit_hash: Optional[str] = None
    error: Optional[str] = None


class ModelExportService:
    """Service for exporting models to HuggingFace Hub."""

    def __init__(self, hf_token: Optional[str] = None):
        """Initialize the export service.

        Args:
            hf_token: HuggingFace API token. Falls back to HF_TOKEN env var.
        """
        self.hf_token = hf_token or os.environ.get("HF_TOKEN")

    async def export_to_hf(
        self,
        run_id: str,
        checkpoint_name: str,
        repo_id: str,
        private: bool = False,
        commit_message: Optional[str] = None,
    ) -> ExportResult:
        """Export a checkpoint to HuggingFace Hub.

        Args:
            run_id: Training job ID
            checkpoint_name: Name of checkpoint (e.g., "final_model", "checkpoint_epoch_10")
            repo_id: HuggingFace repo ID (e.g., "username/model-name")
            private: Whether to create private repo (v0.1: False only)
            commit_message: Optional commit message

        Returns:
            ExportResult with repo_url and commit_hash on success
        """
        if private:
            return ExportResult(success=False, error="Private repos not supported in v0.1")

        if not self.hf_token:
            return ExportResult(success=False, error="HF_TOKEN not configured")

        try:
            from huggingface_hub import HfApi, create_repo

            # Get job info and checkpoint path
            from backend.services.job_store import get_job_store

            store = get_job_store()
            job = await store.get_job(run_id)
            if not job:
                return ExportResult(success=False, error=f"Job {run_id} not found")

            # Find checkpoint directory
            job_dir = self._get_job_dir(run_id)
            checkpoint_dir = job_dir / checkpoint_name
            if not checkpoint_dir.exists():
                return ExportResult(
                    success=False, error=f"Checkpoint {checkpoint_name} not found"
                )

            # Create bundle in temp directory
            with tempfile.TemporaryDirectory() as tmpdir:
                bundle_dir = Path(tmpdir) / "bundle"
                bundle_dir.mkdir()

                # Copy checkpoint files
                self._copy_checkpoint(checkpoint_dir, bundle_dir)

                # Add metadata files
                self._add_training_config(job, bundle_dir)
                self._add_dataset_ref(job, bundle_dir)
                self._add_urdf_hash(job, bundle_dir)
                self._add_eval_summary(run_id, bundle_dir)
                self._add_model_card(job, repo_id, bundle_dir)

                # Create repo and upload
                api = HfApi(token=self.hf_token)

                try:
                    create_repo(repo_id, token=self.hf_token, exist_ok=True)
                except Exception as e:
                    logger.warning(f"Repo creation: {e}")

                # Upload folder
                commit_info = api.upload_folder(
                    folder_path=str(bundle_dir),
                    repo_id=repo_id,
                    commit_message=commit_message
                    or f"Upload model from {run_id}/{checkpoint_name}",
                )

                return ExportResult(
                    success=True,
                    repo_url=f"https://huggingface.co/{repo_id}",
                    commit_hash=commit_info.commit_url.split("/")[-1]
                    if commit_info.commit_url
                    else None,
                )

        except ImportError:
            return ExportResult(success=False, error="huggingface_hub not installed")
        except Exception as e:
            logger.error(f"Export failed: {e}", exc_info=True)
            return ExportResult(success=False, error=str(e))

    def _get_job_dir(self, run_id: str) -> Path:
        """Get job output directory."""
        output_dir = os.environ.get("OUTPUT_DIR", "./outputs")
        return Path(output_dir) / run_id

    def _copy_checkpoint(self, src: Path, dst: Path) -> None:
        """Copy checkpoint files to bundle."""
        for item in src.iterdir():
            if item.is_file():
                shutil.copy2(item, dst / item.name)
            elif item.is_dir():
                shutil.copytree(item, dst / item.name)

    def _add_training_config(self, job: Any, bundle_dir: Path) -> None:
        """Add training configuration to bundle."""
        config = job.config if hasattr(job, "config") else {}
        config_path = bundle_dir / "training_config.json"
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2, default=str)

    def _add_dataset_ref(self, job: Any, bundle_dir: Path) -> None:
        """Add dataset reference to bundle."""
        config = job.config if hasattr(job, "config") else {}
        dataset_config = config.get("dataset", {})

        ref = {
            "source": dataset_config.get("source", "unknown"),
            "repo_id": dataset_config.get("repo_id"),
            "version": dataset_config.get("version"),
            "resolved_revision": dataset_config.get("resolved_revision"),
        }

        ref_path = bundle_dir / "dataset_ref.json"
        with open(ref_path, "w") as f:
            json.dump(ref, f, indent=2)

    def _add_urdf_hash(self, job: Any, bundle_dir: Path) -> None:
        """Add URDF hash to bundle."""
        config = job.config if hasattr(job, "config") else {}
        urdf_hash = config.get("urdf_hash")

        if urdf_hash:
            hash_path = bundle_dir / "urdf_hash.txt"
            with open(hash_path, "w") as f:
                f.write(urdf_hash)

    def _add_eval_summary(self, run_id: str, bundle_dir: Path) -> None:
        """Add evaluation summary if available."""
        # TODO: Query evaluations table for this run
        # For now, skip if no eval data
        pass

    def _add_model_card(self, job: Any, repo_id: str, bundle_dir: Path) -> None:
        """Generate and add model card (README.md)."""
        config = job.config if hasattr(job, "config") else {}
        dataset_config = config.get("dataset", {})
        model_config = config.get("model", {})
        training_config = config.get("training", {})

        resolved_revision = dataset_config.get("resolved_revision")
        revision_short = resolved_revision[:8] if resolved_revision else "unknown"

        card = f"""---
tags:
- robotics
- imitation-learning
- lerobot
library_name: lerobot
---

# {repo_id.split('/')[-1]}

This model was trained using [URDF Studio](https://github.com/your-org/urdf-studio).

## Model Details

- **Architecture**: {model_config.get('architecture', 'unknown')}
- **Dataset**: {dataset_config.get('repo_id', 'unknown')}
- **Dataset Version**: {revision_short}

## Training Configuration

- **Epochs**: {training_config.get('epochs', 'N/A')}
- **Batch Size**: {training_config.get('batch_size', 'N/A')}
- **Learning Rate**: {training_config.get('learning_rate', 'N/A')}
- **Seed**: {training_config.get('seed', 'N/A')}

## Usage

```python
from lerobot.policies import ACTPolicy  # or appropriate policy class

policy = ACTPolicy.from_pretrained("{repo_id}")
```

## Training Provenance

This model bundle includes:
- `config.json` - Policy configuration
- `training_config.json` - Full training parameters
- `dataset_ref.json` - Dataset reference with version
- `urdf_hash.txt` - Robot URDF hash (if available)

Generated by URDF Studio RobotMLOps v0.1
"""

        readme_path = bundle_dir / "README.md"
        with open(readme_path, "w") as f:
            f.write(card)


# Singleton
_export_service: Optional[ModelExportService] = None


def get_export_service() -> ModelExportService:
    """Get the model export service singleton.

    Returns:
        ModelExportService instance
    """
    global _export_service
    if _export_service is None:
        _export_service = ModelExportService()
    return _export_service
