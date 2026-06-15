from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from backend.services.so101_genesis_urdf import (
    So101GenesisUrdfRepairResult,
    materialize_so101_genesis_urdf_report,
)

GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY = "simulator_compatibility_patches"
GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS = (
    "so101_gripper_proxy_collisions"
)


@dataclass(frozen=True)
class GenesisRobotUrdfRepairResult:
    path: Path
    applied: bool
    repair_id: str | None = None


GenesisRobotRepair = Callable[[Path], GenesisRobotUrdfRepairResult]


def _adapt_so101_repair(urdf_path: Path) -> GenesisRobotUrdfRepairResult:
    result: So101GenesisUrdfRepairResult = materialize_so101_genesis_urdf_report(urdf_path)
    return GenesisRobotUrdfRepairResult(
        path=result.path,
        applied=result.applied,
        repair_id=result.repair_id,
    )


GENESIS_ROBOT_REPAIRS_BY_ID: Mapping[str, GenesisRobotRepair] = {
    GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS: _adapt_so101_repair,
}


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
        repair = GENESIS_ROBOT_REPAIRS_BY_ID.get(patch_id)
        if repair is None:
            raise ValueError(f"Unknown Genesis robot compatibility patch: {patch_id}")
        result = repair(source_path)
        if result.applied:
            return result
        raise ValueError(
            f"Genesis robot compatibility patch {patch_id!r} did not apply to {source_path}."
        )
    return GenesisRobotUrdfRepairResult(path=source_path, applied=False)
