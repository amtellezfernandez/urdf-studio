from __future__ import annotations

import json
from pathlib import Path

from backend.services.butterclaw_runtime_pose import ButterClawRuntimePoseService


def test_get_pose_parses_slam_pose_json(tmp_path: Path) -> None:
    pose_path = tmp_path / "slam_pose.json"
    pose_path.write_text(
        json.dumps(
            {
                "ts": 123.5,
                "x": 1.25,
                "y": -0.75,
                "yaw_deg": 90.0,
            }
        ),
        encoding="utf-8",
    )

    service = ButterClawRuntimePoseService(str(pose_path))
    response = service.get_pose()

    assert response.source_path == str(pose_path)
    assert response.pose is not None
    assert response.pose.ts == 123.5
    assert response.pose.x == 1.25
    assert response.pose.y == -0.75
    assert response.pose.yaw_deg == 90.0


def test_get_pose_returns_none_when_file_missing(tmp_path: Path) -> None:
    pose_path = tmp_path / "missing.json"

    service = ButterClawRuntimePoseService(str(pose_path))
    response = service.get_pose()

    assert response.source_path == str(pose_path)
    assert response.pose is None
