from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_COPPELIASIM_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_ISAAC_LAB_ID,
    SIMULATOR_ISAAC_SIM_ID,
    SIMULATOR_MJX_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_SAPIEN_ID,
    SimulatorId,
)
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap


WORKSPACE_LAUNCH_FRAME_MAP: WorldLayoutFrameMap = "auto"


@dataclass(frozen=True)
class SimulatorWorkspaceProcessParams:
    workspace_root: Path
    module_name: str
    log_name: str
    ready_log_marker: str
    log_tail_chars: int = 4000
    startup_poll_sec: float = 1.0
    ready_timeout_sec: float = 60.0
    post_ready_grace_sec: float = 1.0


@dataclass(frozen=True)
class SimulatorFloorParams:
    size_xy_m: tuple[float, float]
    thickness_m: float
    rgba: tuple[float, float, float, float]


@dataclass(frozen=True)
class GenesisControllerGroupParams:
    kp: float
    kv: float
    force_limit: float


@dataclass(frozen=True)
class GenesisControllerPolicyParams:
    name: str
    gripper_name_terms: tuple[str, ...]


@dataclass(frozen=True)
class GenesisViewerFitParams:
    default_center_xyz: tuple[float, float, float]
    default_radius_m: float
    min_radius_m: float
    robot_bounds_half_extent_m: float
    camera_radius_scale_xyz: tuple[float, float, float]
    min_camera_z_m: float
    fov_deg: float
    step_hz: float
    headless_min_steps: int


@dataclass(frozen=True)
class GenesisCameraSensorParams:
    near_m: float
    far_m: float
    gui_max_width_px: int
    gui_max_height_px: int


@dataclass(frozen=True)
class GenesisVisualParams:
    show_camera_helpers: bool
    ambient_light_rgb: tuple[float, float, float]
    background_rgb: tuple[float, float, float]


@dataclass(frozen=True)
class GenesisSceneParams:
    floor: SimulatorFloorParams
    robot_base_z_offset_m: float
    sim_dt_sec: float
    gravity_xyz: tuple[float, float, float]
    arm_controller: GenesisControllerGroupParams
    gripper_controller: GenesisControllerGroupParams
    controller_policy: GenesisControllerPolicyParams
    viewer: GenesisViewerFitParams
    camera_sensor: GenesisCameraSensorParams
    visual: GenesisVisualParams
    enable_collision: bool = True
    enable_self_collision: bool = False
    enable_adjacent_collision: bool = False
    box_box_detection: bool = True
    merge_fixed_links: bool = True
    prioritize_urdf_material: bool = True
    fixed_base: bool = True
    visualization: bool = True


@dataclass(frozen=True)
class MujocoSceneParams:
    viewer_step_hz: float


@dataclass(frozen=True)
class MujocoWorkspaceRepairParams:
    min_inertial_mass: float
    min_inertia_diagonal: float
    inertia_shift_attempts: int


@dataclass(frozen=True)
class PyBulletSceneParams:
    viewer_step_hz: float
    gravity_xyz: tuple[float, float, float]
    robot_base_position_xyz: tuple[float, float, float]
    robot_base_orientation_xyzw: tuple[float, float, float, float]
    camera_near_m: float
    camera_far_m: float


@dataclass(frozen=True)
class SapienSceneParams:
    viewer_step_hz: float
    sim_dt_sec: float
    floor_size_xy_m: tuple[float, float]
    floor_thickness_m: float
    fixed_base: bool = True


@dataclass(frozen=True)
class BlenderSceneParams:
    workspace_mode: str


SimulatorSceneParams: TypeAlias = (
    GenesisSceneParams | MujocoSceneParams | PyBulletSceneParams | SapienSceneParams | BlenderSceneParams
)


GENESIS_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "genesis",
    module_name="backend.scripts.genesis_workspace_prepare",
    log_name="genesis.log",
    ready_log_marker="[genesis-workspace] workspace ready.",
    ready_timeout_sec=120.0,
    post_ready_grace_sec=0.5,
)
MUJOCO_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces",
    module_name="backend.scripts.mujoco_workspace_prepare",
    log_name="mujoco.log",
    ready_log_marker="[mujoco-workspace] workspace ready.",
)
MJX_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces",
    module_name="backend.scripts.mjx_workspace_prepare",
    log_name="mjx.log",
    ready_log_marker="[mjx-workspace] workspace ready.",
)
ISAAC_SIM_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "isaac-sim",
    module_name="backend.scripts.isaac_workspace_prepare",
    log_name="isaac-sim.log",
    ready_log_marker="[isaac-workspace] workspace ready.",
    ready_timeout_sec=240.0,
)
ISAAC_LAB_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "isaac-lab",
    module_name="backend.scripts.isaac_workspace_prepare",
    log_name="isaac-lab.log",
    ready_log_marker="[isaac-workspace] workspace ready.",
    ready_timeout_sec=240.0,
)
PYBULLET_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "pybullet",
    module_name="backend.scripts.pybullet_workspace_prepare",
    log_name="pybullet.log",
    ready_log_marker="[pybullet-workspace] workspace ready.",
)
SAPIEN_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "sapien",
    module_name="backend.scripts.sapien_workspace_prepare",
    log_name="sapien.log",
    ready_log_marker="[sapien-workspace] workspace ready.",
)
COPPELIASIM_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "coppeliasim",
    module_name="backend.scripts.coppeliasim_workspace_prepare",
    log_name="coppeliasim.log",
    ready_log_marker="[coppeliasim-workspace] workspace ready.",
    ready_timeout_sec=120.0,
)
BLENDER_WORKSPACE_PROCESS_PARAMS = SimulatorWorkspaceProcessParams(
    workspace_root=BASE_DIR / ".cache" / "simulator-workspaces" / "blender",
    module_name="backend.scripts.blender_workspace_prepare",
    log_name="blender.log",
    ready_log_marker="[blender-workspace] workspace ready.",
    ready_timeout_sec=120.0,
)

GENESIS_SCENE_PARAMS = GenesisSceneParams(
    floor=SimulatorFloorParams(
        size_xy_m=(4.0, 4.0),
        thickness_m=0.08,
        rgba=(0.16, 0.16, 0.16, 0.35),
    ),
    robot_base_z_offset_m=0.004,
    sim_dt_sec=0.01,
    gravity_xyz=(0.0, 0.0, -9.81),
    arm_controller=GenesisControllerGroupParams(
        kp=600.0,
        kv=35.0,
        force_limit=220.0,
    ),
    gripper_controller=GenesisControllerGroupParams(
        kp=700.0,
        kv=42.0,
        force_limit=260.0,
    ),
    controller_policy=GenesisControllerPolicyParams(
        name="joint-name-terms-v1",
        gripper_name_terms=("gripper", "finger", "slide"),
    ),
    viewer=GenesisViewerFitParams(
        default_center_xyz=(0.0, 0.0, 0.4),
        default_radius_m=1.0,
        min_radius_m=0.75,
        robot_bounds_half_extent_m=0.45,
        camera_radius_scale_xyz=(2.6, -2.4, 1.7),
        min_camera_z_m=0.8,
        fov_deg=45.0,
        step_hz=60.0,
        headless_min_steps=5,
    ),
    camera_sensor=GenesisCameraSensorParams(
        near_m=0.01,
        far_m=25.0,
        gui_max_width_px=640,
        gui_max_height_px=480,
    ),
    visual=GenesisVisualParams(
        show_camera_helpers=False,
        ambient_light_rgb=(0.22, 0.22, 0.22),
        background_rgb=(0.06, 0.07, 0.08),
    ),
)
MUJOCO_SCENE_PARAMS = MujocoSceneParams(
    viewer_step_hz=60.0,
)
MUJOCO_WORKSPACE_REPAIR_PARAMS = MujocoWorkspaceRepairParams(
    min_inertial_mass=1e-9,
    min_inertia_diagonal=1e-12,
    inertia_shift_attempts=12,
)
PYBULLET_SCENE_PARAMS = PyBulletSceneParams(
    viewer_step_hz=60.0,
    gravity_xyz=(0.0, 0.0, -9.81),
    robot_base_position_xyz=(0.0, 0.0, 0.0),
    robot_base_orientation_xyzw=(0.0, 0.0, 0.0, 1.0),
    camera_near_m=0.01,
    camera_far_m=25.0,
)
SAPIEN_SCENE_PARAMS = SapienSceneParams(
    viewer_step_hz=60.0,
    sim_dt_sec=0.01,
    floor_size_xy_m=(4.0, 4.0),
    floor_thickness_m=0.04,
)
BLENDER_SCENE_PARAMS = BlenderSceneParams(
    workspace_mode="visual-layout-round-trip-v1",
)

SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID: dict[SimulatorId, SimulatorWorkspaceProcessParams] = {
    SIMULATOR_GENESIS_ID: GENESIS_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_MUJOCO_ID: MUJOCO_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_MJX_ID: MJX_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_ISAAC_SIM_ID: ISAAC_SIM_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_ISAAC_LAB_ID: ISAAC_LAB_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_PYBULLET_ID: PYBULLET_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_SAPIEN_ID: SAPIEN_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_COPPELIASIM_ID: COPPELIASIM_WORKSPACE_PROCESS_PARAMS,
    SIMULATOR_BLENDER_ID: BLENDER_WORKSPACE_PROCESS_PARAMS,
}
SIMULATOR_SCENE_PARAMS_BY_ID: dict[SimulatorId, SimulatorSceneParams] = {
    SIMULATOR_GENESIS_ID: GENESIS_SCENE_PARAMS,
    SIMULATOR_MUJOCO_ID: MUJOCO_SCENE_PARAMS,
    SIMULATOR_MJX_ID: MUJOCO_SCENE_PARAMS,
    SIMULATOR_ISAAC_SIM_ID: BLENDER_SCENE_PARAMS,
    SIMULATOR_ISAAC_LAB_ID: BLENDER_SCENE_PARAMS,
    SIMULATOR_PYBULLET_ID: PYBULLET_SCENE_PARAMS,
    SIMULATOR_SAPIEN_ID: SAPIEN_SCENE_PARAMS,
    SIMULATOR_COPPELIASIM_ID: SAPIEN_SCENE_PARAMS,
    SIMULATOR_BLENDER_ID: BLENDER_SCENE_PARAMS,
}
