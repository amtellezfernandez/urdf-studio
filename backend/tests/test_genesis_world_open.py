from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.scripts.genesis_world_open import (
    DEFAULT_FLOOR_FRICTION,
    GENESIS_FLOOR_CLEARANCE_EPSILON_M,
    GENESIS_FLOOR_SIZE_XY,
    GENESIS_FLOOR_THICKNESS_M,
    GENESIS_FLOOR_TOP_Z,
    GENESIS_RIGID_FRICTION_MAX,
    GENESIS_RIGID_FRICTION_MIN,
    _add_box_entity,
    _add_floor_entity,
    _add_mesh_entity,
    _enforce_dynamic_floor_contact,
    _enforce_robot_floor_contact,
    _apply_rigid_entity_physics_overrides,
    _apply_live_joint_values,
    _joint_dof_indices_by_name,
    _oriented_box_min_z,
    _rigid_material_for_physics,
    _robot_collision_min_z,
    _resolve_studio_pose_from_qpos,
    _robot_joint_values_payload,
    _visual_mesh_qpos_from_collider_qpos,
)


class _FakeMorphs:
    def __init__(self) -> None:
        self.mesh_kwargs: dict | None = None
        self.box_kwargs: dict | None = None

    def Mesh(self, **kwargs):  # noqa: N802 - mirrors Genesis API
        self.mesh_kwargs = kwargs
        return {"kind": "mesh", "kwargs": kwargs}

    def Box(self, **kwargs):  # noqa: N802 - mirrors Genesis API
        self.box_kwargs = kwargs
        return {"kind": "box", "kwargs": kwargs}


class _FakeMaterials:
    def __init__(self) -> None:
        self.rigid_kwargs: list[dict] = []

    def Rigid(self, **kwargs):  # noqa: N802 - mirrors Genesis API
        self.rigid_kwargs.append(kwargs)
        return {"kind": "rigid", "kwargs": kwargs}


class _FakeScene:
    def __init__(self) -> None:
        self.added: list[tuple[object, dict]] = []

    def add_entity(self, morph, **kwargs):
        self.added.append((morph, kwargs))
        return morph


def test_add_mesh_entity_disables_genesis_auto_alignment() -> None:
    morphs = _FakeMorphs()
    gs = SimpleNamespace(
        morphs=morphs,
        surfaces=SimpleNamespace(Default=lambda **_kwargs: object()),
        materials=_FakeMaterials(),
    )
    scene = _FakeScene()
    spec = SimpleNamespace(
        asset_path=Path("container.glb"),
        mesh_position_xyz=(0.3, 0.0, 0.0),
        effective_scale_xyz=(0.045, 0.045, 0.045),
        box_size_xyz=(0.08, 0.04, 0.03),
        element=SimpleNamespace(
            rotation_rpy_rad=(1.5707963267948966, 0.0, 0.0),
            material_color="#ef4444",
            physics=None,
        ),
    )

    _add_mesh_entity(
        gs,
        scene,
        spec=spec,
        fixed=False,
        collision=True,
        name="grabbable-container",
        decimate=True,
        convexify=True,
    )

    assert morphs.mesh_kwargs is not None
    assert morphs.mesh_kwargs["align"] is False
    assert "file_meshes_are_zup" not in morphs.mesh_kwargs
    assert scene.added[0][1]["name"] == "grabbable-container"


def test_add_mesh_entity_can_preserve_studio_glb_orientation() -> None:
    morphs = _FakeMorphs()
    gs = SimpleNamespace(
        morphs=morphs,
        surfaces=SimpleNamespace(Default=lambda **_kwargs: object()),
        materials=_FakeMaterials(),
    )
    scene = _FakeScene()
    spec = SimpleNamespace(
        asset_path=Path("container.glb"),
        mesh_position_xyz=(0.3, 0.0, 0.0),
        effective_scale_xyz=(0.045, 0.045, 0.045),
        box_size_xyz=(0.08, 0.04, 0.03),
        element=SimpleNamespace(
            rotation_rpy_rad=(1.5707963267948966, 0.0, 0.0),
            material_color="#ef4444",
            physics=None,
        ),
    )

    _add_mesh_entity(
        gs,
        scene,
        spec=spec,
        fixed=False,
        collision=True,
        name="grabbable-container",
        decimate=True,
        convexify=True,
        preserve_studio_glb_orientation=True,
    )

    assert morphs.mesh_kwargs is not None
    assert morphs.mesh_kwargs["align"] is False
    assert morphs.mesh_kwargs["file_meshes_are_zup"] is True


def test_rigid_material_uses_layout_friction_restitution_and_density() -> None:
    materials = _FakeMaterials()
    gs = SimpleNamespace(materials=materials)

    material = _rigid_material_for_physics(
        gs,
        SimpleNamespace(mass_kg=0.12, friction=3.0, restitution=0.0),
        box_size_xyz=(0.1, 0.2, 0.3),
    )

    assert material == {"kind": "rigid", "kwargs": materials.rigid_kwargs[0]}
    assert materials.rigid_kwargs == [
        {
            "friction": 3.0,
            "coup_restitution": 0.0,
            "rho": pytest.approx(20.0),
        }
    ]


def test_rigid_material_clamps_genesis_friction_bounds() -> None:
    materials = _FakeMaterials()
    gs = SimpleNamespace(materials=materials)

    _rigid_material_for_physics(
        gs,
        SimpleNamespace(mass_kg=None, friction=0.0, restitution=None),
    )
    _rigid_material_for_physics(
        gs,
        SimpleNamespace(mass_kg=None, friction=10.0, restitution=None),
    )
    _rigid_material_for_physics(
        gs,
        None,
        friction_fallback=DEFAULT_FLOOR_FRICTION,
    )

    assert materials.rigid_kwargs == [
        {"friction": GENESIS_RIGID_FRICTION_MIN},
        {"friction": GENESIS_RIGID_FRICTION_MAX},
        {"friction": DEFAULT_FLOOR_FRICTION},
    ]


def test_add_box_entity_passes_physics_material_to_genesis() -> None:
    morphs = _FakeMorphs()
    materials = _FakeMaterials()
    gs = SimpleNamespace(
        morphs=morphs,
        surfaces=SimpleNamespace(Default=lambda **_kwargs: object()),
        materials=materials,
    )
    scene = _FakeScene()
    spec = SimpleNamespace(
        box_size_xyz=(0.1, 0.2, 0.3),
        box_center_xyz=(0.3, 0.0, 0.04),
        element=SimpleNamespace(
            rotation_rpy_rad=(1.5707963267948966, 0.0, 0.0),
            material_color="#ef4444",
            physics=SimpleNamespace(mass_kg=0.12, friction=3.0, restitution=0.0),
        ),
    )

    _add_box_entity(
        gs,
        scene,
        spec=spec,
        fixed=False,
        collision=True,
        name="grabbable-container",
    )

    assert morphs.box_kwargs is not None
    assert morphs.box_kwargs["collision"] is True
    assert scene.added[0][1]["name"] == "grabbable-container"
    assert scene.added[0][1]["material"] == {
        "kind": "rigid",
        "kwargs": materials.rigid_kwargs[0],
    }


def test_add_floor_entity_uses_thick_fixed_collider() -> None:
    morphs = _FakeMorphs()
    materials = _FakeMaterials()
    gs = SimpleNamespace(
        morphs=morphs,
        surfaces=SimpleNamespace(Default=lambda **kwargs: {"surface": kwargs}),
        materials=materials,
    )
    scene = _FakeScene()

    _add_floor_entity(gs, scene)

    assert morphs.box_kwargs is not None
    assert morphs.box_kwargs["size"] == (
        GENESIS_FLOOR_SIZE_XY[0],
        GENESIS_FLOOR_SIZE_XY[1],
        GENESIS_FLOOR_THICKNESS_M,
    )
    assert morphs.box_kwargs["pos"] == pytest.approx(
        (0.0, 0.0, -GENESIS_FLOOR_THICKNESS_M / 2.0)
    )
    assert morphs.box_kwargs["fixed"] is True
    assert morphs.box_kwargs["collision"] is True
    assert scene.added[0][1]["name"] == "floor"
    assert scene.added[0][1]["material"] == {
        "kind": "rigid",
        "kwargs": materials.rigid_kwargs[0],
    }
    assert materials.rigid_kwargs == [{"friction": DEFAULT_FLOOR_FRICTION}]


def test_oriented_box_min_z_uses_rotated_extents() -> None:
    min_z = _oriented_box_min_z(
        qpos=[
            0.0,
            0.0,
            0.05,
            0.7071067811865476,
            0.7071067811865476,
            0.0,
            0.0,
        ],
        box_size_xyz=(0.1, 0.2, 0.03),
    )

    assert min_z == pytest.approx(-0.05)


def test_enforce_dynamic_floor_contact_lifts_flipped_box_above_floor() -> None:
    class _FakeEntity:
        def __init__(self) -> None:
            self.qpos = [
                0.28,
                0.02,
                0.02,
                0.7071067811865476,
                0.7071067811865476,
                0.0,
                0.0,
            ]
            self.qvel = [0.0, 0.0, -1.0, 0.0, 0.0, 0.0]

        def get_qpos(self):
            return self.qpos

        def set_qpos(self, qpos):
            self.qpos = list(qpos)

        def get_qvel(self):
            return self.qvel

        def set_qvel(self, qvel):
            self.qvel = list(qvel)

    spec = SimpleNamespace(box_size_xyz=(0.1, 0.2, 0.03))
    entity = _FakeEntity()

    clamped = _enforce_dynamic_floor_contact([(spec, entity, (0.0, 0.0, 0.0))])

    assert clamped == 1
    assert entity.qpos[2] == pytest.approx(
        GENESIS_FLOOR_TOP_Z + GENESIS_FLOOR_CLEARANCE_EPSILON_M + 0.1
    )
    assert entity.qvel[2] == 0.0


def test_robot_collision_min_z_includes_visual_geometry() -> None:
    class _LinkWithAabb:
        def get_AABB(self):  # noqa: N802 - mirrors Genesis API
            return [[0.0, 0.0, 0.02], [0.1, 0.1, 0.2]]

    class _VisualOnlyLink:
        def get_AABB(self):  # noqa: N802 - mirrors Genesis API
            raise RuntimeError("Link has no collision geometries.")

        def get_vAABB(self):  # noqa: N802 - mirrors Genesis API
            return [[0.0, 0.0, -0.01], [0.1, 0.1, 0.2]]

    robot = SimpleNamespace(links=[_VisualOnlyLink(), _LinkWithAabb()])

    assert _robot_collision_min_z(robot) == pytest.approx(-0.01)


def test_enforce_robot_floor_contact_restores_last_safe_joints() -> None:
    class _UnsafeLink:
        def get_AABB(self):  # noqa: N802 - mirrors Genesis API
            return [[0.0, 0.0, -0.01], [0.1, 0.1, 0.2]]

    class _FakeRobot:
        def __init__(self) -> None:
            self.links = [_UnsafeLink()]
            self.qpos = [0.2, -0.1, 0.3]
            self.zeroed_velocity = False
            self.control_target: list[float] | None = None

        def get_qpos(self):
            return self.qpos

        def set_qpos(self, qpos):
            self.qpos = list(qpos)

        def zero_all_dofs_velocity(self):
            self.zeroed_velocity = True

        def control_dofs_position(self, qpos):
            self.control_target = list(qpos)

    robot = _FakeRobot()
    last_safe = [0.0, 0.0, 0.0]

    ok, next_safe = _enforce_robot_floor_contact(robot, last_safe)

    assert ok is False
    assert next_safe == last_safe
    assert robot.qpos == last_safe
    assert robot.zeroed_velocity is True
    assert robot.control_target == last_safe


def test_apply_rigid_entity_physics_overrides_sets_mass_and_friction() -> None:
    class _FakeEntity:
        def __init__(self) -> None:
            self.mass: float | None = None
            self.friction: float | None = None

        def set_mass(self, value: float) -> None:
            self.mass = value

        def set_friction(self, value: float) -> None:
            self.friction = value

    entity = _FakeEntity()

    _apply_rigid_entity_physics_overrides(
        entity,
        SimpleNamespace(mass_kg=0.12, friction=10.0),
    )

    assert entity.mass == 0.12
    assert entity.friction == GENESIS_RIGID_FRICTION_MAX


def test_resolve_studio_pose_from_dynamic_entity_qpos_removes_visual_offset() -> None:
    pose = _resolve_studio_pose_from_qpos(
        qpos=[0.42, 0.1, 0.2, 1.0, 0.0, 0.0, 0.0],
        scaled_visual_origin_offset_xyz=(0.02, -0.03, 0.04),
    )

    assert pose is not None
    position, orientation = pose
    assert position == pytest.approx((0.4, 0.13, 0.16))
    assert orientation == (1.0, 0.0, 0.0, 0.0)


def test_visual_mesh_qpos_from_collider_qpos_keeps_visual_attached_to_proxy() -> None:
    qpos = _visual_mesh_qpos_from_collider_qpos(
        collider_qpos=[0.42, 0.1, 0.2, 1.0, 0.0, 0.0, 0.0],
        collider_scaled_offset_xyz=(0.02, -0.03, 0.04),
        visual_scaled_offset_xyz=(0.05, 0.01, -0.02),
    )

    assert qpos is not None
    assert qpos[:3] == pytest.approx((0.45, 0.14, 0.14))
    assert qpos[3:] == [1.0, 0.0, 0.0, 0.0]


def test_apply_live_joint_values_targets_matching_genesis_dofs() -> None:
    class _FakeRobot:
        def __init__(self) -> None:
            self.joints = [
                SimpleNamespace(name="shoulder_pan", dofs_idx_local=[0]),
                SimpleNamespace(name="gripper", dofs_idx_local=[5]),
            ]
            self.calls: list[tuple[list[float], list[int]]] = []

        def control_dofs_position(self, positions, *, dofs_idx_local):
            self.calls.append((list(positions), list(dofs_idx_local)))

    robot = _FakeRobot()
    indices = _joint_dof_indices_by_name(robot)
    applied = _apply_live_joint_values(
        robot,
        indices,
        {"shoulder_pan": 0.1, "unknown": 1.0, "gripper": 0.8},
    )

    assert indices == {"shoulder_pan": 0, "gripper": 5}
    assert applied == 2
    assert robot.calls == [([0.1, 0.8], [0, 5])]


def test_robot_joint_values_payload_reads_corrected_genesis_qpos() -> None:
    robot = SimpleNamespace(qpos=[0.1, -0.2, 0.3])
    robot.get_qpos = lambda: robot.qpos

    payload = _robot_joint_values_payload(
        robot,
        {
            "shoulder_pan": 0,
            "wrist_flex": 2,
            "missing": 7,
        },
    )

    assert payload == {"shoulder_pan": 0.1, "wrist_flex": 0.3}
