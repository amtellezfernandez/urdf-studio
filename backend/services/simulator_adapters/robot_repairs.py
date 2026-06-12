from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.services.so101_genesis_urdf import (
    So101GenesisUrdfRepairResult,
    materialize_so101_genesis_urdf_report,
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


GENESIS_ROBOT_REPAIRS: tuple[GenesisRobotRepair, ...] = (
    _adapt_so101_repair,
)


def materialize_genesis_robot_urdf_report(urdf_path: Path) -> GenesisRobotUrdfRepairResult:
    source_path = urdf_path.resolve()
    for repair in GENESIS_ROBOT_REPAIRS:
        result = repair(source_path)
        if result.applied:
            return result
    return GenesisRobotUrdfRepairResult(path=source_path, applied=False)
