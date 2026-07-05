from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Sequence, cast

from backend.core.paths import BASE_DIR
from backend.models.json_payload import JsonObject, JsonValue

URDF_MATERIAL_POLICY_CONFIG_PATH = BASE_DIR / "config" / "urdf_material_policy.json"
UINT32_MASK = 0xFFFFFFFF


@dataclass(frozen=True)
class UrdfMaterialPolicy:
    synthetic_color_palette: tuple[str, ...]
    semantic_synthetic_colors: tuple[tuple[tuple[str, ...], str], ...]
    fnv1a32_offset_basis: int
    fnv1a32_prime: int


def load_urdf_material_policy(path: Path = URDF_MATERIAL_POLICY_CONFIG_PATH) -> UrdfMaterialPolicy:
    payload = _load_policy_payload(path)
    raw_palette = _require_list(payload, "syntheticColorPalette")
    raw_semantic_colors = _require_list(payload, "semanticSyntheticColors")
    palette = tuple(
        _rgba_string(entry, f"syntheticColorPalette[{index}]")
        for index, entry in enumerate(raw_palette)
    )
    semantic_colors = tuple(
        _read_semantic_synthetic_color(entry, index)
        for index, entry in enumerate(raw_semantic_colors)
    )
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
            material = _ensure_visual_material(
                visual,
                link_name=link_name,
                visual_index=visual_index,
            )
            if urdf_material_has_color(material):
                continue
            ET.SubElement(
                material,
                "color",
                {
                    "rgba": _resolved_visual_material_rgba(
                        visual,
                        material_colors=material_colors,
                        link_name=link_name,
                        visual_index=visual_index,
                        policy=resolved_policy,
                    ),
                },
            )
            changed_count += 1

    if changed_count:
        ET.indent(root, space="  ")
        tree.write(urdf_path, encoding="unicode", xml_declaration=False)
    return changed_count


def _ensure_visual_material(
    visual: ET.Element,
    *,
    link_name: str,
    visual_index: int,
) -> ET.Element:
    material = visual.find("material")
    if material is not None:
        return material
    return ET.SubElement(
        visual,
        "material",
        {"name": synthetic_urdf_material_name(link_name, visual_index)},
    )


def _resolved_visual_material_rgba(
    visual: ET.Element,
    *,
    material_colors: dict[str, str],
    link_name: str,
    visual_index: int,
    policy: UrdfMaterialPolicy,
) -> str:
    material = visual.find("material")
    material_name = material.get("name", "").strip() if material is not None else ""
    named_rgba = material_colors.get(material_name)
    if named_rgba:
        return named_rgba
    mesh = visual.find("./geometry/mesh")
    return synthetic_urdf_visual_rgba(
        link_name=link_name,
        visual_name=visual.get("name", ""),
        visual_index=visual_index,
        mesh_filename=mesh.get("filename", "") if mesh is not None else "",
        policy=policy,
    )


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


def _load_policy_payload(path: Path) -> JsonObject:
    try:
        raw_payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Failed to read URDF material policy: {path}") from exc
    if not isinstance(raw_payload, dict):
        raise ValueError("URDF material policy must be a JSON object")
    return cast(JsonObject, raw_payload)


def _require_object(value: JsonValue, path: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return cast(JsonObject, value)


def _require_list(payload: JsonObject, key: str) -> list[JsonValue]:
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"{key} must be a non-empty list")
    return value


def _require_int(payload: JsonObject, key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{key} must be an integer")
    return value


def _read_semantic_synthetic_color(
    value: JsonValue,
    index: int,
) -> tuple[tuple[str, ...], str]:
    path = f"semanticSyntheticColors[{index}]"
    entry = _require_object(value, path)
    return (
        _require_string_list(entry.get("terms"), f"{path}.terms"),
        _rgba_string(entry.get("rgba"), f"{path}.rgba"),
    )


def _require_string_list(value: JsonValue, path: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{path} must be a non-empty string list")
    terms: list[str] = []
    for index, term in enumerate(value):
        if not isinstance(term, str) or not term.strip():
            raise ValueError(f"{path}[{index}] must be a non-empty string")
        terms.append(term.strip())
    return tuple(terms)


def _rgba_string(value: JsonValue, path: str) -> str:
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
