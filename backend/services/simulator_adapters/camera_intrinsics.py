from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypeAlias

from backend.services.simulator_adapters.numeric import is_finite_number

CameraIntrinsicsRecord: TypeAlias = Mapping[str, object]


@dataclass(frozen=True)
class PinholeCameraIntrinsics:
    # Matches RoboVerse MetaSim's explicit pinhole camera contract: backends get
    # width, height, vertical FOV, and a 3x3 intrinsic matrix.
    width: int
    height: int
    vertical_fov_deg: float
    matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


class _InvalidOptionalNumber:
    pass


OptionalFloatRead: TypeAlias = float | None | _InvalidOptionalNumber

_INVALID_OPTIONAL_NUMBER = _InvalidOptionalNumber()


def pinhole_camera_intrinsics_from_record(value: object) -> PinholeCameraIntrinsics | None:
    if not isinstance(value, Mapping):
        return None
    width = _read_camera_dimension(value.get("width"))
    height = _read_camera_dimension(value.get("height"))
    if width is None or height is None:
        return None

    fx = _read_optional_positive_float(value, "fx")
    fy = _read_optional_positive_float(value, "fy")
    if fx is _INVALID_OPTIONAL_NUMBER or fy is _INVALID_OPTIONAL_NUMBER:
        return None
    if fx is None and fy is not None:
        fx = fy * (width / height)
    if fy is None and fx is not None:
        fy = fx * (height / width)

    if fy is None:
        vertical_fov_deg = _read_camera_fov_deg(value.get("fov_deg"))
        if vertical_fov_deg is None:
            return None
        fy = focal_length_px_from_vertical_fov_deg(vertical_fov_deg, height)
        fx = fy * (width / height)
    else:
        vertical_fov_deg = vertical_fov_deg_from_focal_length_px(fy, height)
        if fx is None:
            return None

    cx = _read_optional_finite_float(value, "cx", fallback=width * 0.5)
    cy = _read_optional_finite_float(value, "cy", fallback=height * 0.5)
    if cx is _INVALID_OPTIONAL_NUMBER or cy is _INVALID_OPTIONAL_NUMBER:
        return None
    return PinholeCameraIntrinsics(
        width=width,
        height=height,
        vertical_fov_deg=vertical_fov_deg,
        matrix=(
            (fx, 0.0, cx),
            (0.0, fy, cy),
            (0.0, 0.0, 1.0),
        ),
    )


def focal_length_px_from_vertical_fov_deg(fov_deg: float, height_px: int) -> float:
    half_fov_rad = math.radians(fov_deg) * 0.5
    return height_px / (2.0 * math.tan(half_fov_rad))


def vertical_fov_deg_from_focal_length_px(fy_px: float, height_px: int) -> float:
    half_fov_rad = math.atan(height_px / (2.0 * fy_px))
    return math.degrees(half_fov_rad) * 2.0


def _read_camera_dimension(value: object) -> int | None:
    if not is_finite_number(value):
        return None
    parsed = float(value)
    if parsed < 1.0 or not parsed.is_integer():
        return None
    return int(parsed)


def _read_camera_fov_deg(value: object) -> float | None:
    if not is_finite_number(value):
        return None
    parsed = float(value)
    if 1.0 <= parsed <= 179.0:
        return parsed
    return None


def _read_positive_float(value: object) -> float | None:
    if not is_finite_number(value):
        return None
    parsed = float(value)
    return parsed if parsed > 0.0 else None


def _read_optional_positive_float(record: CameraIntrinsicsRecord, key: str) -> OptionalFloatRead:
    if key not in record:
        return None
    return _read_positive_float(record.get(key)) or _INVALID_OPTIONAL_NUMBER


def _read_optional_finite_float(
    record: CameraIntrinsicsRecord,
    key: str,
    *,
    fallback: float,
) -> float | _InvalidOptionalNumber:
    if key not in record:
        return fallback
    value = record.get(key)
    return float(value) if is_finite_number(value) else _INVALID_OPTIONAL_NUMBER
