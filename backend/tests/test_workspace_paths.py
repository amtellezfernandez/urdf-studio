from __future__ import annotations

import json

from backend.services.simulator_adapters.workspace_paths import (
    WORKSPACE_ASSET_ROOTS_FILENAME,
    compute_workspace_asset_roots,
    workspace_asset_roots,
)


def test_workspace_asset_roots_filters_invalid_manifest_entries(tmp_path) -> None:
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    source_dir = workspace_dir / "source"
    valid_external_root = tmp_path / "external-assets"
    file_root = tmp_path / "not-a-directory"
    robot_dir.mkdir(parents=True)
    source_dir.mkdir()
    valid_external_root.mkdir()
    file_root.write_text("not a directory\n", encoding="utf-8")
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    manifest_entries = [
        str(valid_external_root),
        "relative/path",
        "",
        str(file_root),
        str(tmp_path / "missing-assets"),
        str(valid_external_root),
        {"not": "a path"},
    ]
    (workspace_dir / WORKSPACE_ASSET_ROOTS_FILENAME).write_text(
        f"{json.dumps(manifest_entries)}\n",
        encoding="utf-8",
    )

    roots = workspace_asset_roots(world_package_path, robot_urdf_path)

    assert roots == (valid_external_root.resolve(),)


def test_workspace_asset_roots_falls_back_when_manifest_has_no_valid_roots(tmp_path) -> None:
    workspace_dir = tmp_path / "workspace"
    robot_urdf_path = workspace_dir / "robot" / "robot.urdf"
    world_package_path = workspace_dir / "world-package.json"
    file_root = tmp_path / "not-a-directory"
    workspace_dir.mkdir()
    file_root.write_text("not a directory\n", encoding="utf-8")
    manifest_entries = [
        "relative/path",
        "",
        str(file_root),
        str(tmp_path / "missing-assets"),
    ]
    (workspace_dir / WORKSPACE_ASSET_ROOTS_FILENAME).write_text(
        f"{json.dumps(manifest_entries)}\n",
        encoding="utf-8",
    )

    roots = workspace_asset_roots(world_package_path, robot_urdf_path)

    assert roots == compute_workspace_asset_roots(
        workspace_dir=workspace_dir,
        robot_urdf_path=robot_urdf_path,
    )


def test_workspace_asset_roots_falls_back_when_manifest_payload_is_not_a_list(tmp_path) -> None:
    workspace_dir = tmp_path / "workspace"
    robot_urdf_path = workspace_dir / "robot" / "robot.urdf"
    world_package_path = workspace_dir / "world-package.json"
    workspace_dir.mkdir()
    (workspace_dir / WORKSPACE_ASSET_ROOTS_FILENAME).write_text(
        f"{json.dumps({'root': str(tmp_path / 'external-assets')})}\n",
        encoding="utf-8",
    )

    roots = workspace_asset_roots(world_package_path, robot_urdf_path)

    assert roots == compute_workspace_asset_roots(
        workspace_dir=workspace_dir,
        robot_urdf_path=robot_urdf_path,
    )
