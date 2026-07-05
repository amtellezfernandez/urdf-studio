from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import cast

from backend.core.paths import BASE_DIR
from backend.services.simulator_adapters.workspace_process import build_simulator_workspace_env
from backend.services.world_layout_static_transfer import (
    POSITION_TOLERANCE_M,
    QUATERNION_TOLERANCE,
    SIZE_TOLERANCE_M,
    check_static_world_layout_file,
)
from backend.services.world_layout_transfer_types import (
    StaticTransferValidationBackend,
    WorldLayoutFrameMap,
)


DEFAULT_LAYOUT_PATH = Path("web/public/world-layouts/static-transfer-smoke.world-layout.json")
TRANSFER_CHECK_CACHE_ROOT = BASE_DIR / ".cache" / "simulator-workspaces" / "runtime-cache"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check static primitive layout parity in MuJoCo and Genesis."
    )
    parser.add_argument(
        "layout",
        nargs="?",
        default=str(DEFAULT_LAYOUT_PATH),
        help="Path to a .world-layout.json or .world-package.json file.",
    )
    parser.add_argument(
        "--backend",
        choices=["all", "mujoco", "genesis"],
        default="all",
        help="Backend to check. Default checks both MuJoCo and Genesis.",
    )
    parser.add_argument(
        "--frame-map",
        choices=["auto", "studio-y-up-to-z-up", "identity"],
        default="identity",
        help="Coordinate conversion from URDF Studio layout coordinates to simulator coordinates.",
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include objects marked is_hidden=true.",
    )
    parser.add_argument(
        "--write-mjcf",
        default="",
        help="Optional output path for generated MuJoCo MJCF XML.",
    )
    parser.add_argument(
        "--position-tolerance-m",
        type=float,
        default=POSITION_TOLERANCE_M,
        help="Maximum allowed position error in meters. Default is 1e-6 m (0.001 mm).",
    )
    parser.add_argument(
        "--size-tolerance-m",
        type=float,
        default=SIZE_TOLERANCE_M,
        help="Maximum allowed primitive size error in meters. Default is 1e-6 m (0.001 mm).",
    )
    parser.add_argument(
        "--quat-tolerance",
        type=float,
        default=QUATERNION_TOLERANCE,
        help="Maximum allowed quaternion L2 error.",
    )
    return parser.parse_args()


def _selected_backends(value: str) -> tuple[StaticTransferValidationBackend, ...]:
    if value == "all":
        return ("mujoco", "genesis")
    if value in ("mujoco", "genesis"):
        return (cast(StaticTransferValidationBackend, value),)
    raise ValueError(f"Unsupported static transfer backend: {value}")


def _selected_frame_map(value: str) -> WorldLayoutFrameMap:
    if value in ("auto", "studio-y-up-to-z-up", "identity"):
        return cast(WorldLayoutFrameMap, value)
    raise ValueError(f"Unsupported static transfer frame map: {value}")


def main() -> int:
    args = _parse_args()
    os.environ.update(build_simulator_workspace_env(TRANSFER_CHECK_CACHE_ROOT))
    report = check_static_world_layout_file(
        Path(args.layout),
        backends=_selected_backends(args.backend),
        frame_map=_selected_frame_map(args.frame_map),
        include_hidden=args.include_hidden,
        write_mjcf_path=Path(args.write_mjcf) if args.write_mjcf else None,
        position_tolerance_m=args.position_tolerance_m,
        size_tolerance_m=args.size_tolerance_m,
        quaternion_tolerance=args.quat_tolerance,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
