from __future__ import annotations

from pathlib import Path

from backend.services.genesis_world_scene import (
    DEFAULT_WORLD_LAYOUT_PATH,
    build_genesis_element_specs,
    load_world_layout_environment_elements,
    resolve_world_layout_asset_path,
)


def test_hk_cargo_layout_environment_elements_resolve_interactive_assets() -> None:
    layout_name, elements = load_world_layout_environment_elements(DEFAULT_WORLD_LAYOUT_PATH)

    assert layout_name == "hk-cargo-port"
    assert {element.id for element in elements} >= {
        "orange-rtg-crane",
        "grabbable-container-f",
    }
    grabbable = next(element for element in elements if element.id == "grabbable-container-f")
    assert grabbable.physics.body_type == "dynamic"
    assert grabbable.material_color == "#ef4444"


def test_build_genesis_element_specs_maps_public_uris_and_mesh_bounds() -> None:
    _layout_name, specs = build_genesis_element_specs(DEFAULT_WORLD_LAYOUT_PATH)
    grabbable = next(spec for spec in specs if spec.element.id == "grabbable-container-f")

    assert grabbable.asset_path.exists()
    assert grabbable.asset_path.as_posix().endswith(
        "web/public/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb"
    )
    assert grabbable.is_dynamic is True
    assert all(component > 0 for component in grabbable.box_size_xyz)
    assert grabbable.mesh_position_xyz != grabbable.element.position_xyz


def test_resolve_world_layout_asset_path_maps_browser_public_path() -> None:
    resolved = resolve_world_layout_asset_path(
        "/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb",
        layout_path=DEFAULT_WORLD_LAYOUT_PATH,
    )

    assert resolved == Path(
        "web/public/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb"
    ).resolve()
