from __future__ import annotations

from datetime import datetime, timezone

from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.world_scene_package_digest import computed_world_snapshot_digest


TEST_WORLD_SNAPSHOT_DIGEST = "d8dbd551c2b41b1311022aa1e522c58ccc9062e6b9f729786f4427e84d7c8102"


def test_computed_world_snapshot_digest_matches_frontend_builder_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["rgb", "proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={"joint_1": 0.5},
            cameras=[
                {
                    "id": "cam-1",
                    "name": "cam-1",
                    "parent_joint": "base_joint",
                    "pose": {
                        "xyz": [0, 0, 0],
                        "rpy": [0, 0, 0],
                    },
                    "intrinsics": {
                        "width": 640,
                        "height": 480,
                        "fov_deg": 60,
                    },
                }
            ],
            objects=[],
            scenario_time_ms=200,
            scenario_duration_ms=12000,
        ),
    )

    assert computed_world_snapshot_digest(manifest) == TEST_WORLD_SNAPSHOT_DIGEST
