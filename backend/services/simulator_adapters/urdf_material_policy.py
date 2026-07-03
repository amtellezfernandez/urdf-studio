from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

from backend.core.paths import BASE_DIR

URDF_MATERIAL_POLICY_CONFIG_PATH = BASE_DIR / "config" / "urdf_material_policy.json"
UINT32_MASK = 0xFFFFFFFF


@dataclass(frozen=True)
class UrdfMaterialPolicy:
    synthetic_color_palette: tuple[str, ...]
    semantic_synthetic_colors: tuple[tuple[tuple[str, ...], str], ...]
    fnv1a32_offset_basis: int
    fnv1a32_prime: int


def load_urdf_material_policy(path: Path = URDF_MATERIAL_POLICY_CONFIG_PATH) -> UrdfMaterialPolicy:
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_palette = _require_list(payload, "syntheticColorPalette")
    raw_semantic_colors = _require_list(payload, "semanticSyntheticColors")
    palette = tuple(
        _rgba_string(entry, f"syntheticColorPalette[{index}]")
        for index, entry in enumerate(raw_palette)
    )
    semantic_colors = tuple(
        (
            tuple(str(term) for term in _require_list(entry, "terms")),
            _rgba_string(entry.get("rgba"), f"semanticSyntheticColors[{index}].rgba"),
        )
        for index, entry in enumerate(raw_semantic_colors)
        if isinstance(entry, dict)
    )
    if len(semantic_colors) != len(raw_semantic_colors):
        raise ValueError("semanticSyntheticColors entries must be objects")
    return UrdfMaterialPolicy(
        synthetic_color_palette=palette,
        semantic_synthetic_colors=semantic_colors,
        fnv1a32_offset_basis=_require_int(payload, "fnv1a32OffsetBasis"),
        fnv1a32_prime=_require_int(payload, "fnv1a32Prime"),
    )


@lru_cache(maxsize=1)
def get_urdf_material_policy() -> UrdfMaterialPolicy:
    return load_urdf_material_policy()


def synthetic_urdf_material_name(link_name: str, visual_index: int) -> str:
    safe_link_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", link_name.strip()).strip("_")
    return f"urdf_studio_{safe_link_name or 'visual'}_{visual_index}"


def materialize_urdf_visual_material_colors(
    urdf_path: Path,
    *,
    policy: UrdfMaterialPolicy | None = None,
) -> int:
    resolved_policy = policy or get_urdf_material_policy()
    tree = ET.parse(urdf_path)
    root = tree.getroot()
    material_colors = {
        material.get("name"): color.get("rgba", "").strip()
        for material in root.findall("material")
        if material.get("name")
        for color in [material.find("color")]
        if color is not None and color.get("rgba", "").strip()
    }
    changed_count = 0
    for link in root.findall("link"):
        link_name = link.get("name", "")
        for visual_index, visual in enumerate(link.findall("visual")):
            material = visual.find("material")
            if urdf_material_has_color(material):
                continue
            if material is None:
                material = ET.SubElement(
                    visual,
                    "material",
                    {"name": synthetic_urdf_material_name(link_name, visual_index)},
                )
            material_name = material.get("name", "").strip()
            named_rgba = material_colors.get(material_name)
            mesh = visual.find("./geometry/mesh")
            ET.SubElement(
                material,
                "color",
                {
                    "rgba": named_rgba
                    or synthetic_urdf_visual_rgba(
                        link_name=link_name,
                        visual_name=visual.get("name", ""),
                        visual_index=visual_index,
                        mesh_filename=mesh.get("filename", "") if mesh is not None else "",
                        policy=resolved_policy,
                    ),
                },
            )
            changed_count += 1

    if changed_count:
        ET.indent(root, space="  ")
        tree.write(urdf_path, encoding="unicode", xml_declaration=False)
    return changed_count


def urdf_material_has_color(material: ET.Element | None) -> bool:
    if material is None:
        return False
    color = material.find("color")
    return color is not None and bool(color.get("rgba", "").strip())


def synthetic_urdf_visual_rgba(
    *,
    link_name: str,
    visual_name: str,
    visual_index: int,
    mesh_filename: str,
    policy: UrdfMaterialPolicy | None = None,
) -> str:
    resolved_policy = policy or get_urdf_material_policy()
    fingerprint = urdf_visual_fingerprint(
        link_name=link_name,
        visual_name=visual_name,
        visual_index=visual_index,
        mesh_filename=mesh_filename,
    )
    fingerprint_lower = fingerprint.lower()
    for terms, rgba in resolved_policy.semantic_synthetic_colors:
        if any(term in fingerprint_lower for term in terms):
            return rgba
    return resolved_policy.synthetic_color_palette[
        stable_palette_index(
            fingerprint_lower,
            len(resolved_policy.synthetic_color_palette),
            policy=resolved_policy,
        )
    ]


def urdf_visual_fingerprint(
    *,
    link_name: str,
    visual_name: str,
    visual_index: int,
    mesh_filename: str,
) -> str:
    parts = [link_name, visual_name, str(visual_index), mesh_filename]
    return " ".join(part for part in parts if part)


def stable_palette_index(
    value: str,
    palette_size: int,
    *,
    policy: UrdfMaterialPolicy | None = None,
) -> int:
    if palette_size <= 0:
        raise ValueError("palette_size must be positive")
    resolved_policy = policy or get_urdf_material_policy()
    return _fnv1a_32(
        value.encode("utf-8"),
        offset_basis=resolved_policy.fnv1a32_offset_basis,
        prime=resolved_policy.fnv1a32_prime,
    ) % palette_size


def _fnv1a_32(data: Sequence[int], *, offset_basis: int, prime: int) -> int:
    digest = offset_basis
    for byte in data:
        digest ^= int(byte) & 0xFF
        digest = (digest * prime) & UINT32_MASK
    return digest


def _require_list(payload: dict[str, Any], key: str) -> list[Any]:
    value = payload.get(key)
    if not isinstance(value, list) or len(value) == 0:
        raise ValueError(f"{key} must be a non-empty list")
    return value


def _require_int(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value


def _rgba_string(value: Any, path: str) -> str:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{path} must be an RGBA list")
    components: list[float] = []
    for component in value:
        if not isinstance(component, int | float):
            raise ValueError(f"{path} must contain numeric RGBA components")
        parsed = float(component)
        if parsed < 0.0 or parsed > 1.0:
            raise ValueError(f"{path} components must be between 0 and 1")
        components.append(parsed)
    return " ".join(_format_float_component(component) for component in components)


def _format_float_component(value: float) -> str:
    formatted = f"{value:.12g}"
    return f"{formatted}.0" if "." not in formatted and "e" not in formatted else formatted
