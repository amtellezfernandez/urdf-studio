from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from backend.core.paths import BASE_DIR

GENESIS_SIMULATOR_ID = "genesis"
MJLAB_SIMULATOR_ID = "mjlab"
MUJOCO_SIMULATOR_ID = "mujoco"
PYBULLET_SIMULATOR_ID = "pybullet"


@dataclass(frozen=True)
class SimulatorLaunchParams:
    launch_root: Path
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
class GenesisViewerFitParams:
    default_center_xyz: tuple[float, float, float]
    default_radius_m: float
    min_radius_m: float
    camera_radius_scale_xyz: tuple[float, float, float]
    min_camera_z_m: float
    fov_deg: float
    step_hz: float
    headless_min_steps: int


@dataclass(frozen=True)
class GenesisSceneParams:
    floor: SimulatorFloorParams
    robot_base_z_offset_m: float
    sim_dt_sec: float
    gravity_xyz: tuple[float, float, float]
    arm_controller: GenesisControllerGroupParams
    gripper_controller: GenesisControllerGroupParams
    viewer: GenesisViewerFitParams
    enable_collision: bool = True
    enable_self_collision: bool = False
    enable_adjacent_collision: bool = False
    box_box_detection: bool = True
    merge_fixed_links: bool = False
    prioritize_urdf_material: bool = True
    fixed_base: bool = True
    visualization: bool = True


@dataclass(frozen=True)
class MujocoSceneParams:
    viewer_step_hz: float


@dataclass(frozen=True)
class MujocoLaunchRepairParams:
    min_inertial_mass: float
    min_inertia_diagonal: float
    inertia_shift_attempts: int


@dataclass(frozen=True)
class PyBulletSceneParams:
    viewer_step_hz: float
    gravity_xyz: tuple[float, float, float]
    robot_base_position_xyz: tuple[float, float, float]
    robot_base_orientation_xyzw: tuple[float, float, float, float]


SimulatorSceneParams: TypeAlias = GenesisSceneParams | MujocoSceneParams | PyBulletSceneParams


GENESIS_LAUNCH_PARAMS = SimulatorLaunchParams(
    launch_root=BASE_DIR / ".cache" / "simulator-launch" / "genesis",
    module_name="backend.scripts.genesis_world_open",
    log_name="genesis.log",
    ready_log_marker="[genesis-world-open] scene built; stepping Genesis runtime.",
    ready_timeout_sec=120.0,
    post_ready_grace_sec=2.0,
)
MUJOCO_LAUNCH_PARAMS = SimulatorLaunchParams(
    launch_root=BASE_DIR / ".cache" / "simulator-launch",
    module_name="backend.scripts.mujoco_world_open",
    log_name="mujoco.log",
    ready_log_marker="[mujoco-world-open] model loaded; launching MuJoCo viewer.",
)
PYBULLET_LAUNCH_PARAMS = SimulatorLaunchParams(
    launch_root=BASE_DIR / ".cache" / "simulator-launch" / "pybullet",
    module_name="backend.scripts.pybullet_world_open",
    log_name="pybullet.log",
    ready_log_marker="[pybullet-world-open] world loaded; running PyBullet viewer.",
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
    viewer=GenesisViewerFitParams(
        default_center_xyz=(0.0, 0.0, 0.4),
        default_radius_m=1.0,
        min_radius_m=0.75,
        camera_radius_scale_xyz=(2.6, -2.4, 1.7),
        min_camera_z_m=0.8,
        fov_deg=45.0,
        step_hz=60.0,
        headless_min_steps=5,
    ),
)
MUJOCO_SCENE_PARAMS = MujocoSceneParams(
    viewer_step_hz=60.0,
)
MUJOCO_LAUNCH_REPAIR_PARAMS = MujocoLaunchRepairParams(
    min_inertial_mass=1e-9,
    min_inertia_diagonal=1e-12,
    inertia_shift_attempts=12,
)
PYBULLET_SCENE_PARAMS = PyBulletSceneParams(
    viewer_step_hz=60.0,
    gravity_xyz=(0.0, 0.0, -9.81),
    robot_base_position_xyz=(0.0, 0.0, 0.0),
    robot_base_orientation_xyzw=(0.0, 0.0, 0.0, 1.0),
)

SIMULATOR_LAUNCH_PARAMS_BY_ID: dict[str, SimulatorLaunchParams] = {
    GENESIS_SIMULATOR_ID: GENESIS_LAUNCH_PARAMS,
    MJLAB_SIMULATOR_ID: MUJOCO_LAUNCH_PARAMS,
    MUJOCO_SIMULATOR_ID: MUJOCO_LAUNCH_PARAMS,
    PYBULLET_SIMULATOR_ID: PYBULLET_LAUNCH_PARAMS,
}
SIMULATOR_SCENE_PARAMS_BY_ID: dict[str, SimulatorSceneParams] = {
    GENESIS_SIMULATOR_ID: GENESIS_SCENE_PARAMS,
    MJLAB_SIMULATOR_ID: MUJOCO_SCENE_PARAMS,
    MUJOCO_SIMULATOR_ID: MUJOCO_SCENE_PARAMS,
    PYBULLET_SIMULATOR_ID: PYBULLET_SCENE_PARAMS,
}
