from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TypeAlias


SIMULATOR_ACCELERATION_DISABLE_ENV = "URDF_STUDIO_DISABLE_SIMULATOR_ACCELERATION"
SIMULATOR_GPU_DEVICE_ENV = "URDF_STUDIO_SIMULATOR_GPU_DEVICE"
GENESIS_BACKEND_ENV = "URDF_STUDIO_GENESIS_BACKEND"
WSL_D3D12_DRI_DRIVER_PATH = Path("/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so")
WSL_D3D12_LIBRARY_DIR = Path("/usr/lib/wsl/lib")
WSL_DXG_DEVICE_PATH = Path("/dev/dxg")

SimulatorEnvironment: TypeAlias = dict[str, str]


def _truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes"}


def _has_display_environment() -> bool:
    if sys.platform in {"win32", "darwin"}:
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _is_wsl_environment() -> bool:
    if os.environ.get("WSL_DISTRO_NAME") or os.environ.get("WSL_INTEROP"):
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8").lower()
    except OSError:
        return False


def _has_wsl_d3d12_opengl_path() -> bool:
    return (
        sys.platform == "linux"
        and _is_wsl_environment()
        and _has_display_environment()
        and WSL_DXG_DEVICE_PATH.exists()
        and WSL_D3D12_DRI_DRIVER_PATH.exists()
        and WSL_D3D12_LIBRARY_DIR.exists()
    )


def _command_succeeds(command: Sequence[str]) -> bool:
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _has_nvidia_gpu() -> bool:
    if _command_succeeds(("nvidia-smi", "-L")):
        return True
    wsl_nvidia_smi = Path("/usr/lib/wsl/lib/nvidia-smi")
    return wsl_nvidia_smi.exists() and _command_succeeds((str(wsl_nvidia_smi), "-L"))


def _cuda_driver_library_dirs() -> tuple[Path, ...]:
    candidates = (
        Path("/usr/lib/wsl/lib"),
        Path("/usr/lib/x86_64-linux-gnu"),
        Path("/usr/local/cuda/lib64"),
    )
    dirs: list[Path] = []
    for directory in candidates:
        if (directory / "libcuda.so").exists() or (directory / "libcuda.so.1").exists():
            dirs.append(directory)
    return tuple(dirs)


def _has_cuda_driver_library() -> bool:
    if _cuda_driver_library_dirs():
        return True
    try:
        result = subprocess.run(
            ("ldconfig", "-p"),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and "libcuda.so" in result.stdout


def _has_nvidia_cuda_runtime() -> bool:
    return _has_nvidia_gpu() and _has_cuda_driver_library()


def _prepend_env_path_entry(env: SimulatorEnvironment, key: str, value: str) -> None:
    current = env.get(key, "")
    entries = [entry for entry in current.split(os.pathsep) if entry]
    if value in entries:
        return
    env[key] = os.pathsep.join([value, *entries])


def _apply_nvidia_cuda_runtime_env(env: SimulatorEnvironment) -> None:
    for library_dir in reversed(_cuda_driver_library_dirs()):
        _prepend_env_path_entry(env, "LD_LIBRARY_PATH", str(library_dir))


def _selected_gpu_device() -> str:
    configured_device = os.environ.get(SIMULATOR_GPU_DEVICE_ENV, "").strip()
    return configured_device or "0"


def _nvidia_d3d12_adapter_hint() -> str:
    return "NVIDIA"


def _set_env_default(env: SimulatorEnvironment, key: str, value: str) -> None:
    if not env.get(key):
        env[key] = value


def apply_simulator_acceleration_env(
    env: SimulatorEnvironment,
    simulator_id: str | None,
) -> None:
    if not simulator_id or _truthy_env(env.get(SIMULATOR_ACCELERATION_DISABLE_ENV)):
        return

    normalized_id = simulator_id.strip().lower()
    has_nvidia_cuda = _has_nvidia_cuda_runtime()
    gpu_device = _selected_gpu_device()
    if has_nvidia_cuda:
        _apply_nvidia_cuda_runtime_env(env)

    if normalized_id == "genesis":
        if has_nvidia_cuda:
            _set_env_default(env, GENESIS_BACKEND_ENV, "gpu")
            _set_env_default(env, "CUDA_VISIBLE_DEVICES", gpu_device)
            _set_env_default(env, "QD_VISIBLE_DEVICE", gpu_device)
            _set_env_default(env, "EGL_DEVICE_ID", gpu_device)
        return

    if normalized_id in {"mujoco", "mjlab"}:
        if sys.platform == "linux" and not _has_display_environment():
            if has_nvidia_cuda:
                _set_env_default(env, "MUJOCO_GL", "egl")
                _set_env_default(env, "PYOPENGL_PLATFORM", "egl")
                _set_env_default(env, "EGL_DEVICE_ID", gpu_device)
            else:
                _set_env_default(env, "MUJOCO_GL", "osmesa")
        if normalized_id == "mjlab" and has_nvidia_cuda:
            _set_env_default(env, "CUDA_VISIBLE_DEVICES", gpu_device)
        return

    if normalized_id == "pybullet":
        if _has_wsl_d3d12_opengl_path():
            _prepend_env_path_entry(env, "LD_LIBRARY_PATH", str(WSL_D3D12_LIBRARY_DIR))
            _set_env_default(env, "GALLIUM_DRIVER", "d3d12")
            if has_nvidia_cuda:
                _set_env_default(
                    env,
                    "MESA_D3D12_DEFAULT_ADAPTER_NAME",
                    _nvidia_d3d12_adapter_hint(),
                )
        return

    if normalized_id == "mjx" and has_nvidia_cuda:
        _set_env_default(env, "CUDA_VISIBLE_DEVICES", gpu_device)


def build_simulator_workspace_env(
    cache_root: Path,
    simulator_id: str | None = None,
) -> SimulatorEnvironment:
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_dirs = {
        "XDG_CACHE_HOME": cache_root / "xdg",
        "MPLCONFIGDIR": cache_root / "matplotlib",
        "NUMBA_CACHE_DIR": cache_root / "numba",
        "TI_CACHE_HOME": cache_root / "taichi",
        "TAICHI_CACHE_HOME": cache_root / "taichi",
        "QUADRANTS_CACHE_DIR": cache_root / "quadrants",
        "QDCACHE_DIR": cache_root / "quadrants",
    }
    for path in cache_dirs.values():
        path.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({name: str(path) for name, path in cache_dirs.items()})
    apply_simulator_acceleration_env(env, simulator_id)
    return env
