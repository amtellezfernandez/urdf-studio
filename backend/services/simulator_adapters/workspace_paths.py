from __future__ import annotations

from pathlib import Path


def workspace_asset_roots(world_package_path: Path, robot_urdf_path: Path) -> tuple[Path, ...]:
    workspace_dir = world_package_path.parent
    return (
        workspace_dir / "source",
        workspace_dir,
        robot_urdf_path.parent,
    )
