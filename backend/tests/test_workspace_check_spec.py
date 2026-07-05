from __future__ import annotations

from pathlib import Path

from backend.services.ilu_urdf import BundleMeshAssetsResult
from backend.services.simulator_adapters.params import PYBULLET_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.workspace_check_spec import (
    _prepare_direct_urdf_command,
)
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


def test_prepare_direct_urdf_command_propagates_expectations_and_report_path(
    tmp_path: Path,
) -> None:
    prepared = PreparedSimulatorWorkspace(
        workspace_dir=tmp_path / "workspace",
        world_package_path=tmp_path / "workspace" / "world-package.json",
        robot_urdf_path=tmp_path / "workspace" / "robot" / "robot.urdf",
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content="<robot name='demo'/>",
            out_path=str(tmp_path / "workspace" / "robot" / "robot.urdf"),
            assets_root=str(tmp_path / "workspace" / "robot" / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
    )
    report_path = prepared.workspace_dir / "artifacts" / "report.json"
    expectations = WorkspaceExpectations(
        duration_sec=0.5,
        frame_map="auto",
        resolved_frame_map="urdf_studio/v1",
        object_count=2,
        camera_count=3,
        object_positions_xyz={"crate": (1.0, 2.0, 3.0)},
        object_sizes_xyz={"crate": (0.1, 0.2, 0.3)},
        object_asset_refs={"crate": "assets/crate.obj"},
        object_contracts={},
        joint_positions={"joint_a": 0.5},
        camera_ids=("cam-1",),
        camera_contracts={},
    )

    command = _prepare_direct_urdf_command(
        prepared,
        simulator_id="pybullet",
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        object_marker="world_objects=2",
        expectations=expectations,
        expected_report_path=report_path,
    )

    assert command.expected_object_marker == "world_objects=2"
    assert command.expected_camera_log_marker == "cameras=3"
    assert command.expected_report_path == report_path
    assert command.expected_requested_frame_map == "auto"
    assert command.expected_frame_map == "urdf_studio/v1"
    assert command.expected_object_positions_xyz == {"crate": (1.0, 2.0, 3.0)}
    assert command.expected_object_sizes_xyz == {"crate": (0.1, 0.2, 0.3)}
    assert command.expected_object_asset_refs == {"crate": "assets/crate.obj"}
    assert command.expected_joint_positions == {"joint_a": 0.5}
    assert command.expected_camera_ids == ("cam-1",)
