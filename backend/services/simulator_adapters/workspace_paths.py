from __future__ import annotations

import json
from pathlib import Path


WORKSPACE_ASSET_ROOTS_FILENAME = "asset-roots.json"


def _dedupe_paths(paths: tuple[Path, ...]) -> tuple[Path, ...]:
    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(resolved)
    return tuple(deduped)


def compute_workspace_asset_roots(
    *,
    workspace_dir: Path,
    robot_urdf_path: Path,
    uploaded_asset_sources: tuple[Path, ...] = (),
) -> tuple[Path, ...]:
    return _dedupe_paths(
        (
            workspace_dir / "source",
            workspace_dir,
            robot_urdf_path.parent,
            *uploaded_asset_sources,
        )
    )


def write_workspace_asset_roots(workspace_dir: Path, roots: tuple[Path, ...]) -> None:
    workspace_dir.mkdir(parents=True, exist_ok=True)
    (workspace_dir / WORKSPACE_ASSET_ROOTS_FILENAME).write_text(
        f"{json.dumps([str(root) for root in roots], indent=2)}\n",
        encoding="utf-8",
    )


def workspace_asset_roots(world_package_path: Path, robot_urdf_path: Path) -> tuple[Path, ...]:
    workspace_dir = world_package_path.parent
    manifest_path = workspace_dir / WORKSPACE_ASSET_ROOTS_FILENAME
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return compute_workspace_asset_roots(
            workspace_dir=workspace_dir,
            robot_urdf_path=robot_urdf_path,
        )
    if not isinstance(payload, list):
        return compute_workspace_asset_roots(
            workspace_dir=workspace_dir,
            robot_urdf_path=robot_urdf_path,
        )
    roots = tuple(Path(item) for item in payload if isinstance(item, str) and item.strip())
    if not roots:
        return compute_workspace_asset_roots(
            workspace_dir=workspace_dir,
            robot_urdf_path=robot_urdf_path,
        )
    return _dedupe_paths(roots)
