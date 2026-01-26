"""HuggingFace dataset revision resolver.

This service resolves HuggingFace dataset revisions to specific commit SHAs
for reproducibility and version pinning.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def resolve_dataset_revision(
    repo_id: str,
    revision: Optional[str] = None,
) -> str:
    """Resolve HuggingFace dataset to commit SHA.

    Uses huggingface_hub to get the actual commit SHA for a given revision.
    If revision is None or "main", resolves to the latest commit.

    Args:
        repo_id: HuggingFace dataset repository ID (e.g., 'lerobot/aloha_sim_insertion')
        revision: Optional revision (branch, tag, or commit SHA)

    Returns:
        The resolved commit SHA

    Raises:
        ValueError: If the dataset or revision cannot be found
    """
    try:
        from huggingface_hub import HfApi, hf_hub_download
        from huggingface_hub.utils import RepositoryNotFoundError, RevisionNotFoundError

        api = HfApi()

        # Use the default revision if none specified
        target_revision = revision if revision else "main"

        try:
            # Get dataset info to resolve the commit SHA
            dataset_info = api.dataset_info(
                repo_id=repo_id,
                revision=target_revision,
            )

            commit_sha = dataset_info.sha
            logger.info(
                f"Resolved dataset {repo_id}@{target_revision} to commit {commit_sha}"
            )
            return commit_sha

        except RepositoryNotFoundError:
            raise ValueError(f"Dataset not found: {repo_id}")
        except RevisionNotFoundError:
            raise ValueError(f"Revision not found: {repo_id}@{target_revision}")

    except ImportError:
        logger.warning(
            "huggingface_hub not installed. Using revision as-is without resolution."
        )
        return revision or "main"

    except Exception as e:
        logger.error(f"Failed to resolve dataset revision: {e}")
        raise ValueError(f"Failed to resolve revision for {repo_id}: {e}")


async def validate_dataset_exists(repo_id: str) -> bool:
    """Check if a HuggingFace dataset exists.

    Args:
        repo_id: HuggingFace dataset repository ID

    Returns:
        True if the dataset exists, False otherwise
    """
    try:
        from huggingface_hub import HfApi
        from huggingface_hub.utils import RepositoryNotFoundError

        api = HfApi()

        try:
            api.dataset_info(repo_id=repo_id)
            return True
        except RepositoryNotFoundError:
            return False

    except ImportError:
        logger.warning("huggingface_hub not installed. Cannot validate dataset.")
        return True  # Assume valid if we can't check

    except Exception as e:
        logger.error(f"Error validating dataset: {e}")
        return False


async def get_dataset_metadata(repo_id: str, revision: Optional[str] = None) -> dict:
    """Get metadata for a HuggingFace dataset.

    Args:
        repo_id: HuggingFace dataset repository ID
        revision: Optional revision

    Returns:
        Dictionary with dataset metadata
    """
    try:
        from huggingface_hub import HfApi

        api = HfApi()
        target_revision = revision if revision else "main"

        dataset_info = api.dataset_info(
            repo_id=repo_id,
            revision=target_revision,
        )

        return {
            "id": dataset_info.id,
            "sha": dataset_info.sha,
            "author": dataset_info.author,
            "created_at": dataset_info.created_at.isoformat() if dataset_info.created_at else None,
            "last_modified": dataset_info.last_modified.isoformat() if dataset_info.last_modified else None,
            "downloads": dataset_info.downloads,
            "likes": dataset_info.likes,
            "tags": dataset_info.tags,
            "card_data": dataset_info.card_data.__dict__ if dataset_info.card_data else None,
        }

    except ImportError:
        logger.warning("huggingface_hub not installed.")
        return {"id": repo_id, "sha": revision or "main"}

    except Exception as e:
        logger.error(f"Error getting dataset metadata: {e}")
        return {"id": repo_id, "sha": revision or "main", "error": str(e)}
