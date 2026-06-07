from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from backend.scripts.genesis_world_open import _add_mesh_entity


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
