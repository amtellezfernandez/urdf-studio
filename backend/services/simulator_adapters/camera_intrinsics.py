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
DerivedFocalLengths: TypeAlias = tuple[float, float, float]

_INVALID_OPTIONAL_NUMBER = _InvalidOptionalNumber()


def pinhole_camera_intrinsics_from_record(value: object) -> PinholeCameraIntrinsics | None:
    if not isinstance(value, Mapping):
        return None
    width = _read_camera_dimension(value.get("width"))
    height = _read_camera_dimension(value.get("height"))
    if width is None or height is None:
        return None

    resolved_focal_lengths = _read_resolved_focal_lengths(
        value,
        width=width,
        height=height,
    )
    if resolved_focal_lengths is None:
        return None
    fx, fy, vertical_fov_deg = resolved_focal_lengths

    principal_point = _read_principal_point(value, width=width, height=height)
    if principal_point is None:
        return None
    cx, cy = principal_point
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
    if not is_finite_number(fov_deg) or not 0.0 < float(fov_deg) < 180.0:
        raise ValueError(f"vertical FOV must be a finite value in (0, 180), got {fov_deg!r}")
    if not isinstance(height_px, int) or isinstance(height_px, bool) or height_px <= 0:
        raise ValueError(f"image height must be a positive integer, got {height_px!r}")
    half_fov_rad = math.radians(fov_deg) * 0.5
    return height_px / (2.0 * math.tan(half_fov_rad))


def vertical_fov_deg_from_focal_length_px(fy_px: float, height_px: int) -> float:
    if not is_finite_number(fy_px) or float(fy_px) <= 0.0:
        raise ValueError(f"focal length must be a positive finite value, got {fy_px!r}")
    if not isinstance(height_px, int) or isinstance(height_px, bool) or height_px <= 0:
        raise ValueError(f"image height must be a positive integer, got {height_px!r}")
    half_fov_rad = math.atan(height_px / (2.0 * fy_px))
    return math.degrees(half_fov_rad) * 2.0


def _derived_focal_lengths(
    record: CameraIntrinsicsRecord,
    *,
    width: int,
    height: int,
    fx: float | None,
    fy: float | None,
) -> DerivedFocalLengths | None:
    if fy is not None:
        if fx is None:
            return None
        return fx, fy, vertical_fov_deg_from_focal_length_px(fy, height)

    vertical_fov_deg = _read_camera_fov_deg(record.get("fov_deg"))
    if vertical_fov_deg is None:
        return None
    fy = focal_length_px_from_vertical_fov_deg(vertical_fov_deg, height)
    fx = fy * _camera_aspect_ratio(width=width, height=height)
    return fx, fy, vertical_fov_deg


def _read_resolved_focal_lengths(
    record: CameraIntrinsicsRecord,
    *,
    width: int,
    height: int,
) -> DerivedFocalLengths | None:
    fx = _read_optional_positive_float(record, "fx")
    fy = _read_optional_positive_float(record, "fy")
    if fx is _INVALID_OPTIONAL_NUMBER or fy is _INVALID_OPTIONAL_NUMBER:
        return None
    normalized_fx, normalized_fy = _normalize_focal_length_pair(
        width=width,
        height=height,
        fx=fx,
        fy=fy,
    )
    return _derived_focal_lengths(
        record,
        width=width,
        height=height,
        fx=normalized_fx,
        fy=normalized_fy,
    )


def _normalize_focal_length_pair(
    *,
    width: int,
    height: int,
    fx: float | None,
    fy: float | None,
) -> tuple[float | None, float | None]:
    if fx is None and fy is not None:
        return fy * _camera_aspect_ratio(width=width, height=height), fy
    if fy is None and fx is not None:
        return fx, fx / _camera_aspect_ratio(width=width, height=height)
    return fx, fy


def _camera_aspect_ratio(*, width: int, height: int) -> float:
    return width / height


def _read_principal_point(
    record: CameraIntrinsicsRecord,
    *,
    width: int,
    height: int,
) -> tuple[float, float] | None:
    cx = _read_optional_finite_float(record, "cx", default_value=width * 0.5)
    cy = _read_optional_finite_float(record, "cy", default_value=height * 0.5)
    if cx is _INVALID_OPTIONAL_NUMBER or cy is _INVALID_OPTIONAL_NUMBER:
        return None
    return cx, cy


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
    parsed = _read_positive_float(record.get(key))
    if parsed is None:
        return _INVALID_OPTIONAL_NUMBER
    return parsed


def _read_optional_finite_float(
    record: CameraIntrinsicsRecord,
    key: str,
    *,
    default_value: float,
) -> float | _InvalidOptionalNumber:
    if key not in record:
        return default_value
    value = record.get(key)
    return float(value) if is_finite_number(value) else _INVALID_OPTIONAL_NUMBER
