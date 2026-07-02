from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_MJLAB_ID,
    SimulatorDependencySpec,
)
from backend.services.simulator_adapters.params import (
    MJLAB_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_SCENE_PARAMS,
)
from backend.services.simulator_adapters.plugin import MjcfSimulatorPlugin


class MjlabPlugin(MjcfSimulatorPlugin):
    simulator_id = SIMULATOR_MJLAB_ID
    label = "MJLab"
    robot_asset_format = "mjcf"
    transfer_strategy = "convert"
    workspace_target = True
    motion_validation = True
    dependencies = (
        SimulatorDependencySpec(name="mujoco", import_name="mujoco", scope="workspace"),
        SimulatorDependencySpec(
            name="mjlab",
            import_name="mjlab",
            required=False,
            scope="validation",
        ),
        SimulatorDependencySpec(
            name="mujoco_warp",
            import_name="mujoco_warp",
            required=False,
            scope="validation",
        ),
    )
    workspace_process = MJLAB_WORKSPACE_PROCESS_PARAMS
    scene_params = MUJOCO_SCENE_PARAMS
