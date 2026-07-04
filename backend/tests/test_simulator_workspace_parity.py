from __future__ import annotations

import json
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_GENESIS_ID, SIMULATOR_MUJOCO_ID
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
    assert "missing parity report field(s): requested_frame_map" in result.detail


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
