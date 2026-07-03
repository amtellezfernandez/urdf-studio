from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from backend.services.simulator_adapters.robot_repair_profiles import (
    GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS,
    SO101_GENESIS_GRIPPER_PROXY_COLLISION_PROFILE,
)
from backend.services.simulator_adapters.urdf_collision_proxy_repair import (
    UrdfCollisionProxyRepairProfile,
    materialize_urdf_collision_proxy_repair_report,
)

GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY = "simulator_compatibility_patches"


@dataclass(frozen=True)
class GenesisRobotUrdfRepairResult:
    path: Path
    applied: bool
    repair_id: str | None = None


GenesisRobotRepair = Callable[[Path], GenesisRobotUrdfRepairResult]


def _collision_proxy_repair(
    profile: UrdfCollisionProxyRepairProfile,
) -> GenesisRobotRepair:
    def repair(urdf_path: Path) -> GenesisRobotUrdfRepairResult:
        result = materialize_urdf_collision_proxy_repair_report(
            urdf_path,
            profile=profile,
        )
        return GenesisRobotUrdfRepairResult(
            path=result.path,
            applied=result.applied,
            repair_id=result.repair_id,
        )

    return repair


def _repair_by_profile_id(
    profiles: Iterable[UrdfCollisionProxyRepairProfile],
) -> dict[str, GenesisRobotRepair]:
    return {profile.repair_id: _collision_proxy_repair(profile) for profile in profiles}


GENESIS_ROBOT_REPAIRS_BY_ID: Mapping[str, GenesisRobotRepair] = _repair_by_profile_id(
    (
        SO101_GENESIS_GRIPPER_PROXY_COLLISION_PROFILE,
    )
)


def _compatibility_patch_profile_id(patch_id: str) -> str:
    if patch_id == GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS:
        return SO101_GENESIS_GRIPPER_PROXY_COLLISION_PROFILE.repair_id
    return patch_id


def _patch_id_list(value: Any, path: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list of compatibility patch ids.")
    patch_ids: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{path}[{index}] must be a non-empty string.")
        patch_ids.append(item.strip())
    return tuple(patch_ids)


def genesis_robot_compatibility_patch_ids_from_world_package(world_package: Any) -> tuple[str, ...]:
    provenance = getattr(world_package, "provenance", None)
    if not isinstance(provenance, Mapping):
        return ()
    patch_config = provenance.get(GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY)
    if patch_config is None:
        return ()
    if not isinstance(patch_config, Mapping):
        raise ValueError(
            f"provenance.{GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY} must be an object."
        )
    return _patch_id_list(
        patch_config.get("genesis"),
        f"provenance.{GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY}.genesis",
    )


def materialize_genesis_robot_urdf_report(
    urdf_path: Path,
    *,
    requested_patch_ids: Iterable[str] = (),
) -> GenesisRobotUrdfRepairResult:
    source_path = urdf_path.resolve()
    for patch_id in requested_patch_ids:
        profile_id = _compatibility_patch_profile_id(patch_id)
        repair = GENESIS_ROBOT_REPAIRS_BY_ID.get(profile_id)
        if repair is None:
            raise ValueError(f"Unknown Genesis robot compatibility patch: {patch_id}")
        result = repair(source_path)
        if result.applied:
            return result
        raise ValueError(
            f"Genesis robot compatibility patch {patch_id!r} did not apply to {source_path}."
        )
    return GenesisRobotUrdfRepairResult(path=source_path, applied=False)
