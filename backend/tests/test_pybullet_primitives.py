from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.simulator_adapters.pybullet_primitives import (
    add_pybullet_primitive,
    pybullet_primitive_shape,
)
from backend.services.world_layout_static_transfer import SimPrimitive


class _FakePybullet:
    GEOM_BOX = 1
    GEOM_SPHERE = 2
    GEOM_CYLINDER = 3
    GEOM_MESH = 4


def test_pybullet_cylinder_uses_distinct_collision_and_visual_height_keywords() -> None:
    primitive = SimPrimitive(
        source_id="column",
        source_name="Column",
        sim_name="wl_column",
        source_type="cylinder",
        sim_type="cylinder",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.2, 0.8),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    shape_type, collision_kwargs, visual_kwargs = pybullet_primitive_shape(_FakePybullet, primitive)

    assert shape_type == _FakePybullet.GEOM_CYLINDER
    assert collision_kwargs == {"radius": 0.1, "height": 0.8}
    assert visual_kwargs == {"radius": 0.1, "length": 0.8}


def test_pybullet_primitive_shape_uses_mesh_asset_when_available(tmp_path: Path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/crate.obj",
        asset_scale_xyz=(1.0, 1.2, 1.4),
    )

    shape_type, collision_kwargs, visual_kwargs = pybullet_primitive_shape(
        _FakePybullet,
        primitive,
        asset_roots=(tmp_path,),
    )

    assert shape_type == _FakePybullet.GEOM_MESH
    assert collision_kwargs == {
        "fileName": str(mesh_path),
        "meshScale": (1.0, 1.2, 1.4),
    }
    assert visual_kwargs == collision_kwargs


def test_pybullet_primitive_shape_rejects_unresolved_mesh_asset(tmp_path: Path) -> None:
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/missing.obj",
    )

    with pytest.raises(ValueError, match="PyBullet mesh object 'crate' asset_ref does not resolve"):
        pybullet_primitive_shape(_FakePybullet, primitive, asset_roots=(tmp_path,))


def test_pybullet_primitive_uses_canonical_dynamic_material_fields() -> None:
    class _FakeRuntime(_FakePybullet):
        collision_kwargs = None
        visual_kwargs = None
        multibody_kwargs = None
        dynamics_kwargs = None

        @classmethod
        def createCollisionShape(cls, shape_type, **kwargs):
            cls.collision_kwargs = {"shape_type": shape_type, **kwargs}
            return 10

        @classmethod
        def createVisualShape(cls, shape_type, **kwargs):
            cls.visual_kwargs = {"shape_type": shape_type, **kwargs}
            return 11

        @classmethod
        def createMultiBody(cls, **kwargs):
            cls.multibody_kwargs = kwargs
            return 12

        @classmethod
        def changeDynamics(cls, body_id, link_id, **kwargs):
            cls.dynamics_kwargs = {"body_id": body_id, "link_id": link_id, **kwargs}

    primitive = SimPrimitive(
        source_id="container",
        source_name="Container",
        sim_name="wl_container",
        source_type="cube",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        fixed=False,
        mass_kg=2.5,
        friction=0.7,
        restitution=0.2,
    )

    body_id = add_pybullet_primitive(_FakeRuntime, primitive)

    assert body_id == 12
    assert _FakeRuntime.multibody_kwargs["baseMass"] == 2.5
    assert _FakeRuntime.dynamics_kwargs == {
        "body_id": 12,
        "link_id": -1,
        "lateralFriction": 0.7,
        "restitution": 0.2,
    }
