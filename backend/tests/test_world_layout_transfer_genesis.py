from __future__ import annotations

from types import SimpleNamespace

from backend.services.world_layout_transfer_genesis import (
    _genesis_entity_rgba,
    _genesis_morph_full_size,
    _genesis_morph_type_name,
    _genesis_texture_color,
)


class Box:
    size = (0.1, 0.2, 0.3)


class Sphere:
    radius = 0.25


class Cylinder:
    radius = 0.2
    height = 0.7


def test_genesis_morph_type_names_are_normalized() -> None:
    assert _genesis_morph_type_name(Box()) == "box"
    assert _genesis_morph_type_name(Sphere()) == "sphere"
    assert _genesis_morph_type_name(Cylinder()) == "cylinder"
    assert _genesis_morph_type_name(object()) is None


def test_genesis_morph_full_size_uses_studio_dimensions() -> None:
    assert _genesis_morph_full_size(Box()) == (0.1, 0.2, 0.3)
    assert _genesis_morph_full_size(Sphere()) == (0.5, 0.5, 0.5)
    assert _genesis_morph_full_size(Cylinder()) == (0.4, 0.4, 0.7)
    assert _genesis_morph_full_size(object()) is None


def test_genesis_entity_rgba_reads_diffuse_and_opacity_textures() -> None:
    entity = SimpleNamespace(
        surface=SimpleNamespace(
            diffuse_texture=SimpleNamespace(color=(0.1, 0.2, 0.3)),
            opacity_texture=SimpleNamespace(color=(0.4,)),
        ),
    )

    assert _genesis_entity_rgba(entity) == (0.1, 0.2, 0.3, 0.4)


def test_genesis_texture_color_rejects_invalid_color_values() -> None:
    assert _genesis_texture_color(SimpleNamespace(color=None)) is None
    assert _genesis_texture_color(SimpleNamespace(color=object())) is None
    assert _genesis_texture_color(SimpleNamespace(color=("bad",))) is None
