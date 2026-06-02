from __future__ import annotations

import colorsys
import hashlib
import re
from pathlib import Path

from backend.core.settings import settings
from backend.models.runtime_integrations import (
    ButterClawRuntimeObjectSnapshot,
    ButterClawRuntimeObjectsResponse,
)


_CLUSTER_RE = re.compile(
    r"^- (?P<cluster_id>[^:]+): class=(?P<class_label>\S+) "
    r"pos=\((?P<x>-?\d+(?:\.\d+)?), (?P<y>-?\d+(?:\.\d+)?)\) "
    r"yaw=(?P<yaw>-?\d+(?:\.\d+)?) "
    r"count=(?P<count>\d+) "
    r"best=(?P<best>-?\d+(?:\.\d+)?) "
    r"@ (?P<last_seen_at>.+)$"
)

_DEFAULT_OBJECT_SIZE_M = (0.12, 0.12, 0.12)
_OBJECT_HEIGHT_AXIS_INDEX = 1


def _class_color_hex(class_label: str) -> str:
    digest = hashlib.sha1(class_label.encode("utf-8")).digest()
    hue = digest[0] / 255.0
    saturation = 0.65
    value = 0.95
    red, green, blue = colorsys.hsv_to_rgb(hue, saturation, value)
    return "#{:02x}{:02x}{:02x}".format(
        int(red * 255),
        int(green * 255),
        int(blue * 255),
    )


class ButterClawRuntimeObjectsService:
    def __init__(self, current_map_path: str) -> None:
        self._current_map_path = Path(current_map_path)

    def list_objects(self) -> ButterClawRuntimeObjectsResponse:
        if not self._current_map_path.exists():
            return ButterClawRuntimeObjectsResponse(
                source_path=str(self._current_map_path),
                objects=[],
            )
        objects: list[ButterClawRuntimeObjectSnapshot] = []
        for raw_line in self._current_map_path.read_text(encoding="utf-8").splitlines():
            match = _CLUSTER_RE.match(raw_line.strip())
            if match is None:
                continue
            class_label = match.group("class_label")
            size_xyz = _DEFAULT_OBJECT_SIZE_M
            objects.append(
                ButterClawRuntimeObjectSnapshot(
                    object_id=f"butterclaw-{match.group('cluster_id')}",
                    class_label=class_label,
                    cluster_id=match.group("cluster_id"),
                    position_xyz=(
                        float(match.group("x")),
                        size_xyz[_OBJECT_HEIGHT_AXIS_INDEX] * 0.5,
                        float(match.group("y")),
                    ),
                    size_xyz=size_xyz,
                    color_hex=_class_color_hex(class_label),
                    observation_count=int(match.group("count")),
                    best_confidence=float(match.group("best")),
                    last_seen_at=match.group("last_seen_at"),
                )
            )
        return ButterClawRuntimeObjectsResponse(
            source_path=str(self._current_map_path),
            objects=objects,
        )


butterclaw_runtime_objects_service = ButterClawRuntimeObjectsService(
    settings.butterclaw_current_map_path
)
