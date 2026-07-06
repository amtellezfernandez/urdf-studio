from __future__ import annotations

import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from backend.models.simulator_runtime import SimulatorWorkspacePrepareRequest
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec, build_sim_camera_specs
from backend.services.simulator_adapters.workspace_report_validation import (
    ExpectedCameraReport,
    ExpectedObjectReport,
)
from backend.services.world_layout_static_transfer import (
    build_sim_primitives,
    count_transferable_world_objects,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    SimPrimitive,
    StaticWorldLayout,
    WorldLayoutFrameMap,
)
from backend.services.world_scene_package_compat import world_scene_registry_envelope_json_payload


@dataclass(frozen=True)
class ExpectedObjectContracts:
    positions_xyz: Mapping[str, tuple[float, float, float]]
    sizes_xyz: Mapping[str, tuple[float, float, float]]
    asset_refs: Mapping[str, str | None]
    contracts: Mapping[str, ExpectedObjectReport]


@dataclass(frozen=True)
class WorkspaceExpectations:
    object_count: int
    camera_count: int
    duration_sec: float
    frame_map: WorldLayoutFrameMap = "auto"
    resolved_frame_map: ConcreteWorldLayoutFrameMap | None = None
    object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_asset_refs: Mapping[str, str | None] | None = None
    object_contracts: Mapping[str, ExpectedObjectReport] | None = None
    joint_positions: Mapping[str, float] | None = None
    camera_ids: tuple[str, ...] | None = None
    camera_contracts: Mapping[str, ExpectedCameraReport] | None = None


def build_workspace_expectations(
    request: SimulatorWorkspacePrepareRequest,
    *,
    duration_sec: float,
    frame_map: WorldLayoutFrameMap,
) -> WorkspaceExpectations:
    workspace_layout = workspace_layout_from_request(request)
    object_contracts = _expected_object_contracts(
        workspace_layout,
        frame_map=frame_map,
    )
    return _workspace_expectations(
        request,
        workspace_layout=workspace_layout,
        duration_sec=duration_sec,
        frame_map=frame_map,
        object_contracts=object_contracts,
    )


def _workspace_expectations(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_layout: StaticWorldLayout,
    duration_sec: float,
    frame_map: WorldLayoutFrameMap,
    object_contracts: ExpectedObjectContracts,
) -> WorkspaceExpectations:
    return WorkspaceExpectations(
        object_count=_active_object_count(workspace_layout),
        camera_count=len(request.world_package.world_snapshot.cameras),
        duration_sec=duration_sec,
        frame_map=frame_map,
        resolved_frame_map=_resolved_frame_map(workspace_layout, frame_map),
        object_positions_xyz=object_contracts.positions_xyz,
        object_sizes_xyz=object_contracts.sizes_xyz,
        object_asset_refs=object_contracts.asset_refs,
        object_contracts=object_contracts.contracts,
        joint_positions=_expected_joint_positions(request),
        camera_ids=expected_camera_ids_for_request(request),
        camera_contracts=expected_camera_contracts_for_request(request),
    )


def active_object_count(request: SimulatorWorkspacePrepareRequest) -> int:
    return _active_object_count(workspace_layout_from_request(request))


def _active_object_count(layout: StaticWorldLayout) -> int:
    return count_transferable_world_objects(layout, include_hidden=False)


def workspace_layout_from_request(request: SimulatorWorkspacePrepareRequest) -> StaticWorldLayout:
    return parse_static_world_layout_payload(
        world_scene_registry_envelope_json_payload(request.world_package)
    )


def resolved_frame_map_for_request(
    request: SimulatorWorkspacePrepareRequest,
    frame_map: WorldLayoutFrameMap,
) -> ConcreteWorldLayoutFrameMap:
    return _resolved_frame_map(workspace_layout_from_request(request), frame_map)


def _resolved_frame_map(
    layout: StaticWorldLayout,
    frame_map: WorldLayoutFrameMap,
) -> ConcreteWorldLayoutFrameMap:
    return resolve_world_layout_frame_map(layout, frame_map)


def expected_object_contracts_for_request(
    request: SimulatorWorkspacePrepareRequest,
    frame_map: WorldLayoutFrameMap,
) -> ExpectedObjectContracts:
    return _expected_object_contracts(
        workspace_layout_from_request(request),
        frame_map=frame_map,
    )


def _expected_object_contracts(
    layout: StaticWorldLayout,
    *,
    frame_map: WorldLayoutFrameMap,
) -> ExpectedObjectContracts:
    primitives, _warnings = build_sim_primitives(
        layout,
        frame_map=frame_map,
        include_hidden=False,
    )
    return ExpectedObjectContracts(
        positions_xyz={primitive.source_id: primitive.position_xyz for primitive in primitives},
        sizes_xyz={primitive.source_id: primitive.size_xyz for primitive in primitives},
        asset_refs={primitive.source_id: primitive.asset_ref for primitive in primitives},
        contracts={primitive.source_id: _expected_object_report(primitive) for primitive in primitives},
    )


def _expected_joint_positions(
    request: SimulatorWorkspacePrepareRequest,
) -> dict[str, float]:
    return {
        str(name): float(position)
        for name, position in request.world_package.world_snapshot.joint_positions.items()
    }


def expected_camera_ids_for_request(request: SimulatorWorkspacePrepareRequest) -> tuple[str, ...]:
    if not request.world_package.world_snapshot.cameras:
        return ()
    return tuple(camera.camera_id for camera in _build_expected_camera_specs(request))


def expected_camera_contracts_for_request(
    request: SimulatorWorkspacePrepareRequest,
) -> dict[str, ExpectedCameraReport]:
    if not request.world_package.world_snapshot.cameras:
        return {}
    camera_specs = _build_expected_camera_specs(request)
    return {camera.camera_id: _expected_camera_report(camera) for camera in camera_specs}


def _build_expected_camera_specs(
    request: SimulatorWorkspacePrepareRequest,
) -> tuple[SimCameraSpec, ...]:
    with tempfile.TemporaryDirectory(prefix="urdf-studio-camera-contract-") as directory:
        robot_urdf_path = Path(directory) / "robot.urdf"
        _write_temporary_robot_urdf(
            robot_urdf_path,
            request.world_package.world_snapshot.urdf_xml,
        )
        camera_specs, _warnings = build_sim_camera_specs(
            request.world_package,
            robot_urdf_path=robot_urdf_path,
        )
    return tuple(camera_specs)


def _write_temporary_robot_urdf(robot_urdf_path: Path, urdf_xml: str) -> None:
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")


def _expected_object_report(primitive: SimPrimitive) -> ExpectedObjectReport:
    return ExpectedObjectReport(
        source_id=primitive.source_id,
        source_name=primitive.source_name,
        sim_name=primitive.sim_name,
        source_type=primitive.source_type,
        sim_type=primitive.sim_type,
        position_xyz=primitive.position_xyz,
        quat_wxyz=primitive.quat_wxyz,
        size_xyz=primitive.size_xyz,
        rgba=primitive.rgba,
        collision=primitive.collision,
        fixed=primitive.fixed,
        mass_kg=primitive.mass_kg,
        friction=primitive.friction,
        restitution=primitive.restitution,
        semantic_role=primitive.semantic_role,
        asset_ref=primitive.asset_ref,
        asset_scale_xyz=primitive.asset_scale_xyz,
    )


def _expected_camera_report(camera: SimCameraSpec) -> ExpectedCameraReport:
    return ExpectedCameraReport(
        camera_id=camera.camera_id,
        sim_name=camera.sim_name,
        parent_joint=camera.parent_joint,
        parent_link=camera.parent_link,
        position_xyz=camera.position_xyz,
        quat_wxyz=camera.quat_wxyz,
        width=camera.width,
        height=camera.height,
        fov_deg=camera.fov_deg,
        intrinsics_matrix=camera.intrinsics.matrix if camera.intrinsics is not None else (),
    )
