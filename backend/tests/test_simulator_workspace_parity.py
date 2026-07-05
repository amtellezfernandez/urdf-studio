from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SIMULATOR_GENESIS_ID, SIMULATOR_MUJOCO_ID
from backend.services.simulator_adapters import workspace_parity as workspace_parity_module
from backend.services.simulator_adapters.workspace_parity import (
    WorkspaceParityInput,
    check_simulator_workspace_parity,
)


def test_simulator_workspace_parity_accepts_matching_reports(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is True


def test_simulator_workspace_parity_rejects_report_mismatch(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.2,
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "report.objects" in result.detail


def test_simulator_workspace_parity_rejects_missing_required_report_fields(
    tmp_path: Path,
) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    invalid_report = tmp_path / "invalid" / "report.json"
    invalid_report.parent.mkdir(parents=True)
    invalid_report.write_text(
        json.dumps(
            {
                "package_id": "demo",
                "version": "1.0.0",
            }
        ),
        encoding="utf-8",
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("Invalid", invalid_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "could not read Invalid validation report" in result.detail
    assert "missing parity report field(s): requested_frame_map, frame_map" in result.detail


def test_simulator_workspace_parity_rejects_missing_robot_urdf_path_and_asset_roots(
    tmp_path: Path,
) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    invalid_report = tmp_path / "invalid" / "report.json"
    invalid_report.parent.mkdir(parents=True)
    invalid_report.write_text(
        json.dumps(
            {
                "simulator": {"id": SIMULATOR_MUJOCO_ID, "label": "mujoco", "runtime": {}},
                "package_id": "demo",
                "version": "1.0.0",
                "requested_frame_map": "identity",
                "frame_map": "identity",
                "frame_convention": "ros-rep-103",
                "object_count": 1,
                "primitive_count": 1,
                "camera_count": 0,
                "joint_position_count": 0,
                "joint_positions": {},
                "warnings": [],
                "objects": [],
                "cameras": [],
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("Invalid", invalid_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "missing parity report field(s): robot_urdf_path, asset_roots" in result.detail


@pytest.mark.parametrize(
    ("field_name", "field_value", "expected_error"),
    [
        ("robot_urdf_path", "   ", "parity report field 'robot_urdf_path' must be a non-empty string"),
        ("asset_roots", "not-a-list", "parity report field 'asset_roots' must be a list"),
        ("warnings", [1], "parity report field 'warnings[0]' must be a string"),
        ("objects", {}, "parity report field 'objects' must be a list"),
        ("cameras", {}, "parity report field 'cameras' must be a list"),
        ("artifacts", [], "parity report field 'artifacts' must be an object"),
    ],
)
def test_simulator_workspace_parity_rejects_invalid_report_field_types(
    tmp_path: Path,
    field_name: str,
    field_value: object,
    expected_error: str,
) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    invalid_report = _write_parity_report(
        tmp_path / "invalid",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
    )
    payload = json.loads(invalid_report.read_text(encoding="utf-8"))
    payload[field_name] = field_value
    invalid_report.write_text(json.dumps(payload), encoding="utf-8")

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("Invalid", invalid_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "could not read Invalid validation report" in result.detail
    assert expected_error in result.detail


def test_simulator_workspace_parity_rejects_invalid_report_json(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    invalid_report = tmp_path / "invalid" / "report.json"
    invalid_report.parent.mkdir(parents=True)
    invalid_report.write_text("{", encoding="utf-8")

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("Invalid", invalid_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "could not read Invalid validation report" in result.detail
    assert "invalid parity report" in result.detail
    assert "report.json" in result.detail


def test_simulator_workspace_parity_rejects_invalid_report_encoding(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    invalid_report = tmp_path / "invalid" / "report.json"
    invalid_report.parent.mkdir(parents=True)
    invalid_report.write_bytes(b"\xff\xfe\x00")

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("Invalid", invalid_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "could not read Invalid validation report" in result.detail
    assert "invalid parity report" in result.detail
    assert "report.json" in result.detail


def test_simulator_workspace_parity_propagates_unexpected_report_loader_errors(
    monkeypatch,
    tmp_path: Path,
) -> None:
    report_path = tmp_path / "report.json"
    report_path.write_text("{}", encoding="utf-8")

    def fail_unexpectedly(_path: Path):
        raise RuntimeError("unexpected loader failure")

    monkeypatch.setattr(workspace_parity_module, "_load_report", fail_unexpectedly)

    with pytest.raises(RuntimeError, match="unexpected loader failure"):
        check_simulator_workspace_parity(
            [
                WorkspaceParityInput("Genesis", report_path),
                WorkspaceParityInput("MuJoCo", report_path),
            ]
        )


def test_simulator_workspace_parity_rejects_joint_position_mismatch(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
        joint_positions={"shoulder": 0.5},
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
        joint_positions={"shoulder": 0.75},
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "report.joint_positions" in result.detail


def test_simulator_workspace_parity_accepts_object_only_reports(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
        include_camera=False,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
        include_camera=False,
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is True


def test_simulator_workspace_parity_rejects_camera_image_mismatch(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        image_size=(64, 48),
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        image_size=(80, 48),
        object_x=0.1,
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "camera_images" in result.detail


def test_simulator_workspace_parity_rejects_camera_image_name_mismatch(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
        image_name="01_wrong_camera.png",
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "PNG names do not match report cameras" in result.detail


def test_simulator_workspace_parity_rejects_camera_artifact_file_path(
    tmp_path: Path,
) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
    )
    camera_file = tmp_path / "not-a-directory"
    camera_file.write_text("not a directory\n", encoding="utf-8")
    payload = json.loads(mujoco_report.read_text(encoding="utf-8"))
    payload["artifacts"]["camera_screenshot_dir"] = str(camera_file)
    mujoco_report.write_text(json.dumps(payload), encoding="utf-8")

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert f"MuJoCo camera_images directory is not a directory: {camera_file}" in result.detail


def test_simulator_workspace_parity_uses_sanitized_camera_image_names(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
        camera_sim_name="Scene Camera/Main",
        image_name="01_Scene_Camera_Main.png",
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
        camera_sim_name="Scene Camera/Main",
        image_name="01_Scene_Camera_Main.png",
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is True


def test_simulator_workspace_parity_rejects_blank_camera_image(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
        image_variant="blank",
    )

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "is blank" in result.detail


def test_simulator_workspace_parity_rejects_corrupted_camera_image(tmp_path: Path) -> None:
    genesis_report = _write_parity_report(
        tmp_path / "genesis",
        simulator_id=SIMULATOR_GENESIS_ID,
        object_x=0.1,
    )
    mujoco_report = _write_parity_report(
        tmp_path / "mujoco",
        simulator_id=SIMULATOR_MUJOCO_ID,
        object_x=0.1,
    )
    payload = json.loads(mujoco_report.read_text(encoding="utf-8"))
    camera_dir = Path(payload["artifacts"]["camera_screenshot_dir"])
    (camera_dir / "01_scene_camera.png").write_bytes(b"not-a-real-png")

    result = check_simulator_workspace_parity(
        [
            WorkspaceParityInput("Genesis", genesis_report),
            WorkspaceParityInput("MuJoCo", mujoco_report),
        ]
    )

    assert result is not None
    assert result.passed is False
    assert "invalid camera_images artifact" in result.detail


def _write_parity_report(
    root: Path,
    *,
    simulator_id: str,
    object_x: float,
    image_size: tuple[int, int] = (64, 48),
    image_name: str = "01_scene_camera.png",
    image_variant: str = "visible",
    include_camera: bool = True,
    joint_positions: dict[str, float] | None = None,
    camera_sim_name: str = "scene_camera",
) -> Path:
    from PIL import Image

    camera_dir = root / "cameras"
    camera_dir.mkdir(parents=True)
    if include_camera:
        image = Image.new("RGB", image_size, (255, 0, 0))
        if image_variant == "visible" and image_size[0] > 1 and image_size[1] > 1:
            image.putpixel((image_size[0] - 1, image_size[1] - 1), (0, 255, 0))
        elif image_variant != "blank":
            raise ValueError(f"unknown image_variant: {image_variant}")
        image.save(camera_dir / image_name)
    camera_entries = [
        {
            "camera_id": "cam",
            "name": "scene camera",
            "sim_name": camera_sim_name,
            "parent_joint": "base_link",
            "parent_link": "base_link",
            "position_xyz": [0.0, 0.0, 1.0],
            "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
            "width": 64,
            "height": 48,
            "fov_deg": 60.0,
            "intrinsics": {
                "matrix": [
                    [1.0, 0.0, 32.0],
                    [0.0, 1.0, 24.0],
                    [0.0, 0.0, 1.0],
                ]
            },
        }
    ] if include_camera else []
    report_path = root / "report.json"
    robot_urdf_path = root / "robot.urdf"
    robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")
    report_path.write_text(
        json.dumps(
            {
                "simulator": {"id": simulator_id, "label": simulator_id, "runtime": {}},
                "package_id": "demo",
                "version": "1.0.0",
                "requested_frame_map": "identity",
                "frame_map": "identity",
                "frame_convention": "ros-rep-103",
                "object_count": 1,
                "primitive_count": 1,
                "camera_count": len(camera_entries),
                "joint_position_count": len(joint_positions or {}),
                "joint_positions": joint_positions or {},
                "robot_urdf_path": str(robot_urdf_path),
                "asset_roots": [str(root)],
                "warnings": [],
                "objects": [
                    {
                        "source_id": "crate",
                        "source_name": "Crate",
                        "sim_name": "wl_crate",
                        "source_type": "cube",
                        "sim_type": "box",
                        "position_xyz": [object_x, 0.0, 0.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.1, 0.2, 0.3],
                        "rgba": [1.0, 0.0, 0.0, 1.0],
                        "collision": True,
                        "fixed": True,
                        "mass_kg": 1.0,
                        "friction": None,
                        "restitution": None,
                        "semantic_role": "prop",
                        "asset_ref": None,
                        "asset_scale_xyz": None,
                    }
                ],
                "cameras": camera_entries,
                "artifacts": {"camera_screenshot_dir": str(camera_dir)},
            }
        ),
        encoding="utf-8",
    )
    return report_path
