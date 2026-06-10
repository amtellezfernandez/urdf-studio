from __future__ import annotations

from datetime import datetime, timezone

from backend.models.simulator_runtime import SimulatorWorldOpenRequest
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldSnapshot,
)


def make_world_package(
    urdf_xml: str,
    *,
    joint_positions: dict[str, float] | None = None,
    objects: list[dict] | None = None,
) -> WorldScenePackageManifest:
    return WorldScenePackageManifest(
        package_id="demo_world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        interface=WorldInterfaceSpec(
            observation_modalities=["state"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        world_snapshot=WorldSnapshot(
            urdf_xml=urdf_xml,
            joint_positions=joint_positions or {},
            objects=objects or [],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )


def make_world_open_request(urdf_xml: str) -> SimulatorWorldOpenRequest:
    return SimulatorWorldOpenRequest(world_package=make_world_package(urdf_xml))
