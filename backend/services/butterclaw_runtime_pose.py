from __future__ import annotations

import json
from pathlib import Path

from backend.core.settings import settings
from backend.models.runtime_integrations import (
    ButterClawRuntimePoseResponse,
    ButterClawRuntimePoseSnapshot,
)


class ButterClawRuntimePoseService:
    def __init__(self, pose_path: str) -> None:
        self._pose_path = Path(pose_path)

    def get_pose(self) -> ButterClawRuntimePoseResponse:
        if not self._pose_path.exists():
            return ButterClawRuntimePoseResponse(source_path=str(self._pose_path), pose=None)

        try:
            payload = json.loads(self._pose_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return ButterClawRuntimePoseResponse(source_path=str(self._pose_path), pose=None)

        try:
            pose = ButterClawRuntimePoseSnapshot(
                ts=float(payload["ts"]),
                x=float(payload["x"]),
                y=float(payload["y"]),
                yaw_deg=float(payload["yaw_deg"]),
            )
        except (KeyError, TypeError, ValueError):
            pose = None

        return ButterClawRuntimePoseResponse(source_path=str(self._pose_path), pose=pose)


butterclaw_runtime_pose_service = ButterClawRuntimePoseService(
    settings.butterclaw_slam_pose_path
)
