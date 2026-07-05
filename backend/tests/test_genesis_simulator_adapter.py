from __future__ import annotations

import base64
import os
import shutil
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import SimulatorMeshAssetUpload, SimulatorWorkspacePrepareRequest
from backend.tests.simulator_adapter_test_utils import make_world_package
from backend.services.ilu_urdf import BundleMeshAssetsResult, BundledMeshAsset
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec, Transform
from backend.services.simulator_adapters import genesis as genesis_adapter
from backend.services.simulator_adapters.params import GENESIS_SCENE_PARAMS
from backend.services.simulator_adapters.plugin import get_plugin
from backend.services.simulator_adapters.genesis_camera import (
    add_scene_camera,
    attach_scene_camera_to_robot_link,
    camera_viewer_pose,
    observation_camera_sensor_kwargs,
    rgb_to_image_array,
    write_camera_screenshots,
    write_viewer_screenshot,
)
from backend.services.simulator_adapters.camera_artifacts import validate_visible_rgb_image
from backend.services.simulator_adapters.genesis_robot import (
    apply_joint_values,
    attachment_links_from_urdf,
    configure_robot_position_controller,
    joint_dof_indices_by_name,
    links_to_keep_for_camera_attachment,
    links_to_keep_for_workspace_attachments,
    robot_urdf_morph_kwargs,
)
from backend.services.simulator_adapters.genesis_scene import (
    add_mesh_entity_if_available,
    add_primitive_entity,
)
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.simulator_adapters import workspace_package
from backend.services.simulator_adapters.urdf_material_policy import (
    materialize_urdf_visual_material_colors,
)
from backend.services.world_layout_transfer_types import WorldLayoutTransferError
from backend.services.world_layout_static_transfer import SimPrimitive
from backend.scripts import genesis_workspace_prepare
from backend.scripts.genesis_workspace_prepare import (
    _genesis_performance_mode,
    _resolve_genesis_backend,
    genesis_overview_viewer_pose,
    should_add_genesis_scene_cameras,
    should_step_genesis_workspace,
)


def test_genesis_plugin_prepare_workspace_uses_adapter_prepare_helper(
    monkeypatch,
    tmp_path: Path,
) -> None:
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")
    prepared = PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content=robot_urdf_path.read_text(encoding="utf-8"),
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
    )
    expected_response = object()

    monkeypatch.setattr(genesis_adapter, "prepare_genesis_workspace", lambda _request: prepared)
    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_process.start_prepared_workspace_process",
        lambda **_kwargs: expected_response,
    )

    response = get_plugin("genesis").prepare_workspace(
        SimulatorWorkspacePrepareRequest(
            world_package=make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
        )
    )

    assert response is expected_response


def _genesis_camera_spec(
    *,
    parent_link: str = "wrist_link",
    render_local_pose: Transform | None = None,
    render_world_pose: Transform | None = None,
) -> SimCameraSpec:
    return SimCameraSpec(
        camera_id="cam-1",
        name="Wrist camera",
        sim_name="wrist_camera",
        parent_joint="wrist_joint",
        parent_link=parent_link,
        render_local_pose=render_local_pose
        or Transform(
            position_xyz=(0.0, 0.0, 0.0),
            rotation=Rotation.identity(),
        ),
        render_world_pose=render_world_pose
        or Transform(
            position_xyz=(1.0, 2.0, 3.0),
            rotation=Rotation.identity(),
        ),
        fov_deg=65.0,
        width=640,
        height=480,
    )


def test_genesis_robot_morph_prefers_staged_urdf_materials(tmp_path: Path) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")

    kwargs = robot_urdf_morph_kwargs(robot_urdf_path)

    assert kwargs["file"] == str(robot_urdf_path.resolve())
    assert kwargs["prioritize_urdf_material"] is True
    assert kwargs["merge_fixed_links"] is True
    assert kwargs["links_to_keep"] == ()


def test_genesis_robot_morph_keeps_camera_attachment_links(tmp_path: Path) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")

    kwargs = robot_urdf_morph_kwargs(
        robot_urdf_path,
        links_to_keep=("wrist_camera_link", "base_link"),
    )

    assert kwargs["merge_fixed_links"] is True
    assert kwargs["links_to_keep"] == ("wrist_camera_link", "base_link")


def test_genesis_camera_attachment_links_are_unique_and_stable() -> None:
    pose = Transform(
        position_xyz=(0.0, 0.0, 0.0),
        rotation=Rotation.identity(),
    )
    cameras = (
        SimCameraSpec(
            camera_id="cam-1",
            name="Wrist",
            sim_name="wrist",
            parent_joint="wrist_joint",
            parent_link="wrist_link",
            render_local_pose=pose,
            render_world_pose=pose,
            fov_deg=70.0,
            width=640,
            height=480,
        ),
        SimCameraSpec(
            camera_id="cam-2",
            name="Base",
            sim_name="base",
            parent_joint="base_joint",
            parent_link="base_link",
            render_local_pose=pose,
            render_world_pose=pose,
            fov_deg=70.0,
            width=640,
            height=480,
        ),
        SimCameraSpec(
            camera_id="cam-3",
            name="Wrist duplicate",
            sim_name="wrist_duplicate",
            parent_joint="wrist_joint",
            parent_link="wrist_link",
            render_local_pose=pose,
            render_world_pose=pose,
            fov_deg=70.0,
            width=640,
            height=480,
        ),
    )

    assert links_to_keep_for_camera_attachment(cameras) == ("base_link", "wrist_link")


def test_genesis_joint_dof_indices_ignore_boolean_values() -> None:
    class _TensorLikeDofs:
        def detach(self) -> _TensorLikeDofs:
            return self

        def cpu(self) -> _TensorLikeDofs:
            return self

        def numpy(self) -> np.ndarray:
            return np.array([[3]])

    robot_entity = SimpleNamespace(
        joints=[
            SimpleNamespace(name="valid", dofs_idx_local=[[2]]),
            SimpleNamespace(name="tensor", dofs_idx_local=_TensorLikeDofs()),
            SimpleNamespace(name="boolean", dofs_idx_local=True),
        ]
    )

    assert joint_dof_indices_by_name(robot_entity) == {"valid": 2, "tensor": 3}


def test_genesis_joint_dof_indices_reject_non_integral_values() -> None:
    robot_entity = SimpleNamespace(
        joints=[
            SimpleNamespace(name="valid", dofs_idx_local=[[2]]),
            SimpleNamespace(name="fractional", dofs_idx_local=[2.5]),
        ]
    )

    assert joint_dof_indices_by_name(robot_entity) == {"valid": 2}


def test_genesis_apply_joint_values_uses_known_finite_joints_only() -> None:
    class _FakeRobotEntity:
        def __init__(self) -> None:
            self.set_position_calls: list[tuple[list[float], list[int], bool]] = []
            self.control_position_calls: list[tuple[list[float], list[int]]] = []

        def set_dofs_position(
            self,
            positions: list[float],
            *,
            dofs_idx_local: list[int],
            zero_velocity: bool,
        ) -> None:
            self.set_position_calls.append((positions, dofs_idx_local, zero_velocity))

        def control_dofs_position(
            self,
            positions: list[float],
            *,
            dofs_idx_local: list[int],
        ) -> None:
            self.control_position_calls.append((positions, dofs_idx_local))

    robot_entity = _FakeRobotEntity()

    applied_count = apply_joint_values(
        robot_entity,
        {"shoulder": 1, "elbow": 2},
        {
            "shoulder": 0.25,
            "elbow": float("nan"),
            "missing": 0.75,
        },
    )

    assert applied_count == 1
    assert robot_entity.set_position_calls == [([0.25], [1], True)]
    assert robot_entity.control_position_calls == [([0.25], [1])]


def test_genesis_configures_robot_controller_with_keyword_dof_indices() -> None:
    class _FakeRobotEntity:
        def __init__(self) -> None:
            self.kp_calls: list[tuple[list[float], list[int]]] = []
            self.kv_calls: list[tuple[list[float], list[int]]] = []
            self.force_calls: list[tuple[list[float], list[float], list[int]]] = []

        def set_dofs_kp(self, values: list[float], *, dofs_idx_local: list[int]) -> None:
            self.kp_calls.append((values, dofs_idx_local))

        def set_dofs_kv(self, values: list[float], *, dofs_idx_local: list[int]) -> None:
            self.kv_calls.append((values, dofs_idx_local))

        def set_dofs_force_range(
            self,
            lower: list[float],
            upper: list[float],
            *,
            dofs_idx_local: list[int],
        ) -> None:
            self.force_calls.append((lower, upper, dofs_idx_local))

    robot_entity = _FakeRobotEntity()

    controlled = configure_robot_position_controller(
        robot_entity,
        {"arm_joint": 1, "left_gripper_joint": 3},
    )

    assert controlled == 2
    assert robot_entity.kp_calls == [(
        [
            GENESIS_SCENE_PARAMS.arm_controller.kp,
            GENESIS_SCENE_PARAMS.gripper_controller.kp,
        ],
        [1, 3],
    )]
    assert robot_entity.kv_calls == [(
        [
            GENESIS_SCENE_PARAMS.arm_controller.kv,
            GENESIS_SCENE_PARAMS.gripper_controller.kv,
        ],
        [1, 3],
    )]
    assert robot_entity.force_calls == [(
        [
            -GENESIS_SCENE_PARAMS.arm_controller.force_limit,
            -GENESIS_SCENE_PARAMS.gripper_controller.force_limit,
        ],
        [
            GENESIS_SCENE_PARAMS.arm_controller.force_limit,
            GENESIS_SCENE_PARAMS.gripper_controller.force_limit,
        ],
        [1, 3],
    )]


def test_genesis_configures_robot_controller_with_positional_dof_indices_fallback() -> None:
    class _FakeRobotEntity:
        def __init__(self) -> None:
            self.kp_calls: list[tuple[list[float], list[int]]] = []
            self.kv_calls: list[tuple[list[float], list[int]]] = []
            self.force_calls: list[tuple[list[float], list[float], list[int]]] = []

        def set_dofs_kp(self, values: list[float], dofs_idx_local: list[int]) -> None:
            self.kp_calls.append((values, dofs_idx_local))

        def set_dofs_kv(self, values: list[float], dofs_idx_local: list[int]) -> None:
            self.kv_calls.append((values, dofs_idx_local))

        def set_dofs_force_range(
            self,
            lower: list[float],
            upper: list[float],
            dofs_idx_local: list[int],
        ) -> None:
            self.force_calls.append((lower, upper, dofs_idx_local))

    robot_entity = _FakeRobotEntity()

    controlled = configure_robot_position_controller(
        robot_entity,
        {"arm_joint": 1},
    )

    assert controlled == 1
    assert robot_entity.kp_calls == [([GENESIS_SCENE_PARAMS.arm_controller.kp], [1])]
    assert robot_entity.kv_calls == [([GENESIS_SCENE_PARAMS.arm_controller.kv], [1])]
    assert robot_entity.force_calls == [(
        [-GENESIS_SCENE_PARAMS.arm_controller.force_limit],
        [GENESIS_SCENE_PARAMS.arm_controller.force_limit],
        [1],
    )]


def test_genesis_attachment_links_include_terminal_tool_links(tmp_path: Path) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    robot_urdf_path.write_text(
        """
<robot name="demo">
  <link name="base_link"/>
  <link name="wrist_link"/>
  <link name="gripper_frame_link"/>
  <joint name="wrist_joint" type="revolute">
    <parent link="base_link"/>
    <child link="wrist_link"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
  <joint name="gripper_frame_joint" type="fixed">
    <parent link="wrist_link"/>
    <child link="gripper_frame_link"/>
  </joint>
</robot>
""".strip(),
        encoding="utf-8",
    )

    assert attachment_links_from_urdf(robot_urdf_path) == ("gripper_frame_link",)
    assert links_to_keep_for_workspace_attachments((), robot_urdf_path=robot_urdf_path) == (
        "gripper_frame_link",
    )


def test_genesis_rgb_tensor_conversion_accepts_batched_float_image() -> None:
    class _TensorLikeImage:
        def detach(self) -> _TensorLikeImage:
            return self

        def cpu(self) -> _TensorLikeImage:
            return self

        def numpy(self) -> np.ndarray:
            return np.array(
                [[[[0.0, 0.5, 1.0], [1.0, 0.0, 0.25]]]],
                dtype=np.float32,
            )

    image = np.array(
        [[[[0.0, 0.5, 1.0], [1.0, 0.0, 0.25]]]],
        dtype=np.float32,
    )

    converted = rgb_to_image_array(image)

    assert converted is not None
    assert converted.dtype == np.uint8
    assert converted.shape == (1, 2, 3)
    assert converted[0, 0].tolist() == [0, 127, 255]
    assert np.array_equal(rgb_to_image_array(_TensorLikeImage()), converted)


def test_genesis_rgb_tensor_conversion_rejects_invalid_array_input() -> None:
    class _InvalidImage:
        def __array__(self, dtype=None) -> np.ndarray:
            raise ValueError("bad image")

    assert rgb_to_image_array(_InvalidImage()) is None


def test_genesis_rgb_tensor_conversion_propagates_unexpected_array_errors() -> None:
    class _BrokenImage:
        def __array__(self, dtype=None) -> np.ndarray:
            raise RuntimeError("unexpected image failure")

    with pytest.raises(RuntimeError, match="unexpected image failure"):
        rgb_to_image_array(_BrokenImage())


def test_genesis_camera_screenshot_writer_normalizes_float_render_output(tmp_path: Path) -> None:
    class _FakeSceneCamera:
        def render(self, **_kwargs):
            return [np.array([[[0.0, 0.5, 1.0], [1.0, 0.0, 0.25]]], dtype=np.float32)]

    written = write_camera_screenshots(
        (_FakeSceneCamera(),),
        (_genesis_camera_spec(),),
        tmp_path,
    )

    image_path = tmp_path / "01_wrist_camera.png"
    assert written == 1
    assert validate_visible_rgb_image(image_path, expected_size=(2, 1)) is None


def test_genesis_viewer_screenshot_writer_normalizes_float_render_output(tmp_path: Path) -> None:
    screenshot_path = tmp_path / "viewer.png"

    write_viewer_screenshot(
        screenshot_path,
        np.array([[[0.0, 0.5, 1.0], [1.0, 0.0, 0.25]]], dtype=np.float32),
    )

    assert validate_visible_rgb_image(screenshot_path, expected_size=(2, 1)) is None


def test_genesis_backend_resolution_uses_cpu_by_default(monkeypatch) -> None:
    class _FakeGenesis:
        cpu = object()

    monkeypatch.delenv("URDF_STUDIO_GENESIS_BACKEND", raising=False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_hip_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_cuda_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_mps_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_quadrants_backend_supported", lambda _name: False)

    backend, label = _resolve_genesis_backend(_FakeGenesis)

    assert backend is _FakeGenesis.cpu
    assert label == "cpu"


def test_genesis_backend_resolution_uses_cuda_when_available(monkeypatch) -> None:
    class _FakeGenesis:
        cpu = object()
        cuda = object()

    monkeypatch.delenv("URDF_STUDIO_GENESIS_BACKEND", raising=False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_hip_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_cuda_available", lambda: True)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_mps_available", lambda: False)
    monkeypatch.setattr(
        genesis_workspace_prepare,
        "_quadrants_backend_supported",
        lambda name: name == "cuda",
    )

    backend, label = _resolve_genesis_backend(_FakeGenesis)

    assert backend is _FakeGenesis.cuda
    assert label == "cuda"


def test_genesis_backend_resolution_accepts_cpu_override(monkeypatch) -> None:
    class _FakeGenesis:
        cpu = object()

    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "cpu")

    backend, label = _resolve_genesis_backend(_FakeGenesis)

    assert backend is _FakeGenesis.cpu
    assert label == "cpu"


def test_genesis_backend_resolution_rejects_cuda_when_quadrants_cannot_use_it(
    monkeypatch,
) -> None:
    class _FakeGenesis:
        cpu = object()
        cuda = object()

    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "cuda")
    monkeypatch.setattr(genesis_workspace_prepare, "_quadrants_backend_supported", lambda _name: False)

    with pytest.raises(ValueError, match="Quadrants does not support"):
        _resolve_genesis_backend(_FakeGenesis)


def test_genesis_backend_resolution_rejects_auto_override(monkeypatch) -> None:
    class _FakeGenesis:
        cpu = object()

    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "auto")

    with pytest.raises(ValueError, match="not deterministic"):
        _resolve_genesis_backend(_FakeGenesis)


def test_genesis_backend_resolution_accepts_generic_gpu_override_when_available(
    monkeypatch,
) -> None:
    class _FakeGenesis:
        cpu = object()
        cuda = object()

    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "gpu")
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_hip_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_cuda_available", lambda: True)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_mps_available", lambda: False)
    monkeypatch.setattr(
        genesis_workspace_prepare,
        "_quadrants_backend_supported",
        lambda name: name == "cuda",
    )

    backend, label = _resolve_genesis_backend(_FakeGenesis)

    assert backend is _FakeGenesis.cuda
    assert label == "cuda"


def test_genesis_backend_resolution_rejects_generic_gpu_override_when_unavailable(
    monkeypatch,
) -> None:
    class _FakeGenesis:
        cpu = object()

    monkeypatch.setenv("URDF_STUDIO_GENESIS_BACKEND", "gpu")
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_hip_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_cuda_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_torch_mps_available", lambda: False)
    monkeypatch.setattr(genesis_workspace_prepare, "_quadrants_backend_supported", lambda _name: False)

    with pytest.raises(ValueError, match="no Genesis GPU backend is available"):
        _resolve_genesis_backend(_FakeGenesis)


def test_genesis_workspace_camera_uses_native_gui_camera_when_visible() -> None:
    class _FakeScene:
        def __init__(self) -> None:
            self.camera_kwargs: dict[str, object] | None = None

        def add_camera(self, **kwargs):
            self.camera_kwargs = kwargs
            return object()

    pose = Transform(
        position_xyz=(1.0, 2.0, 3.0),
        rotation=Rotation.identity(),
    )
    camera = SimCameraSpec(
        camera_id="cam-1",
        name="Wrist camera",
        sim_name="wrist_camera",
        parent_joint="wrist_joint",
        parent_link="wrist_link",
        render_local_pose=pose,
        render_world_pose=pose,
        fov_deg=65.0,
        width=640,
        height=480,
    )
    scene = _FakeScene()

    add_scene_camera(None, scene, camera, visible=True)

    assert scene.camera_kwargs == {
        "res": (640, 480),
        "pos": (1.0, 2.0, 3.0),
        "lookat": (1.0, 2.0, 2.0),
        "up": (0.0, 1.0, 0.0),
        "fov": 65.0,
        "GUI": True,
        "debug": True,
    }


def test_genesis_camera_viewer_pose_uses_camera_pov() -> None:
    pose = Transform(
        position_xyz=(1.0, 2.0, 3.0),
        rotation=Rotation.identity(),
    )
    camera = SimCameraSpec(
        camera_id="cam-1",
        name="Wrist camera",
        sim_name="wrist_camera",
        parent_joint="wrist_joint",
        parent_link="wrist_link",
        render_local_pose=pose,
        render_world_pose=pose,
        fov_deg=65.0,
        width=640,
        height=480,
    )

    position, lookat, up, fov = camera_viewer_pose(camera)

    assert position == (1.0, 2.0, 3.0)
    assert lookat == (1.0, 2.0, 2.0)
    assert up == (0.0, 1.0, 0.0)
    assert fov == 65.0


def test_genesis_overview_viewer_pose_fits_scene_instead_of_scene_camera_pov() -> None:
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="cube",
        sim_type="box",
        position_xyz=(1.0, -0.5, 0.2),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.4, 0.2, 0.6),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    camera_pos, camera_lookat, camera_up, camera_fov = genesis_overview_viewer_pose(
        (primitive,)
    )

    assert camera_lookat[0] > 0.0
    assert camera_lookat[2] > 0.0
    assert camera_pos[2] >= camera_lookat[2]
    assert camera_up == (0.0, 0.0, 1.0)
    assert camera_fov > 0.0


def test_genesis_interactive_open_is_static_unless_artifacts_or_duration_require_steps(
    tmp_path: Path,
) -> None:
    assert should_step_genesis_workspace(
        no_viewer=False,
        duration_sec=0.0,
        screenshot_path=None,
        camera_screenshot_dir=None,
        sensor_screenshot_dir=None,
        report_path=None,
    ) is False
    assert should_step_genesis_workspace(
        no_viewer=True,
        duration_sec=0.0,
        screenshot_path=None,
        camera_screenshot_dir=None,
        sensor_screenshot_dir=None,
        report_path=None,
    ) is True
    assert should_step_genesis_workspace(
        no_viewer=False,
        duration_sec=1.0,
        screenshot_path=None,
        camera_screenshot_dir=None,
        sensor_screenshot_dir=None,
        report_path=None,
    ) is True
    assert should_step_genesis_workspace(
        no_viewer=False,
        duration_sec=0.0,
        screenshot_path=tmp_path / "viewer.png",
        camera_screenshot_dir=None,
        sensor_screenshot_dir=None,
        report_path=None,
    ) is True


def test_genesis_scene_cameras_are_lazy_for_interactive_open(tmp_path: Path) -> None:
    assert should_add_genesis_scene_cameras(camera_screenshot_dir=None) is False
    assert should_add_genesis_scene_cameras(camera_screenshot_dir=tmp_path / "cameras") is True


def test_genesis_performance_mode_is_explicit_opt_in(monkeypatch) -> None:
    monkeypatch.delenv("URDF_STUDIO_GENESIS_PERFORMANCE_MODE", raising=False)
    assert _genesis_performance_mode() is False

    monkeypatch.setenv("URDF_STUDIO_GENESIS_PERFORMANCE_MODE", "1")
    assert _genesis_performance_mode() is True


def test_genesis_workspace_camera_attaches_to_native_robot_link() -> None:
    class _FakeLink:
        name = "wrist_link"

    class _FakeRobotEntity:
        links = [_FakeLink()]

    class _FakeSceneCamera:
        def __init__(self) -> None:
            self.attached_link = None
            self.offset_matrix = None

        def attach(self, link, offset_matrix) -> None:
            self.attached_link = link
            self.offset_matrix = offset_matrix

    local_pose = Transform(
        position_xyz=(0.1, 0.2, 0.3),
        rotation=Rotation.from_euler("xyz", (0.0, 0.0, 0.5)),
    )
    camera = SimCameraSpec(
        camera_id="cam-1",
        name="Wrist camera",
        sim_name="wrist_camera",
        parent_joint="wrist_joint",
        parent_link="wrist_link",
        render_local_pose=local_pose,
        render_world_pose=Transform(
            position_xyz=(1.0, 2.0, 3.0),
            rotation=Rotation.identity(),
        ),
        fov_deg=65.0,
        width=640,
        height=480,
    )
    scene_camera = _FakeSceneCamera()

    attached = attach_scene_camera_to_robot_link(scene_camera, _FakeRobotEntity(), camera)

    expected_offset = np.eye(4)
    expected_offset[:3, :3] = local_pose.rotation.as_matrix()
    expected_offset[:3, 3] = local_pose.position_xyz
    assert attached is True
    assert scene_camera.attached_link is _FakeRobotEntity.links[0]
    assert np.allclose(scene_camera.offset_matrix, expected_offset)


def test_genesis_workspace_camera_skips_non_callable_attach_attribute() -> None:
    class _FakeLink:
        name = "wrist_link"

    class _FakeRobotEntity:
        links = [_FakeLink()]

    class _FakeSceneCamera:
        attach = True

    attached = attach_scene_camera_to_robot_link(
        _FakeSceneCamera(),
        _FakeRobotEntity(),
        _genesis_camera_spec(),
    )

    assert attached is False


def test_genesis_observation_camera_sensor_uses_native_entity_and_link_indices() -> None:
    class _FakeLink:
        name = "wrist_link"
        idx_local = 4

    class _FakeRobotEntity:
        idx = 2
        links = [_FakeLink()]

    local_pose = Transform(
        position_xyz=(0.1, 0.2, 0.3),
        rotation=Rotation.from_euler("xyz", (0.0, 0.0, 0.5)),
    )
    camera = _genesis_camera_spec(render_local_pose=local_pose)

    kwargs = observation_camera_sensor_kwargs(_FakeRobotEntity(), camera)

    assert kwargs is not None
    assert kwargs["entity_idx"] == 2
    assert kwargs["link_idx_local"] == 4
    assert kwargs["res"] == (640, 480)
    assert kwargs["lookat"] == (1.0, 2.0, 2.0)
    assert np.allclose(kwargs["offset_T"][:3, 3], local_pose.position_xyz)


def test_genesis_observation_camera_sensor_rejects_boolean_indices() -> None:
    class _FakeLink:
        name = "wrist_link"
        idx_local = True

    class _FakeRobotEntity:
        idx = 2
        links = [_FakeLink()]

    kwargs = observation_camera_sensor_kwargs(_FakeRobotEntity(), _genesis_camera_spec())

    assert kwargs is None


def test_genesis_adds_mesh_object_when_asset_resolves(tmp_path: Path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")

    class _FakeMesh:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class _FakeSurface:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class _FakeGs:
        class morphs:
            Mesh = _FakeMesh

        class surfaces:
            Default = _FakeSurface

    class _FakeScene:
        def __init__(self) -> None:
            self.entity_kwargs = None

        def add_entity(self, **kwargs) -> None:
            self.entity_kwargs = kwargs

    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/crate.obj",
        asset_scale_xyz=(1.0, 1.2, 1.4),
    )
    scene = _FakeScene()

    added = add_mesh_entity_if_available(_FakeGs, scene, primitive, (tmp_path,))

    assert added is True
    assert scene.entity_kwargs["name"] == "wl_crate"
    assert scene.entity_kwargs["morph"].kwargs["file"] == str(mesh_path)
    assert scene.entity_kwargs["morph"].kwargs["scale"] == (1.0, 1.2, 1.4)


def test_genesis_rejects_unresolved_mesh_asset(tmp_path: Path) -> None:
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/missing.obj",
    )

    with pytest.raises(ValueError, match="Genesis mesh object 'crate' asset_ref does not resolve"):
        add_mesh_entity_if_available(object(), object(), primitive, (tmp_path,))


def test_genesis_mesh_add_preserves_unexpected_errors(tmp_path: Path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")

    class _BrokenGs:
        class morphs:
            @staticmethod
            def Mesh(**_kwargs):
                raise KeyError("unexpected mesh failure")

    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/crate.obj",
    )

    with pytest.raises(KeyError, match="unexpected mesh failure"):
        add_mesh_entity_if_available(_BrokenGs, object(), primitive, (tmp_path,))


def test_genesis_wraps_supported_primitive_add_failures() -> None:
    class _FakeBox:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class _FakeSurface:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class _FakeGs:
        class morphs:
            Box = _FakeBox

        class surfaces:
            Default = _FakeSurface

        class materials:
            @staticmethod
            def Rigid(**_kwargs):
                return None

    class _FailingScene:
        def add_entity(self, **_kwargs) -> None:
            raise RuntimeError("backend boom")

    primitive = SimPrimitive(
        source_id="box-1",
        source_name="Box",
        sim_name="wl_box",
        source_type="primitive",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    with pytest.raises(
        WorldLayoutTransferError,
        match="Genesis failed to add box object 'box-1': backend boom",
    ):
        add_primitive_entity(_FakeGs, _FailingScene(), primitive)


def test_genesis_primitive_add_preserves_unsupported_type_error() -> None:
    primitive = SimPrimitive(
        source_id="capsule-1",
        source_name="Capsule",
        sim_name="wl_capsule",
        source_type="primitive",
        sim_type="capsule",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    with pytest.raises(ValueError, match="Unsupported Genesis primitive type: capsule"):
        add_primitive_entity(object(), object(), primitive)


def test_genesis_primitive_add_preserves_unexpected_errors() -> None:
    class _BrokenGs:
        class morphs:
            @staticmethod
            def Box(**_kwargs):
                raise KeyError("unexpected primitive failure")

    primitive = SimPrimitive(
        source_id="box-1",
        source_name="Box",
        sim_name="wl_box",
        source_type="primitive",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.1),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    with pytest.raises(KeyError, match="unexpected primitive failure"):
        add_primitive_entity(_BrokenGs, object(), primitive)


def test_prepare_genesis_workspace_adds_synthetic_visual_material_colors(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = """
<robot name="demo">
  <link name="left_wheel">
    <visual>
      <geometry>
        <mesh filename="meshes/left_wheel.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
    )
    monkeypatch.setattr(
        genesis_adapter,
        "GENESIS_WORKSPACE_PROCESS_PARAMS",
        replace(genesis_adapter.GENESIS_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_xml: str,
        out_path: str,
        **_kwargs,
    ) -> BundleMeshAssetsResult:
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = genesis_adapter.prepare_genesis_workspace(request)
    root = ET.parse(prepared.robot_urdf_path).getroot()
    wheel_color = root.find("./link[@name='left_wheel']/visual/material/color")

    assert wheel_color is not None
    assert wheel_color.get("rgba") == "0.04 0.045 0.05 1.0"


@pytest.mark.skipif(
    os.getenv("URDF_STUDIO_RUN_GENESIS_TESTS") != "1",
    reason="Set URDF_STUDIO_RUN_GENESIS_TESTS=1 to run Genesis headless scene build.",
)
def test_genesis_renders_prepared_lekiwi_visual_material_colors(tmp_path: Path) -> None:
    pytest.importorskip("genesis")
    import genesis as gs

    demo_dir = BASE_DIR / "web" / "public" / "demo"
    robot_urdf_path = tmp_path / "lekiwi.urdf"
    mesh_dir = tmp_path / "meshes"
    robot_urdf_path.write_text((demo_dir / "lekiwi.urdf").read_text(encoding="utf-8"), encoding="utf-8")
    shutil.copytree(demo_dir / "meshes", mesh_dir)
    materialize_urdf_visual_material_colors(robot_urdf_path)

    try:
        gs.init(backend=gs.cpu, logging_level="warning")
    except Exception as exc:
        if "already" not in str(exc).lower() and "initialized" not in str(exc).lower():
            raise

    scene = gs.Scene(show_viewer=False)
    entity = scene.add_entity(
        gs.morphs.URDF(**robot_urdf_morph_kwargs(robot_urdf_path)),
        name="lekiwi_probe",
    )
    scene.build()
    visual_colors = {
        tuple(round(float(channel), 3) for channel in color[:3])
        for vgeom in getattr(entity, "vgeoms", [])
        for surface in [getattr(vgeom, "surface", None)]
        for texture in [getattr(surface, "diffuse_texture", None)]
        for color in [getattr(texture, "color", None)]
        if color is not None
    }

    assert (0.04, 0.045, 0.05) in visual_colors
    assert (0.45, 0.48, 0.52) in visual_colors
    assert (0.66, 0.69, 0.64) in visual_colors


def test_prepare_genesis_simulator_workspace_bundles_uploaded_assets_and_package_roots(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = """
<robot name="demo">
  <link name="base">
    <visual>
      <geometry>
        <mesh filename="package://demo_description/meshes/base.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    mesh_content = b"solid mesh\nendsolid mesh\n"
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(
            urdf_xml,
            joint_positions={"joint_1": 0.25},
            objects=[
                {
                    "id": "box-1",
                    "name": "box-1",
                    "type": "cube",
                    "position_xyz": [0.0, 0.1, 0.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#22c55e",
                }
            ],
        ),
        urdf_asset_path="demo_description/robot.urdf",
        mesh_assets=[
            SimulatorMeshAssetUpload(
                path="meshes/base.stl",
                aliases=["demo_description/meshes/base.stl"],
                content_base64=base64.b64encode(mesh_content).decode("ascii"),
                mime="model/stl",
            )
        ],
        package_roots={"demo_description": ["demo_description"]},
    )

    monkeypatch.setattr(
        genesis_adapter,
        "GENESIS_WORKSPACE_PROCESS_PARAMS",
        replace(genesis_adapter.GENESIS_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        assert Path(urdf_path).name == "robot.urdf"
        assert extra_search_roots is not None
        assert any(Path(root).name == "demo_description" for root in extra_search_roots)
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=1,
            bundled=(
                BundledMeshAsset(
                    original="package://demo_description/meshes/base.stl",
                    rewritten="assets/demo_description/meshes/base.stl",
                    source_path="/tmp/source/base.stl",
                    target_path="/tmp/out/base.stl",
                ),
            ),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = genesis_adapter.prepare_genesis_workspace(request)
    source_root = prepared.workspace_dir / "source"

    assert prepared.world_package_path.exists()
    assert prepared.robot_urdf_path.exists()
    assert (source_root / "demo_description" / "package.xml").exists()
    assert (source_root / "demo_description" / "meshes" / "base.stl").read_bytes() == mesh_content
    assert prepared.bundle_result.copied_files == 1


def test_prepare_genesis_simulator_workspace_rejects_failed_bundle(
    monkeypatch,
    tmp_path: Path,
) -> None:
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
    )
    monkeypatch.setattr(
        genesis_adapter,
        "GENESIS_WORKSPACE_PROCESS_PARAMS",
        replace(genesis_adapter.GENESIS_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(**_kwargs) -> BundleMeshAssetsResult:
        return BundleMeshAssetsResult(
            success=False,
            content="",
            out_path="",
            assets_root="",
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    with pytest.raises(
        genesis_adapter.GenesisWorkspaceError,
        match="could not bundle robot mesh assets",
    ):
        genesis_adapter.prepare_genesis_workspace(request)


def test_genesis_plugin_build_check_command_uses_expected_artifact_paths(
    monkeypatch,
    tmp_path: Path,
) -> None:
    prepared = PreparedSimulatorWorkspace(
        workspace_dir=tmp_path / "workspace",
        world_package_path=tmp_path / "workspace" / "world-package.json",
        robot_urdf_path=tmp_path / "workspace" / "robot" / "robot.urdf",
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content="<robot name='demo'/>",
            out_path=str(tmp_path / "workspace" / "robot" / "robot.urdf"),
            assets_root=str(tmp_path / "workspace" / "robot" / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
        world_object_count=2,
        camera_count=3,
    )
    prepared.world_package_path.parent.mkdir(parents=True, exist_ok=True)
    prepared.robot_urdf_path.parent.mkdir(parents=True, exist_ok=True)
    prepared.world_package_path.write_text("{}", encoding="utf-8")
    prepared.robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    monkeypatch.setattr(genesis_adapter, "prepare_genesis_workspace", lambda request: prepared)

    command = genesis_adapter.GenesisPlugin().build_check_command(
        SimulatorWorkspacePrepareRequest(
            world_package=make_world_package("<robot name='demo'><link name='base'/></robot>")
        ),
        WorkspaceExpectations(
            duration_sec=0.25,
            frame_map="auto",
            resolved_frame_map="urdf_studio/v1",
            object_count=2,
            camera_count=3,
            object_positions_xyz={},
            object_sizes_xyz={},
            object_asset_refs={},
            object_contracts={},
            joint_positions={},
            camera_ids=(),
            camera_contracts={},
        ),
    )

    assert "--screenshot" in command.command
    assert str(prepared.workspace_dir / "artifacts" / "viewer.png") in command.command
    assert str(prepared.workspace_dir / "artifacts" / "cameras") in command.command
    assert str(prepared.workspace_dir / "artifacts" / "sensors") in command.command
    assert command.expected_report_path == prepared.workspace_dir / "artifacts" / "report.json"


def test_genesis_extra_expected_markers_use_camera_count() -> None:
    assert genesis_adapter._genesis_extra_expected_markers(3) == (
        "camera_screenshots=3",
        "observation_cameras=3",
        "sensor_reads=3",
        "sensor_screenshots=3",
        "merge_fixed_links=True",
    )
