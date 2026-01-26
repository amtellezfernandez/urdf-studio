"""Artifact Storage Service.

This service provides S3/MinIO storage abstraction for training artifacts,
with fallback to local filesystem storage.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

# Environment variables for configuration
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", os.environ.get("AWS_ACCESS_KEY_ID"))
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", os.environ.get("AWS_SECRET_ACCESS_KEY"))
S3_BUCKET = os.environ.get("S3_BUCKET", "urdf-studio-artifacts")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

# Local storage settings
LOCAL_ARTIFACTS_DIR = Path(
    os.environ.get("URDF_ARTIFACTS_DIR", Path.home() / ".urdf-studio" / "artifacts")
)


@dataclass
class ArtifactMetadata:
    """Metadata for an artifact."""

    job_id: str
    artifact_path: str
    size_bytes: int
    content_type: str = "application/octet-stream"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    checksum: Optional[str] = None
    tags: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "job_id": self.job_id,
            "artifact_path": self.artifact_path,
            "size_bytes": self.size_bytes,
            "content_type": self.content_type,
            "created_at": self.created_at,
            "checksum": self.checksum,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ArtifactMetadata":
        """Create from dictionary."""
        return cls(
            job_id=data["job_id"],
            artifact_path=data["artifact_path"],
            size_bytes=data["size_bytes"],
            content_type=data.get("content_type", "application/octet-stream"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            checksum=data.get("checksum"),
            tags=data.get("tags", {}),
        )


@dataclass
class ArtifactListItem:
    """Item in artifact list."""

    path: str
    size_bytes: int
    last_modified: str
    content_type: str = "application/octet-stream"


class ArtifactStorageService:
    """Abstract base for artifact storage."""

    async def upload(
        self,
        job_id: str,
        artifact_path: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        tags: Optional[Dict[str, str]] = None,
    ) -> ArtifactMetadata:
        """Upload an artifact.

        Args:
            job_id: Training job ID
            artifact_path: Path within the job's artifacts
            data: File data (bytes or file-like object)
            content_type: MIME type
            tags: Optional metadata tags

        Returns:
            Artifact metadata
        """
        raise NotImplementedError

    async def download(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bytes:
        """Download an artifact.

        Args:
            job_id: Training job ID
            artifact_path: Path within the job's artifacts

        Returns:
            Artifact data as bytes
        """
        raise NotImplementedError

    async def list_artifacts(
        self,
        job_id: str,
        prefix: Optional[str] = None,
    ) -> List[ArtifactListItem]:
        """List artifacts for a job.

        Args:
            job_id: Training job ID
            prefix: Optional path prefix filter

        Returns:
            List of artifact items
        """
        raise NotImplementedError

    async def get_metadata(
        self,
        job_id: str,
        artifact_path: str,
    ) -> Optional[ArtifactMetadata]:
        """Get artifact metadata.

        Args:
            job_id: Training job ID
            artifact_path: Path within the job's artifacts

        Returns:
            Artifact metadata or None if not found
        """
        raise NotImplementedError

    async def delete(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bool:
        """Delete an artifact.

        Args:
            job_id: Training job ID
            artifact_path: Path within the job's artifacts

        Returns:
            True if deleted successfully
        """
        raise NotImplementedError

    async def delete_job_artifacts(
        self,
        job_id: str,
    ) -> int:
        """Delete all artifacts for a job.

        Args:
            job_id: Training job ID

        Returns:
            Number of artifacts deleted
        """
        raise NotImplementedError


class LocalArtifactStorage(ArtifactStorageService):
    """Local filesystem artifact storage."""

    def __init__(self, base_dir: Optional[Path] = None):
        """Initialize local storage.

        Args:
            base_dir: Base directory for artifacts
        """
        self.base_dir = base_dir or LOCAL_ARTIFACTS_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir = self.base_dir / ".metadata"
        self.metadata_dir.mkdir(exist_ok=True)

    def _get_artifact_path(self, job_id: str, artifact_path: str) -> Path:
        """Get full path to artifact file."""
        return self.base_dir / job_id / artifact_path

    def _get_metadata_path(self, job_id: str, artifact_path: str) -> Path:
        """Get path to metadata file."""
        safe_name = artifact_path.replace("/", "_").replace("\\", "_")
        return self.metadata_dir / job_id / f"{safe_name}.json"

    async def upload(
        self,
        job_id: str,
        artifact_path: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        tags: Optional[Dict[str, str]] = None,
    ) -> ArtifactMetadata:
        """Upload an artifact to local storage."""
        file_path = self._get_artifact_path(job_id, artifact_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Write data
        if isinstance(data, bytes):
            file_path.write_bytes(data)
            size_bytes = len(data)
        else:
            with open(file_path, "wb") as f:
                content = data.read()
                f.write(content)
                size_bytes = len(content)

        # Calculate checksum
        import hashlib

        if isinstance(data, bytes):
            checksum = hashlib.sha256(data).hexdigest()
        else:
            data.seek(0)
            checksum = hashlib.sha256(data.read()).hexdigest()

        # Create and save metadata
        metadata = ArtifactMetadata(
            job_id=job_id,
            artifact_path=artifact_path,
            size_bytes=size_bytes,
            content_type=content_type,
            checksum=checksum,
            tags=tags or {},
        )

        meta_path = self._get_metadata_path(job_id, artifact_path)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        with open(meta_path, "w") as f:
            json.dump(metadata.to_dict(), f)

        logger.info(f"Uploaded artifact: {job_id}/{artifact_path} ({size_bytes} bytes)")
        return metadata

    async def download(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bytes:
        """Download an artifact from local storage."""
        file_path = self._get_artifact_path(job_id, artifact_path)

        if not file_path.exists():
            raise FileNotFoundError(f"Artifact not found: {job_id}/{artifact_path}")

        return file_path.read_bytes()

    async def list_artifacts(
        self,
        job_id: str,
        prefix: Optional[str] = None,
    ) -> List[ArtifactListItem]:
        """List artifacts for a job."""
        job_dir = self.base_dir / job_id

        if not job_dir.exists():
            return []

        artifacts = []
        for file_path in job_dir.rglob("*"):
            if file_path.is_file():
                rel_path = str(file_path.relative_to(job_dir))

                if prefix and not rel_path.startswith(prefix):
                    continue

                stat = file_path.stat()
                artifacts.append(
                    ArtifactListItem(
                        path=rel_path,
                        size_bytes=stat.st_size,
                        last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    )
                )

        return sorted(artifacts, key=lambda x: x.path)

    async def get_metadata(
        self,
        job_id: str,
        artifact_path: str,
    ) -> Optional[ArtifactMetadata]:
        """Get artifact metadata."""
        meta_path = self._get_metadata_path(job_id, artifact_path)

        if not meta_path.exists():
            # Try to reconstruct from file
            file_path = self._get_artifact_path(job_id, artifact_path)
            if file_path.exists():
                stat = file_path.stat()
                return ArtifactMetadata(
                    job_id=job_id,
                    artifact_path=artifact_path,
                    size_bytes=stat.st_size,
                    created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                )
            return None

        with open(meta_path) as f:
            data = json.load(f)
            return ArtifactMetadata.from_dict(data)

    async def delete(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bool:
        """Delete an artifact."""
        file_path = self._get_artifact_path(job_id, artifact_path)
        meta_path = self._get_metadata_path(job_id, artifact_path)

        deleted = False
        if file_path.exists():
            file_path.unlink()
            deleted = True

        if meta_path.exists():
            meta_path.unlink()

        if deleted:
            logger.info(f"Deleted artifact: {job_id}/{artifact_path}")

        return deleted

    async def delete_job_artifacts(
        self,
        job_id: str,
    ) -> int:
        """Delete all artifacts for a job."""
        job_dir = self.base_dir / job_id
        meta_dir = self.metadata_dir / job_id

        count = 0

        if job_dir.exists():
            for file_path in job_dir.rglob("*"):
                if file_path.is_file():
                    count += 1
            shutil.rmtree(job_dir)

        if meta_dir.exists():
            shutil.rmtree(meta_dir)

        logger.info(f"Deleted {count} artifacts for job: {job_id}")
        return count


class S3ArtifactStorage(ArtifactStorageService):
    """S3/MinIO artifact storage."""

    def __init__(
        self,
        endpoint_url: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        bucket: Optional[str] = None,
        region: Optional[str] = None,
    ):
        """Initialize S3 storage.

        Args:
            endpoint_url: S3 endpoint URL (for MinIO)
            access_key: AWS access key
            secret_key: AWS secret key
            bucket: S3 bucket name
            region: AWS region
        """
        self.endpoint_url = endpoint_url or S3_ENDPOINT_URL
        self.access_key = access_key or S3_ACCESS_KEY
        self.secret_key = secret_key or S3_SECRET_KEY
        self.bucket = bucket or S3_BUCKET
        self.region = region or S3_REGION
        self._client = None

    def _get_client(self):
        """Get or create S3 client."""
        if self._client is None:
            import boto3

            config = {
                "aws_access_key_id": self.access_key,
                "aws_secret_access_key": self.secret_key,
                "region_name": self.region,
            }

            if self.endpoint_url:
                config["endpoint_url"] = self.endpoint_url

            self._client = boto3.client("s3", **config)

        return self._client

    def _get_key(self, job_id: str, artifact_path: str) -> str:
        """Get S3 key for artifact."""
        return f"jobs/{job_id}/artifacts/{artifact_path}"

    async def upload(
        self,
        job_id: str,
        artifact_path: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        tags: Optional[Dict[str, str]] = None,
    ) -> ArtifactMetadata:
        """Upload an artifact to S3."""
        import hashlib
        from io import BytesIO

        client = self._get_client()
        key = self._get_key(job_id, artifact_path)

        # Prepare data
        if isinstance(data, bytes):
            body = BytesIO(data)
            size_bytes = len(data)
            checksum = hashlib.sha256(data).hexdigest()
        else:
            content = data.read()
            body = BytesIO(content)
            size_bytes = len(content)
            checksum = hashlib.sha256(content).hexdigest()

        # Prepare metadata
        metadata = {
            "job_id": job_id,
            "artifact_path": artifact_path,
            "checksum": checksum,
            "created_at": datetime.now().isoformat(),
        }
        if tags:
            metadata.update(tags)

        # Upload
        client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            Metadata=metadata,
        )

        logger.info(f"Uploaded artifact to S3: {key} ({size_bytes} bytes)")

        return ArtifactMetadata(
            job_id=job_id,
            artifact_path=artifact_path,
            size_bytes=size_bytes,
            content_type=content_type,
            checksum=checksum,
            tags=tags or {},
        )

    async def download(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bytes:
        """Download an artifact from S3."""
        client = self._get_client()
        key = self._get_key(job_id, artifact_path)

        try:
            response = client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"].read()
        except client.exceptions.NoSuchKey:
            raise FileNotFoundError(f"Artifact not found: {job_id}/{artifact_path}")

    async def list_artifacts(
        self,
        job_id: str,
        prefix: Optional[str] = None,
    ) -> List[ArtifactListItem]:
        """List artifacts for a job from S3."""
        client = self._get_client()
        base_prefix = f"jobs/{job_id}/artifacts/"

        if prefix:
            full_prefix = f"{base_prefix}{prefix}"
        else:
            full_prefix = base_prefix

        artifacts = []
        paginator = client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=self.bucket, Prefix=full_prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                rel_path = key[len(base_prefix) :]

                artifacts.append(
                    ArtifactListItem(
                        path=rel_path,
                        size_bytes=obj["Size"],
                        last_modified=obj["LastModified"].isoformat(),
                    )
                )

        return sorted(artifacts, key=lambda x: x.path)

    async def get_metadata(
        self,
        job_id: str,
        artifact_path: str,
    ) -> Optional[ArtifactMetadata]:
        """Get artifact metadata from S3."""
        client = self._get_client()
        key = self._get_key(job_id, artifact_path)

        try:
            response = client.head_object(Bucket=self.bucket, Key=key)
            metadata = response.get("Metadata", {})

            return ArtifactMetadata(
                job_id=job_id,
                artifact_path=artifact_path,
                size_bytes=response["ContentLength"],
                content_type=response.get("ContentType", "application/octet-stream"),
                created_at=metadata.get("created_at", response["LastModified"].isoformat()),
                checksum=metadata.get("checksum"),
                tags={k: v for k, v in metadata.items() if k not in ["job_id", "artifact_path", "checksum", "created_at"]},
            )
        except client.exceptions.NoSuchKey:
            return None

    async def delete(
        self,
        job_id: str,
        artifact_path: str,
    ) -> bool:
        """Delete an artifact from S3."""
        client = self._get_client()
        key = self._get_key(job_id, artifact_path)

        try:
            client.delete_object(Bucket=self.bucket, Key=key)
            logger.info(f"Deleted artifact from S3: {key}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete artifact: {e}")
            return False

    async def delete_job_artifacts(
        self,
        job_id: str,
    ) -> int:
        """Delete all artifacts for a job from S3."""
        client = self._get_client()
        prefix = f"jobs/{job_id}/artifacts/"

        # List all objects
        objects_to_delete = []
        paginator = client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                objects_to_delete.append({"Key": obj["Key"]})

        if not objects_to_delete:
            return 0

        # Delete in batches of 1000
        count = len(objects_to_delete)
        for i in range(0, len(objects_to_delete), 1000):
            batch = objects_to_delete[i : i + 1000]
            client.delete_objects(Bucket=self.bucket, Delete={"Objects": batch})

        logger.info(f"Deleted {count} artifacts from S3 for job: {job_id}")
        return count


# Factory function
_storage: Optional[ArtifactStorageService] = None


def get_artifact_storage(use_s3: Optional[bool] = None) -> ArtifactStorageService:
    """Get the artifact storage service.

    Args:
        use_s3: Force S3 or local storage (None = auto-detect from env)

    Returns:
        ArtifactStorageService instance
    """
    global _storage

    if _storage is not None:
        return _storage

    # Auto-detect storage type
    if use_s3 is None:
        use_s3 = bool(S3_ENDPOINT_URL or S3_ACCESS_KEY)

    if use_s3:
        logger.info("Using S3 artifact storage")
        _storage = S3ArtifactStorage()
    else:
        logger.info("Using local artifact storage")
        _storage = LocalArtifactStorage()

    return _storage
