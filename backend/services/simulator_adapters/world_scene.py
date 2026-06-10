from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.world_layout_static_transfer import (
    ConcreteWorldLayoutFrameMap,
    SimPrimitive,
    StaticWorldLayout,
    WorldLayoutFrameMap,
    build_sim_primitives,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)


@dataclass(frozen=True)
class PreparedWorldScene:
    world_package: WorldScenePackageManifest
    layout: StaticWorldLayout
    frame_map: ConcreteWorldLayoutFrameMap
    primitives: tuple[SimPrimitive, ...]
    warnings: tuple[str, ...]


def load_world_package(path: Path) -> WorldScenePackageManifest:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Failed to read world package: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid world package JSON: {exc}") from exc
    return WorldScenePackageManifest.model_validate(payload)


def prepare_world_scene(
    *,
    world_package_path: Path,
    frame_map: WorldLayoutFrameMap,
    include_hidden: bool,
) -> PreparedWorldScene:
    world_package = load_world_package(world_package_path)
    layout = parse_static_world_layout_payload(world_package.model_dump(mode="json"))
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=include_hidden,
    )
    return PreparedWorldScene(
        world_package=world_package,
        layout=layout,
        frame_map=resolved_frame_map,
        primitives=primitives,
        warnings=warnings,
    )
