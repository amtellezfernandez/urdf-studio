from __future__ import annotations

import pytest

from backend.services.simulator_adapters.scene_bounds import (
    combine_aabbs,
    scene_bounds_from_aabbs,
)


def test_scene_bounds_from_aabbs_uses_default_when_empty() -> None:
    bounds = scene_bounds_from_aabbs(
        (),
        default_center_xyz=(1.0, 2.0, 3.0),
        default_radius_m=0.5,
        min_radius_m=0.1,
    )

    assert bounds.center_xyz == (1.0, 2.0, 3.0)
    assert bounds.radius_m == 0.5
    assert bounds.min_xyz == (0.5, 1.5, 2.5)
    assert bounds.max_xyz == (1.5, 2.5, 3.5)
    assert bounds.item_count == 0


def test_scene_bounds_from_aabbs_combines_extents_and_min_radius() -> None:
    bounds = scene_bounds_from_aabbs(
        (
            ((-0.2, -0.1, 0.0), (0.2, 0.1, 0.4)),
            ((1.0, -0.2, 0.0), (1.2, 0.2, 0.2)),
        ),
        default_center_xyz=(0.0, 0.0, 0.0),
        default_radius_m=0.5,
        min_radius_m=1.0,
    )

    assert bounds.center_xyz == (0.5, 0.0, 0.2)
    assert bounds.min_xyz == (-0.2, -0.2, 0.0)
    assert bounds.max_xyz == (1.2, 0.2, 0.4)
    assert bounds.radius_m == 1.0
    assert bounds.item_count == 2


def test_scene_bounds_rejects_invalid_default_center() -> None:
    with pytest.raises(ValueError, match="3D vector"):
        scene_bounds_from_aabbs(
            (),
            default_center_xyz=(0.0, 0.0),
            default_radius_m=0.5,
            min_radius_m=0.1,
        )


def test_combine_aabbs_returns_none_for_empty_input() -> None:
    assert combine_aabbs(()) is None


def test_combine_aabbs_returns_enclosing_aabb() -> None:
    assert combine_aabbs(
        (
            ((0.0, 1.0, -1.0), (1.0, 2.0, 0.0)),
            ((-2.0, 0.5, -0.5), (0.5, 3.0, 4.0)),
        )
    ) == ((-2.0, 0.5, -1.0), (1.0, 3.0, 4.0))
