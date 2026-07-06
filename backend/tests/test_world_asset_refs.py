from __future__ import annotations

import pytest

from backend.services.world_asset_refs import (
    has_world_object_content_asset_ref,
    normalize_portable_world_asset_ref,
    read_world_object_content_asset_ref,
    read_world_object_asset_ref,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("assets/crate.obj", "assets/crate.obj"),
        ("./assets/crate.obj", "assets/crate.obj"),
        ("assets\\crate.obj", "assets/crate.obj"),
    ],
)
def test_normalize_portable_world_asset_ref_normalizes_relative_forms(
    value: str,
    expected: str,
) -> None:
    assert normalize_portable_world_asset_ref(value) == expected


def test_read_world_object_asset_ref_preserves_selected_top_level_value() -> None:
    asset_ref = read_world_object_asset_ref(
        {
            "asset_ref": "  assets/crate.obj  ",
        }
    )

    assert asset_ref is not None
    assert asset_ref.value == "  assets/crate.obj  "
    assert asset_ref.field_path == "asset_ref"


def test_read_world_object_asset_ref_falls_back_to_nested_mesh_value() -> None:
    asset_ref = read_world_object_asset_ref(
        {
            "asset_ref": "   ",
            "geometry": {
                "mesh": {
                    "filename": "  assets/crate.obj  ",
                }
            },
        }
    )

    assert asset_ref is not None
    assert asset_ref.value == "  assets/crate.obj  "
    assert asset_ref.field_path == "geometry.mesh.filename"


def test_read_world_object_content_asset_ref_ignores_physics_collision_asset_ref() -> None:
    asset_ref = read_world_object_content_asset_ref(
        {
            "physics": {
                "collision_geometry": {
                    "asset_ref": "assets/collider.obj",
                }
            },
            "mesh": {
                "path": "assets/render.obj",
            },
        }
    )

    assert asset_ref is not None
    assert asset_ref.value == "assets/render.obj"
    assert asset_ref.field_path == "mesh.path"


def test_has_world_object_content_asset_ref_requires_portable_ref() -> None:
    assert has_world_object_content_asset_ref({"asset_ref": "assets/crate.obj"}) is True
    assert has_world_object_content_asset_ref({"asset_ref": "/tmp/crate.obj"}) is False
    assert (
        has_world_object_content_asset_ref(
            {
                "physics": {
                    "collision_geometry": {
                        "asset_ref": "assets/collider.obj",
                    }
                }
            }
        )
        is False
    )
