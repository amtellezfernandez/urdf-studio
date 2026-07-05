from __future__ import annotations

import sys
from pathlib import Path

from backend.services.simulator_adapters.params import (
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
    WORKSPACE_LAUNCH_FRAME_MAP,
)
from backend.services.simulator_adapters.workspace_process import (
    build_workspace_process_command,
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
