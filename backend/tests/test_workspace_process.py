from __future__ import annotations

import sys
from pathlib import Path

import pytest

from backend.services.simulator_adapters import workspace_process
from backend.services.ilu_urdf import BundleMeshAssetsResult
from backend.services.simulator_adapters.params import (
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
    WORKSPACE_LAUNCH_FRAME_MAP,
)
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.simulator_adapters.workspace_process import (
    build_workspace_process_command,
    start_workspace_process_until_ready,
)
from backend.services.simulator_adapters.workspace_launches import cancel_workspace_launch


def _prepared_workspace(tmp_path: Path) -> PreparedSimulatorWorkspace:
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = workspace_dir / "robot.urdf"
    world_package_path.write_text("{}\n", encoding="utf-8")
    robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")
    return PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content="",
            out_path=str(robot_urdf_path),
            assets_root=str(workspace_dir / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
    )


def test_build_workspace_process_command_uses_expected_launch_shape(tmp_path: Path) -> None:
    world_package_path = tmp_path / "world-package.json"
    simulator_asset_path = tmp_path / "robot.urdf"

    command = build_workspace_process_command(
        workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
        world_package_path=world_package_path,
        simulator_asset_flag="--robot-urdf",
        simulator_asset_path=simulator_asset_path,
        extra_simulator_args=("--camera-screenshot-dir", str(tmp_path / "artifacts" / "cameras")),
    )

    assert command[:4] == [
        sys.executable,
        "-u",
        "-m",
        PYBULLET_WORKSPACE_PROCESS_PARAMS.module_name,
    ]
    assert command[command.index("--world-package") + 1] == str(world_package_path)
    assert command[command.index("--robot-urdf") + 1] == str(simulator_asset_path)
    assert command[command.index("--camera-screenshot-dir") + 1] == str(
        tmp_path / "artifacts" / "cameras"
    )
    assert command[command.index("--frame-map") + 1] == WORKSPACE_LAUNCH_FRAME_MAP


def test_start_workspace_process_until_ready_removes_workspace_for_pre_cancelled_launch(tmp_path: Path) -> None:
    prepared = _prepared_workspace(tmp_path)
    launch_id = "pre-cancelled-workspace-launch"
    cancel_workspace_launch(launch_id, target_id="pybullet")

    with pytest.raises(ValueError, match="PyBullet workspace launch was cancelled."):
        start_workspace_process_until_ready(
            command=[sys.executable, "-c", "print('unused')"],
            prepared=prepared,
            workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
            simulator_id="pybullet",
            simulator_label="PyBullet",
            log_path=prepared.workspace_dir / "pybullet.log",
            error=ValueError,
            launch_id=launch_id,
        )

    assert not prepared.workspace_dir.exists()


def test_start_workspace_process_until_ready_removes_workspace_when_attach_detects_cancellation(
    monkeypatch,
    tmp_path: Path,
) -> None:
    prepared = _prepared_workspace(tmp_path)
    launch_id = "attach-cancelled-workspace-launch"

    class _FakeProcess:
        def poll(self):
            return 0

    monkeypatch.setattr(
        workspace_process,
        "_spawn_workspace_process",
        lambda **_kwargs: _FakeProcess(),
    )
    monkeypatch.setattr(workspace_process, "attach_workspace_launch_process", lambda *_args: False)

    with pytest.raises(ValueError, match="PyBullet workspace launch was cancelled."):
        start_workspace_process_until_ready(
            command=[sys.executable, "-c", "print('unused')"],
            prepared=prepared,
            workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
            simulator_id="pybullet",
            simulator_label="PyBullet",
            log_path=prepared.workspace_dir / "pybullet.log",
            error=ValueError,
            launch_id=launch_id,
        )

    assert not prepared.workspace_dir.exists()


def test_start_workspace_process_until_ready_removes_workspace_when_readiness_wait_detects_cancellation(
    monkeypatch,
    tmp_path: Path,
) -> None:
    prepared = _prepared_workspace(tmp_path)
    launch_id = "wait-cancelled-workspace-launch"

    class _FakeProcess:
        def poll(self):
            return None

    monkeypatch.setattr(
        workspace_process,
        "_spawn_workspace_process",
        lambda **_kwargs: _FakeProcess(),
    )
    monkeypatch.setattr(
        workspace_process,
        "attach_workspace_launch_process",
        lambda *_args: True,
    )

    def _fake_wait_for_workspace_readiness(*_args, **_kwargs):
        cancel_workspace_launch(launch_id, target_id="pybullet")
        raise ValueError("PyBullet workspace launch was cancelled.")

    monkeypatch.setattr(
        workspace_process,
        "wait_for_workspace_readiness",
        _fake_wait_for_workspace_readiness,
    )
    monkeypatch.setattr(
        workspace_process,
        "terminate_workspace_process",
        lambda _process: True,
    )

    with pytest.raises(ValueError, match="PyBullet workspace launch was cancelled."):
        start_workspace_process_until_ready(
            command=[sys.executable, "-c", "print('unused')"],
            prepared=prepared,
            workspace_process=PYBULLET_WORKSPACE_PROCESS_PARAMS,
            simulator_id="pybullet",
            simulator_label="PyBullet",
            log_path=prepared.workspace_dir / "pybullet.log",
            error=ValueError,
            launch_id=launch_id,
        )

    assert not prepared.workspace_dir.exists()
