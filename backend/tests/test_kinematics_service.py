from __future__ import annotations

import importlib
import math
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.services import kinematics as kinematics_module
from backend.services.kinematics import FKRequest, compute_link_pose, forward_kinematics, rotation_matrix_to_wxyz


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


def test_load_urdf_from_xml_rejects_missing_yourdfpy_loader(monkeypatch) -> None:
    def _fake_import_module(name: str) -> object:
        if name == "yourdfpy":
            return SimpleNamespace(URDF=SimpleNamespace(load=None))
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    with pytest.raises(ValueError, match="yourdfpy.URDF.load is unavailable"):
        kinematics_module._load_urdf_from_xml("<robot name='demo'/>")


def test_load_urdf_from_xml_rejects_missing_yourdfpy_module(monkeypatch) -> None:
    def _fake_import_module(name: str) -> object:
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    with pytest.raises(ValueError, match="yourdfpy is not installed"):
        kinematics_module._load_urdf_from_xml("<robot name='demo'/>")


def test_compute_link_pose_wraps_expected_fk_errors(monkeypatch) -> None:
    class _BrokenRobot:
        actuated_joint_names = ()
        link_map = {"tool": object()}

        @staticmethod
        def update_cfg(_joint_values):
            raise ValueError("bad joint values")

    monkeypatch.setattr(
        kinematics_module,
        "_get_or_create_entry",
        lambda _urdf_xml: SimpleNamespace(urdf=_BrokenRobot()),
    )

    with pytest.raises(HTTPException) as exc_info:
        compute_link_pose("<robot name='demo'/>", {}, "tool")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Forward kinematics failed: bad joint values"


def test_forward_kinematics_preserves_unexpected_transform_errors(monkeypatch) -> None:
    class _BrokenRobot:
        actuated_joint_names = ()
        link_map = {"tool": object()}

        @staticmethod
        def update_cfg(_joint_values):
            return None

        @staticmethod
        def get_transform(_link_name: str):
            raise KeyError("unexpected transform failure")

    monkeypatch.setattr(
        kinematics_module,
        "_get_or_create_entry",
        lambda _urdf_xml: SimpleNamespace(urdf=_BrokenRobot(), urdf_hash="demo"),
    )

    with pytest.raises(KeyError, match="unexpected transform failure"):
        forward_kinematics(FKRequest(urdf="<robot name='demo'/>", joint_values={}))
