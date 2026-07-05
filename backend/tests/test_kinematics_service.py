from __future__ import annotations

import math

import pytest
from fastapi import HTTPException

from backend.services import kinematics as kinematics_module
from backend.services.kinematics import rotation_matrix_to_wxyz


def test_rotation_matrix_to_wxyz_returns_identity_quaternion() -> None:
    assert rotation_matrix_to_wxyz(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ]
    ) == [1.0, 0.0, 0.0, 0.0]


def test_rotation_matrix_to_wxyz_normalizes_quaternion() -> None:
    quaternion = rotation_matrix_to_wxyz(
        [
            [1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.0, 1.0, 0.0],
        ]
    )

    quaternion_norm = math.sqrt(sum(component * component for component in quaternion))

    assert quaternion_norm == pytest.approx(1.0)


def test_rotation_matrix_to_wxyz_rejects_non_3x3_matrix() -> None:
    with pytest.raises(HTTPException) as exc_info:
        rotation_matrix_to_wxyz([[1.0, 0.0], [0.0, 1.0]])

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "target_rotation must be a 3x3 matrix"


def test_kinematics_get_or_create_entry_wraps_expected_urdf_load_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        kinematics_module,
        "_load_urdf_from_xml",
        lambda _urdf_xml: (_ for _ in ()).throw(ValueError("bad urdf")),
    )

    with pytest.raises(HTTPException) as exc_info:
        kinematics_module._get_or_create_entry("<robot name='demo'/>")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Failed to load URDF: bad urdf"


def test_kinematics_get_or_create_entry_preserves_unexpected_urdf_load_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        kinematics_module,
        "_load_urdf_from_xml",
        lambda _urdf_xml: (_ for _ in ()).throw(RuntimeError("unexpected urdf failure")),
    )

    with pytest.raises(RuntimeError, match="unexpected urdf failure"):
        kinematics_module._get_or_create_entry("<robot name='demo'/>")
