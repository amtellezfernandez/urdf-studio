from __future__ import annotations

import pytest

from backend.models.simulator_runtime import SimulatorMeshAssetUpload
from backend.services.simulator_adapters.workspace_asset_staging import (
    package_root_hint_paths,
    resolve_workspace_asset_path,
    unique_workspace_asset_paths,
    write_package_root_hints,
    write_uploaded_workspace_assets,
    write_workspace_asset_file,
)


def test_write_workspace_asset_file_rejects_absolute_asset_path(tmp_path) -> None:
    with pytest.raises(ValueError, match="asset path must be relative"):
        write_workspace_asset_file(
            tmp_path,
            "/tmp/crate.stl",
            b"solid crate\nendsolid crate\n",
            error=ValueError,
        )


def test_resolve_workspace_asset_path_normalizes_inside_root(tmp_path) -> None:
    assert resolve_workspace_asset_path(
        tmp_path,
        "./assets//meshes/./crate.stl",
    ) == (tmp_path / "assets" / "meshes" / "crate.stl").resolve()


def test_write_workspace_asset_file_rejects_conflicting_content(tmp_path) -> None:
    write_workspace_asset_file(
        tmp_path,
        "meshes/crate.stl",
        b"solid crate\nendsolid crate\n",
        error=ValueError,
    )

    with pytest.raises(ValueError, match="Conflicting uploaded asset path"):
        write_workspace_asset_file(
            tmp_path,
            "meshes/crate.stl",
            b"solid other\nendsolid other\n",
            error=ValueError,
        )


def test_write_workspace_asset_file_rejects_directory_conflict(tmp_path) -> None:
    (tmp_path / "meshes" / "crate.stl").mkdir(parents=True)

    with pytest.raises(ValueError, match="Conflicting uploaded asset path"):
        write_workspace_asset_file(
            tmp_path,
            "meshes/crate.stl",
            b"solid crate\nendsolid crate\n",
            error=ValueError,
        )


def test_write_workspace_asset_file_rejects_parent_file_conflict(tmp_path) -> None:
    (tmp_path / "meshes").write_text("not a directory\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Conflicting uploaded asset path"):
        write_workspace_asset_file(
            tmp_path,
            "meshes/crate.stl",
            b"solid crate\nendsolid crate\n",
            error=ValueError,
        )


def test_unique_workspace_asset_paths_preserves_normalized_order() -> None:
    assert unique_workspace_asset_paths(
        (
            "./meshes//crate.stl",
            "meshes/crate.stl",
            "textures/diffuse.png",
            "textures/./diffuse.png",
        )
    ) == ("meshes/crate.stl", "textures/diffuse.png")


def test_write_uploaded_workspace_assets_deduplicates_aliases(tmp_path) -> None:
    write_uploaded_workspace_assets(
        tmp_path,
        [
            SimulatorMeshAssetUpload(
                path="./meshes//crate.stl",
                aliases=["meshes/crate.stl", "meshes/./crate.stl"],
                content_base64="AA==",
            )
        ],
        error=ValueError,
    )

    assert (tmp_path / "meshes" / "crate.stl").read_bytes() == b"\0"


def test_package_root_hints_share_resolver(tmp_path) -> None:
    package_roots = {"demo_description": ["robot_description", "./robot_description"]}

    write_package_root_hints(tmp_path, package_roots)

    package_xml = tmp_path / "robot_description" / "package.xml"
    assert package_xml.is_file()
    assert "<name>demo_description</name>" in package_xml.read_text(encoding="utf-8")
    assert package_root_hint_paths(tmp_path, package_roots) == [
        (tmp_path / "robot_description").resolve()
    ]
