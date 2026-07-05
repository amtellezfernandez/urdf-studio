from __future__ import annotations

import pytest

from backend.services.simulator_adapters.camera_intrinsics import (
    focal_length_px_from_vertical_fov_deg,
    pinhole_camera_intrinsics_from_record,
    vertical_fov_deg_from_focal_length_px,
)


def test_pinhole_camera_intrinsics_derives_missing_fx_from_fy() -> None:
    intrinsics = pinhole_camera_intrinsics_from_record(
        {
            "width": 640,
            "height": 480,
            "fy": 502.0,
        }
    )

    assert intrinsics is not None
    assert intrinsics.vertical_fov_deg == pytest.approx(
        vertical_fov_deg_from_focal_length_px(502.0, 480)
    )
    assert intrinsics.matrix == (
        (502.0 * (640 / 480), 0.0, 320.0),
        (0.0, 502.0, 240.0),
        (0.0, 0.0, 1.0),
    )


def test_pinhole_camera_intrinsics_derives_missing_fy_from_fx() -> None:
    intrinsics = pinhole_camera_intrinsics_from_record(
        {
            "width": 640,
            "height": 480,
            "fx": 640.0,
        }
    )

    assert intrinsics is not None
    expected_fy = 640.0 / (640 / 480)
    assert intrinsics.vertical_fov_deg == pytest.approx(
        vertical_fov_deg_from_focal_length_px(expected_fy, 480)
    )
    assert intrinsics.matrix == (
        (640.0, 0.0, 320.0),
        (0.0, expected_fy, 240.0),
        (0.0, 0.0, 1.0),
    )


def test_pinhole_camera_intrinsics_rejects_present_non_positive_optional_focal_length() -> None:
    assert (
        pinhole_camera_intrinsics_from_record(
            {
                "width": 640,
                "height": 480,
                "fx": 0.0,
                "fov_deg": 60.0,
            }
        )
        is None
    )


def test_focal_length_and_vertical_fov_helpers_round_trip() -> None:
    focal_length_px = focal_length_px_from_vertical_fov_deg(60.0, 480)

    assert vertical_fov_deg_from_focal_length_px(focal_length_px, 480) == pytest.approx(60.0)


@pytest.mark.parametrize("fov_deg", [0.0, 180.0, float("inf"), float("nan")])
def test_focal_length_from_vertical_fov_rejects_invalid_fov(fov_deg: float) -> None:
    with pytest.raises(ValueError, match="vertical FOV must be a finite value in \\(0, 180\\)"):
        focal_length_px_from_vertical_fov_deg(fov_deg, 480)


@pytest.mark.parametrize("height_px", [0, -1, True])
def test_camera_intrinsics_helpers_reject_invalid_height(height_px: int) -> None:
    with pytest.raises(ValueError, match="image height must be a positive integer"):
        focal_length_px_from_vertical_fov_deg(60.0, height_px)
    with pytest.raises(ValueError, match="image height must be a positive integer"):
        vertical_fov_deg_from_focal_length_px(400.0, height_px)


@pytest.mark.parametrize("fy_px", [0.0, -1.0, float("inf"), float("nan")])
def test_vertical_fov_from_focal_length_rejects_invalid_focal_length(fy_px: float) -> None:
    with pytest.raises(ValueError, match="focal length must be a positive finite value"):
        vertical_fov_deg_from_focal_length_px(fy_px, 480)
