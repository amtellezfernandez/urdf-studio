"""Dataset Browser Service.

This service provides functionality to browse and search LeRobot datasets
from HuggingFace Hub, with local caching for performance.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Cache settings
CACHE_DIR = Path(os.environ.get("URDF_CACHE_DIR", Path.home() / ".cache" / "urdf-studio"))
CACHE_FILE = CACHE_DIR / "datasets_cache.json"
CACHE_TTL_SECONDS = 3600  # 1 hour

# HuggingFace API settings
HF_API_BASE = "https://huggingface.co/api"
HF_DATASETS_API = f"{HF_API_BASE}/datasets"

# Popular LeRobot datasets
POPULAR_DATASETS = [
    "lerobot/pusht",
    "lerobot/pusht_image",
    "lerobot/aloha_sim_insertion_human",
    "lerobot/aloha_sim_insertion_scripted",
    "lerobot/aloha_sim_transfer_cube_human",
    "lerobot/aloha_sim_transfer_cube_scripted",
    "lerobot/aloha_static_battery",
    "lerobot/aloha_static_candy",
    "lerobot/aloha_static_coffee",
    "lerobot/aloha_static_cups_open",
    "lerobot/libero_spatial_no_noops",
    "lerobot/libero_object_no_noops",
    "lerobot/libero_goal_no_noops",
    "lerobot/libero_10_no_noops",
    "lerobot/xarm_lift_medium",
    "lerobot/xarm_lift_medium_replay",
    "lerobot/xarm_push_medium",
    "lerobot/xarm_push_medium_replay",
]


@dataclass
class DatasetInfo:
    """Information about a dataset."""

    repo_id: str
    description: Optional[str] = None
    downloads: int = 0
    likes: int = 0
    tags: List[str] = field(default_factory=list)
    last_modified: Optional[str] = None
    # LeRobot specific metadata
    num_episodes: Optional[int] = None
    num_frames: Optional[int] = None
    robot_type: Optional[str] = None
    fps: Optional[int] = None
    features: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "repo_id": self.repo_id,
            "description": self.description,
            "downloads": self.downloads,
            "likes": self.likes,
            "tags": self.tags,
            "last_modified": self.last_modified,
            "num_episodes": self.num_episodes,
            "num_frames": self.num_frames,
            "robot_type": self.robot_type,
            "fps": self.fps,
            "features": self.features,
        }


@dataclass
class DatasetSearchResult:
    """Search results from HuggingFace."""

    datasets: List[DatasetInfo]
    total: int
    query: str


class DatasetBrowserService:
    """Service for browsing and searching datasets."""

    def __init__(self, cache_dir: Optional[Path] = None):
        """Initialize the service.

        Args:
            cache_dir: Optional custom cache directory
        """
        self.cache_dir = cache_dir or CACHE_DIR
        self.cache_file = self.cache_dir / "datasets_cache.json"
        self._ensure_cache_dir()
        self._cache: Dict[str, Any] = {}
        self._cache_loaded = False

    def _ensure_cache_dir(self) -> None:
        """Ensure cache directory exists."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _load_cache(self) -> None:
        """Load cache from disk."""
        if self._cache_loaded:
            return

        if self.cache_file.exists():
            try:
                with open(self.cache_file) as f:
                    data = json.load(f)
                    # Check cache age
                    cache_time = data.get("timestamp", 0)
                    if time.time() - cache_time < CACHE_TTL_SECONDS:
                        self._cache = data.get("data", {})
                        logger.debug("Loaded dataset cache from disk")
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Failed to load cache: {e}")

        self._cache_loaded = True

    def _save_cache(self) -> None:
        """Save cache to disk."""
        try:
            cache_data = {
                "timestamp": time.time(),
                "data": self._cache,
            }
            with open(self.cache_file, "w") as f:
                json.dump(cache_data, f)
            logger.debug("Saved dataset cache to disk")
        except OSError as e:
            logger.warning(f"Failed to save cache: {e}")

    def _get_cached(self, key: str) -> Optional[Dict[str, Any]]:
        """Get value from cache."""
        self._load_cache()
        return self._cache.get(key)

    def _set_cached(self, key: str, value: Dict[str, Any]) -> None:
        """Set value in cache."""
        self._cache[key] = value
        self._save_cache()

    async def list_popular_datasets(self) -> List[DatasetInfo]:
        """List popular LeRobot datasets.

        Returns:
            List of popular dataset info
        """
        cached = self._get_cached("popular")
        if cached:
            return [DatasetInfo(**d) for d in cached]

        datasets = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            for repo_id in POPULAR_DATASETS:
                try:
                    info = await self._fetch_dataset_info(client, repo_id)
                    if info:
                        datasets.append(info)
                except Exception as e:
                    logger.warning(f"Failed to fetch {repo_id}: {e}")
                    # Add minimal info
                    datasets.append(DatasetInfo(repo_id=repo_id))

        # Cache the results
        self._set_cached("popular", [d.to_dict() for d in datasets])
        return datasets

    async def search_datasets(
        self,
        query: str,
        limit: int = 20,
        author: Optional[str] = None,
    ) -> DatasetSearchResult:
        """Search for datasets on HuggingFace.

        Args:
            query: Search query
            limit: Maximum results to return
            author: Optional author filter (e.g., 'lerobot')

        Returns:
            Search results
        """
        cache_key = f"search:{query}:{limit}:{author}"
        cached = self._get_cached(cache_key)
        if cached:
            return DatasetSearchResult(
                datasets=[DatasetInfo(**d) for d in cached["datasets"]],
                total=cached["total"],
                query=query,
            )

        params = {
            "search": query,
            "limit": limit,
            "full": "true",
        }
        if author:
            params["author"] = author

        datasets = []
        total = 0

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(HF_DATASETS_API, params=params)
                response.raise_for_status()
                results = response.json()

                total = len(results)
                for item in results:
                    datasets.append(
                        DatasetInfo(
                            repo_id=item.get("id", ""),
                            description=item.get("description", ""),
                            downloads=item.get("downloads", 0),
                            likes=item.get("likes", 0),
                            tags=item.get("tags", []),
                            last_modified=item.get("lastModified"),
                        )
                    )

        except httpx.HTTPError as e:
            logger.error(f"HuggingFace API error: {e}")
            raise

        result = DatasetSearchResult(
            datasets=datasets,
            total=total,
            query=query,
        )

        # Cache the results
        self._set_cached(
            cache_key,
            {
                "datasets": [d.to_dict() for d in datasets],
                "total": total,
            },
        )

        return result

    async def get_dataset_info(self, repo_id: str) -> Optional[DatasetInfo]:
        """Get detailed info for a specific dataset.

        Args:
            repo_id: HuggingFace dataset ID (e.g., 'lerobot/pusht')

        Returns:
            Dataset info or None if not found
        """
        cache_key = f"info:{repo_id}"
        cached = self._get_cached(cache_key)
        if cached:
            return DatasetInfo(**cached)

        async with httpx.AsyncClient(timeout=30.0) as client:
            info = await self._fetch_dataset_info(client, repo_id, fetch_metadata=True)

            if info:
                self._set_cached(cache_key, info.to_dict())

            return info

    async def _fetch_dataset_info(
        self,
        client: httpx.AsyncClient,
        repo_id: str,
        fetch_metadata: bool = False,
    ) -> Optional[DatasetInfo]:
        """Fetch dataset info from HuggingFace API.

        Args:
            client: HTTP client
            repo_id: Dataset repo ID
            fetch_metadata: Whether to fetch LeRobot metadata

        Returns:
            Dataset info or None
        """
        try:
            # Get basic info from datasets API
            url = f"{HF_DATASETS_API}/{repo_id}"
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            info = DatasetInfo(
                repo_id=repo_id,
                description=data.get("description"),
                downloads=data.get("downloads", 0),
                likes=data.get("likes", 0),
                tags=data.get("tags", []),
                last_modified=data.get("lastModified"),
            )

            # Try to fetch LeRobot-specific metadata
            if fetch_metadata:
                await self._fetch_lerobot_metadata(client, repo_id, info)

            return info

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"Dataset not found: {repo_id}")
                return None
            raise
        except httpx.HTTPError as e:
            logger.error(f"Failed to fetch dataset info: {e}")
            raise

    async def _fetch_lerobot_metadata(
        self,
        client: httpx.AsyncClient,
        repo_id: str,
        info: DatasetInfo,
    ) -> None:
        """Fetch LeRobot-specific metadata from dataset files.

        Args:
            client: HTTP client
            repo_id: Dataset repo ID
            info: DatasetInfo to update
        """
        try:
            # Try to fetch meta/info.json which LeRobot datasets have
            meta_url = f"https://huggingface.co/datasets/{repo_id}/raw/main/meta/info.json"
            response = await client.get(meta_url)

            if response.status_code == 200:
                meta = response.json()
                info.num_episodes = meta.get("total_episodes")
                info.num_frames = meta.get("total_frames")
                info.robot_type = meta.get("robot_type")
                info.fps = meta.get("fps")
                info.features = meta.get("features", {})
                return

            # Fallback: try episodes.jsonl to count episodes
            episodes_url = f"https://huggingface.co/datasets/{repo_id}/raw/main/meta/episodes.jsonl"
            response = await client.get(episodes_url)

            if response.status_code == 200:
                lines = response.text.strip().split("\n")
                info.num_episodes = len(lines)

        except Exception as e:
            logger.debug(f"Could not fetch LeRobot metadata for {repo_id}: {e}")

    def clear_cache(self) -> None:
        """Clear the dataset cache."""
        self._cache = {}
        if self.cache_file.exists():
            self.cache_file.unlink()
        logger.info("Dataset cache cleared")


# Singleton instance
_service: Optional[DatasetBrowserService] = None


def get_dataset_browser_service() -> DatasetBrowserService:
    """Get the dataset browser service singleton.

    Returns:
        DatasetBrowserService instance
    """
    global _service
    if _service is None:
        _service = DatasetBrowserService()
    return _service
