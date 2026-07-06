from __future__ import annotations

from backend.services.world_scene_contract import (
    WORLD_OBJECT_ASSET_SCALE_KEYS,
    frame_map_from_world_frame_convention,
)


def test_frame_map_from_world_frame_convention_recognizes_shared_y_up_aliases() -> None:
    assert frame_map_from_world_frame_convention("studio-y-up") == "studio-y-up-to-z-up"
    assert frame_map_from_world_frame_convention("three_y_up") == "studio-y-up-to-z-up"


def test_frame_map_from_world_frame_convention_recognizes_shared_z_up_aliases() -> None:
    assert frame_map_from_world_frame_convention("ros-rep-103") == "identity"
    assert frame_map_from_world_frame_convention("mujoco-z-up") == "identity"
    assert frame_map_from_world_frame_convention("simulator_z_up") == "identity"


def test_frame_map_from_world_frame_convention_returns_none_for_unknown_labels() -> None:
    assert frame_map_from_world_frame_convention("left-handed") is None


def test_world_object_asset_scale_keys_keep_layout_alias_compatibility() -> None:
    assert WORLD_OBJECT_ASSET_SCALE_KEYS == ("asset_scale_xyz", "mesh_scale_xyz", "scale_xyz")
