from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.tests.simulator_adapter_test_utils import make_workspace_prepare_request
from backend.services.simulator_adapters import mjx as mjx_adapter
from backend.services.simulator_adapters.plugin import get_plugin

pytest.importorskip("jax")
pytest.importorskip("mujoco")
pytest.importorskip("mujoco.mjx")

_PENDULUM_URDF = """<?xml version="1.0"?>
<robot name="pendulum">
  <link name="base_link">
    <inertial><mass value="1.0"/><origin xyz="0 0 0"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
  </link>
  <link name="arm_link">
    <inertial><mass value="0.5"/><origin xyz="0 0 -0.2"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="arm_link"/>
    <origin xyz="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="10" velocity="5"/>
  </joint>
</robot>
"""


def test_mjx_plugin_is_registered_with_convert_transfer_strategy() -> None:
    plugin = get_plugin("mjx")

    assert isinstance(plugin, mjx_adapter.MjxPlugin)
    assert plugin.robot_asset_format == "mjx_mjcf"
    assert plugin.transfer_strategy == "convert"
    assert plugin.workspace_target is True


def test_mjx_plugin_runtime_status_reports_dependencies() -> None:
    plugin = get_plugin("mjx")

    status = plugin.runtime_status()

    dependency_names = {dependency.name for dependency in status.dependencies}
    assert dependency_names == {"mujoco", "jax", "mujoco_mjx"}


def test_mjx_prepare_workspace_runs_inspection_rollout_and_writes_report(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(mjx_adapter, "_MJX_WORKSPACE_ROOT", tmp_path)
    plugin = mjx_adapter.MjxPlugin()
    request = make_workspace_prepare_request(_PENDULUM_URDF)

    response = plugin.prepare_workspace(request)

    assert response.simulator_id == "mjx"
    assert response.started is False
    assert response.launch_mode == "headless_check"
    assert response.simulator_asset_path is None
    assert response.simulator_asset_format is None
    report_paths = list(tmp_path.rglob("report.json"))
    assert len(report_paths) == 1
    report_text = report_paths[0].read_text(encoding="utf-8")
    assert '"diverged": false' in report_text


def test_build_mjx_workspace_report_uses_rollout_summary(tmp_path: Path) -> None:
    prepared = SimpleNamespace(
        mjcf_path=tmp_path / "robot.xml",
        shared_workspace=SimpleNamespace(
            world_package_path=tmp_path / "world-package.json",
            robot_urdf_path=tmp_path / "robot.urdf",
            world_object_count=2,
            camera_count=1,
        ),
    )
    episode = SimpleNamespace(
        diverged=False,
        wall_time_ms=12.5,
        trace=SimpleNamespace(frames=[object(), object(), object()]),
    )

    report = mjx_adapter._build_mjx_workspace_report(
        simulator_id="mjx",
        label="MJX",
        prepared=prepared,
        episode=episode,
    )

    assert report["simulator"] == {"id": "mjx", "label": "MJX"}
    assert report["robot_mjcf_path"] == str(tmp_path / "robot.xml")
    assert report["world_object_count"] == 2
    assert report["camera_count"] == 1
    assert report["rollout"] == {
        "steps": 20,
        "diverged": False,
        "wall_time_ms": 12.5,
        "frame_count": 3,
    }


def test_mjx_prepare_workspace_wraps_expected_rollout_errors(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(mjx_adapter, "_MJX_WORKSPACE_ROOT", tmp_path)
    plugin = mjx_adapter.MjxPlugin()
    request = make_workspace_prepare_request(_PENDULUM_URDF)

    prepared = SimpleNamespace(
        mjcf_path=tmp_path / "robot.xml",
        shared_workspace=SimpleNamespace(
            workspace_dir=tmp_path / "workspace",
            world_package_path=tmp_path / "workspace" / "world-package.json",
            robot_urdf_path=tmp_path / "workspace" / "robot.urdf",
            world_object_count=0,
            camera_count=0,
            bundle_result=SimpleNamespace(copied_files=0, unresolved=()),
        ),
    )

    monkeypatch.setattr(mjx_adapter, "prepare_mujoco_workspace", lambda *_args, **_kwargs: prepared)
    monkeypatch.setattr(
        "backend.services.mjx_rollout_runner.run_mjx_rollout_batch",
        lambda _config: (_ for _ in ()).throw(ValueError("bad rollout config")),
    )

    with pytest.raises(mjx_adapter.MjxWorkspaceError, match="MJX inspection rollout failed: bad rollout config"):
        plugin.prepare_workspace(request)


def test_mjx_prepare_workspace_propagates_unexpected_rollout_errors(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(mjx_adapter, "_MJX_WORKSPACE_ROOT", tmp_path)
    plugin = mjx_adapter.MjxPlugin()
    request = make_workspace_prepare_request(_PENDULUM_URDF)

    prepared = SimpleNamespace(
        mjcf_path=tmp_path / "robot.xml",
        shared_workspace=SimpleNamespace(
            workspace_dir=tmp_path / "workspace",
            world_package_path=tmp_path / "workspace" / "world-package.json",
            robot_urdf_path=tmp_path / "workspace" / "robot.urdf",
            world_object_count=0,
            camera_count=0,
            bundle_result=SimpleNamespace(copied_files=0, unresolved=()),
        ),
    )

    monkeypatch.setattr(mjx_adapter, "prepare_mujoco_workspace", lambda *_args, **_kwargs: prepared)
    monkeypatch.setattr(
        "backend.services.mjx_rollout_runner.run_mjx_rollout_batch",
        lambda _config: (_ for _ in ()).throw(KeyError("unexpected rollout failure")),
    )

    with pytest.raises(KeyError, match="unexpected rollout failure"):
        plugin.prepare_workspace(request)
