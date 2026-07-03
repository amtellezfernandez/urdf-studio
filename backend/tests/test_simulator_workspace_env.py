from __future__ import annotations

import os
import sys
from pathlib import Path

from backend.services.simulator_adapters import simulator_acceleration


def test_genesis_workspace_env_uses_cuda_when_available(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setattr(
        simulator_acceleration,
        "_cuda_driver_library_dirs",
        lambda: (Path("/usr/lib/wsl/lib"),),
    )
    monkeypatch.setenv(simulator_acceleration.SIMULATOR_GPU_DEVICE_ENV, "2")

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="genesis",
    )

    assert env["URDF_STUDIO_GENESIS_BACKEND"] == "gpu"
    assert "URDF_STUDIO_GENESIS_PERFORMANCE_MODE" not in env
    assert env["CUDA_VISIBLE_DEVICES"] == "2"
    assert env["QD_VISIBLE_DEVICE"] == "2"
    assert env["EGL_DEVICE_ID"] == "2"
    assert env["LD_LIBRARY_PATH"].split(os.pathsep)[0] == "/usr/lib/wsl/lib"


def test_genesis_workspace_env_keeps_backend_auto_without_cuda(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: False)
    monkeypatch.delenv("URDF_STUDIO_GENESIS_BACKEND", raising=False)

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="genesis",
    )

    assert "URDF_STUDIO_GENESIS_PERFORMANCE_MODE" not in env
    assert "URDF_STUDIO_GENESIS_BACKEND" not in env
    assert "CUDA_VISIBLE_DEVICES" not in env


def test_mujoco_headless_env_uses_egl_on_nvidia_cuda(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(simulator_acceleration, "_has_display_environment", lambda: False)
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setattr(simulator_acceleration, "_cuda_driver_library_dirs", lambda: ())

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="mujoco",
    )

    assert env["MUJOCO_GL"] == "egl"
    assert env["PYOPENGL_PLATFORM"] == "egl"
    assert env["EGL_DEVICE_ID"] == "0"


def test_mujoco_headless_env_uses_osmesa_without_cuda(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(simulator_acceleration, "_has_display_environment", lambda: False)
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: False)

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="mujoco",
    )

    assert env["MUJOCO_GL"] == "osmesa"
    assert "PYOPENGL_PLATFORM" not in env


def _enable_fake_wsl_d3d12_path(monkeypatch, tmp_path: Path) -> Path:
    dxg_path = tmp_path / "dxg"
    driver_path = tmp_path / "dri" / "d3d12_dri.so"
    library_dir = tmp_path / "wsl-lib"
    dxg_path.touch()
    driver_path.parent.mkdir(parents=True)
    driver_path.touch()
    library_dir.mkdir()

    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    monkeypatch.setattr(simulator_acceleration, "WSL_DXG_DEVICE_PATH", dxg_path)
    monkeypatch.setattr(simulator_acceleration, "WSL_D3D12_DRI_DRIVER_PATH", driver_path)
    monkeypatch.setattr(simulator_acceleration, "WSL_D3D12_LIBRARY_DIR", library_dir)
    return library_dir


def test_pybullet_wsl_workspace_env_uses_d3d12_opengl_when_available(
    monkeypatch,
    tmp_path: Path,
) -> None:
    library_dir = _enable_fake_wsl_d3d12_path(monkeypatch, tmp_path)
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setattr(simulator_acceleration, "_cuda_driver_library_dirs", lambda: ())

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="pybullet",
    )

    assert env["GALLIUM_DRIVER"] == "d3d12"
    assert env["MESA_D3D12_DEFAULT_ADAPTER_NAME"] == "NVIDIA"
    assert env["LD_LIBRARY_PATH"].split(os.pathsep)[0] == str(library_dir)


def test_pybullet_wsl_d3d12_env_respects_user_graphics_overrides(
    monkeypatch,
    tmp_path: Path,
) -> None:
    _enable_fake_wsl_d3d12_path(monkeypatch, tmp_path)
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setattr(simulator_acceleration, "_cuda_driver_library_dirs", lambda: ())
    monkeypatch.setenv("GALLIUM_DRIVER", "zink")
    monkeypatch.setenv("MESA_D3D12_DEFAULT_ADAPTER_NAME", "AMD")

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="pybullet",
    )

    assert env["GALLIUM_DRIVER"] == "zink"
    assert env["MESA_D3D12_DEFAULT_ADAPTER_NAME"] == "AMD"


def test_workspace_env_preserves_explicit_user_acceleration(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "cpu")
    monkeypatch.setenv("URDF_STUDIO_GENESIS_PERFORMANCE_MODE", "0")
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "1")

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="genesis",
    )

    assert env["URDF_STUDIO_GENESIS_BACKEND"] == "cpu"
    assert env["URDF_STUDIO_GENESIS_PERFORMANCE_MODE"] == "0"
    assert env["CUDA_VISIBLE_DEVICES"] == "1"


def test_workspace_env_can_disable_acceleration(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setenv(simulator_acceleration.SIMULATOR_ACCELERATION_DISABLE_ENV, "1")

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="genesis",
    )

    assert "URDF_STUDIO_GENESIS_BACKEND" not in env
    assert "URDF_STUDIO_GENESIS_PERFORMANCE_MODE" not in env
    assert "CUDA_VISIBLE_DEVICES" not in env


def test_workspace_env_acceleration_disable_suppresses_pybullet_wsl_d3d12(
    monkeypatch,
    tmp_path: Path,
) -> None:
    _enable_fake_wsl_d3d12_path(monkeypatch, tmp_path)
    monkeypatch.setattr(simulator_acceleration, "_has_nvidia_cuda_runtime", lambda: True)
    monkeypatch.setenv(simulator_acceleration.SIMULATOR_ACCELERATION_DISABLE_ENV, "1")

    env = simulator_acceleration.build_simulator_workspace_env(
        tmp_path / "runtime-cache",
        simulator_id="pybullet",
    )

    assert "GALLIUM_DRIVER" not in env
    assert "MESA_D3D12_DEFAULT_ADAPTER_NAME" not in env
