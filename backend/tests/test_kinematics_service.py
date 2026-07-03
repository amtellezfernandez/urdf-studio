from __future__ import annotations

import math

import pytest
from fastapi import HTTPException

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
