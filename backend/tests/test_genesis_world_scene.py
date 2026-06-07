from __future__ import annotations

from pathlib import Path

from backend.services.genesis_world_scene import (
    DEFAULT_WORLD_LAYOUT_PATH,
    WORLD_LAYOUT_ELEMENT_SCALE,
    build_genesis_element_specs,
    load_world_layout_environment_elements,
    resolve_world_layout_asset_path,
    resolve_world_layout_element_metric_scale,
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


def test_genesis_element_specs_use_studio_effective_glb_scale() -> None:
    _layout_name, specs = build_genesis_element_specs(DEFAULT_WORLD_LAYOUT_PATH)
    grabbable = next(spec for spec in specs if spec.element.id == "grabbable-container-f")

    assert grabbable.metric_scale == WORLD_LAYOUT_ELEMENT_SCALE
    assert grabbable.element.scale_xyz == (0.09, 0.09, 0.09)
    assert grabbable.effective_scale_xyz == (0.045, 0.045, 0.045)
    assert grabbable.box_size_xyz == tuple(
        max(1e-4, grabbable.mesh_bounds.size_xyz[index] * grabbable.effective_scale_xyz[index])
        for index in range(3)
    )


def test_resolve_world_layout_element_metric_scale_matches_studio_policy() -> None:
    assert resolve_world_layout_element_metric_scale(None, 0.65) == 0.5
    assert resolve_world_layout_element_metric_scale(2.6, 0.65) == 4.0
    assert resolve_world_layout_element_metric_scale(0.001, 100.0) == 0.02
    assert resolve_world_layout_element_metric_scale(1000.0, 1.0) == 200.0


def test_resolve_world_layout_asset_path_maps_browser_public_path() -> None:
    resolved = resolve_world_layout_asset_path(
        "/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb",
        layout_path=DEFAULT_WORLD_LAYOUT_PATH,
    )

    assert resolved == Path(
        "web/public/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb"
    ).resolve()
