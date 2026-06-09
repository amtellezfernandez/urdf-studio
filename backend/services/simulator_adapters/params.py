from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from backend.core.paths import BASE_DIR


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
