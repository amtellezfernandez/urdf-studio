from __future__ import annotations

from backend.models.simulator_runtime import (
    SIMULATOR_ISAACSIM_ID,
    SIMULATOR_MJX_ID,
    SIMULATOR_NEWTON_ID,
    SIMULATOR_ROBOSPLATTER_ID,
    SIMULATOR_SAPIEN2_ID,
    SIMULATOR_SAPIEN3_ID,
    SimulatorDependencySpec,
)
from backend.services.simulator_adapters.plugin import SimulatorPlugin


class MjxPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_MJX_ID
    label = "MJX"
    robot_asset_format = "mjx_mjcf"
    transfer_strategy = "planned"
    dependencies = (
        SimulatorDependencySpec(name="mujoco", import_name="mujoco"),
        SimulatorDependencySpec(name="jax", import_name="jax"),
    )


class Sapien2Plugin(SimulatorPlugin):
    simulator_id = SIMULATOR_SAPIEN2_ID
    label = "SAPIEN 2"
    robot_asset_format = "urdf"
    transfer_strategy = "planned"
    dependencies = (SimulatorDependencySpec(name="sapien", import_name="sapien"),)


class Sapien3Plugin(SimulatorPlugin):
    simulator_id = SIMULATOR_SAPIEN3_ID
    label = "SAPIEN 3"
    robot_asset_format = "urdf"
    transfer_strategy = "planned"
    dependencies = (SimulatorDependencySpec(name="sapien", import_name="sapien"),)


class IsaacSimPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_ISAACSIM_ID
    label = "Isaac Sim"
    robot_asset_format = "usd"
    transfer_strategy = "planned"
    dependencies = (SimulatorDependencySpec(name="isaacsim", import_name="isaacsim"),)


class NewtonPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_NEWTON_ID
    label = "Newton"
    robot_asset_format = "mjcf"
    transfer_strategy = "planned"
    dependencies = (SimulatorDependencySpec(name="newton", import_name="newton"),)


class RoboSplatterPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_ROBOSPLATTER_ID
    label = "RoboSplatter"
    robot_asset_format = "native"
    transfer_strategy = "planned"
    target_kind = "renderer"
    dependencies = (SimulatorDependencySpec(name="robosplatter", import_name="robosplatter"),)
