from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.scripts.genesis_world_open import (
    _add_mesh_entity,
    _apply_live_joint_values,
    _joint_dof_indices_by_name,
    _resolve_studio_pose_from_qpos,
)


class _FakeMorphs:
    def __init__(self) -> None:
        self.mesh_kwargs: dict | None = None

    def Mesh(self, **kwargs):  # noqa: N802 - mirrors Genesis API
        self.mesh_kwargs = kwargs
        return {"kind": "mesh", "kwargs": kwargs}


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
    )
    scene = _FakeScene()
    spec = SimpleNamespace(
        asset_path=Path("container.glb"),
        mesh_position_xyz=(0.3, 0.0, 0.0),
        effective_scale_xyz=(0.045, 0.045, 0.045),
        element=SimpleNamespace(
            rotation_rpy_rad=(1.5707963267948966, 0.0, 0.0),
            material_color="#ef4444",
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
    )
    scene = _FakeScene()
    spec = SimpleNamespace(
        asset_path=Path("container.glb"),
        mesh_position_xyz=(0.3, 0.0, 0.0),
        effective_scale_xyz=(0.045, 0.045, 0.045),
        element=SimpleNamespace(
            rotation_rpy_rad=(1.5707963267948966, 0.0, 0.0),
            material_color="#ef4444",
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


def test_resolve_studio_pose_from_dynamic_entity_qpos_removes_visual_offset() -> None:
    pose = _resolve_studio_pose_from_qpos(
        qpos=[0.42, 0.1, 0.2, 1.0, 0.0, 0.0, 0.0],
        scaled_visual_origin_offset_xyz=(0.02, -0.03, 0.04),
    )

    assert pose is not None
    position, orientation = pose
    assert position == pytest.approx((0.4, 0.13, 0.16))
    assert orientation == (1.0, 0.0, 0.0, 0.0)


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
