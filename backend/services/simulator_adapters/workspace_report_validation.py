from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias, cast

from backend.models.json_payload import JsonObject, JsonValue
from backend.models.simulator_runtime import SimulatorId
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    WorldLayoutFrameMap,
)
from backend.services.world_layout_static_transfer import resolve_world_layout_asset_path

VALID_REPORT_FRAME_MAPS = frozenset(("identity", "studio-y-up-to-z-up"))
VALID_REPORT_REQUESTED_FRAME_MAPS = frozenset(("auto", *VALID_REPORT_FRAME_MAPS))
REQUIRED_REPORT_FIELDS = (
    "simulator",
    "package_id",
    "version",
    "requested_frame_map",
    "frame_map",
    "frame_convention",
    "object_count",
    "primitive_count",
    "camera_count",
    "joint_position_count",
    "joint_positions",
    "robot_urdf_path",
    "asset_roots",
    "warnings",
    "objects",
    "cameras",
    "artifacts",
)

SimulatorWorkspaceReportPayload: TypeAlias = JsonObject
SimulatorWorkspaceReportObject: TypeAlias = Mapping[str, JsonValue]


@dataclass(frozen=True)
class ExpectedObjectReport:
    source_id: str
    source_name: str
    sim_name: str
    source_type: str
    sim_type: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]
    rgba: tuple[float, float, float, float]
    collision: bool
    fixed: bool
    mass_kg: float | None
    friction: float | None
    restitution: float | None
    semantic_role: str | None
    asset_ref: str | None
    asset_scale_xyz: tuple[float, float, float] | None


@dataclass(frozen=True)
class ExpectedCameraReport:
    camera_id: str
    sim_name: str
    parent_joint: str
    parent_link: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    width: int
    height: int
    fov_deg: float
    intrinsics_matrix: tuple[tuple[float, float, float], ...]


@dataclass(frozen=True)
class SimulatorWorkspaceReportExpectations:
    simulator_id: SimulatorId | None = None
    object_count: int | None = None
    camera_count: int | None = None
    requested_frame_map: WorldLayoutFrameMap | None = None
    frame_map: ConcreteWorldLayoutFrameMap | None = None
    object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_asset_refs: Mapping[str, str | None] | None = None
    object_contracts: Mapping[str, ExpectedObjectReport] | None = None
    joint_positions: Mapping[str, float] | None = None
    camera_ids: tuple[str, ...] | None = None
    camera_contracts: Mapping[str, ExpectedCameraReport] | None = None
    required_artifact_file_keys: tuple[str, ...] = ()
    required_artifact_dir_keys: tuple[str, ...] = ()


def validate_simulator_workspace_report(
    report_path: Path,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    if not report_path.exists():
        return f"missing simulator validation report: {report_path}"
    try:
        raw_payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return f"invalid simulator validation report {report_path}: {exc}"
    if not isinstance(raw_payload, dict):
        return f"invalid simulator validation report {report_path}: expected JSON object"
    payload = cast(SimulatorWorkspaceReportPayload, raw_payload)

    missing_required_fields_error = _validate_required_fields_present(
        payload,
        required_fields=REQUIRED_REPORT_FIELDS,
        path_prefix="simulator validation report",
    )
    if missing_required_fields_error:
        return missing_required_fields_error

    simulator = payload.get("simulator")
    simulator_error = _validate_report_simulator(simulator, expectations)
    if simulator_error:
        return simulator_error

    header_error = _validate_report_header(payload)
    if header_error:
        return header_error

    joint_position_error = _validate_report_joint_positions(payload)
    if joint_position_error:
        return joint_position_error

    expected_joint_position_error = _validate_expected_joint_positions(payload, expectations)
    if expected_joint_position_error:
        return expected_joint_position_error

    expected_runtime_joint_error = _validate_expected_runtime_joint_application(
        payload,
        expectations,
    )
    if expected_runtime_joint_error:
        return expected_runtime_joint_error

    frame_contract_error = _validate_expected_frame_contract(payload, expectations)
    if frame_contract_error:
        return frame_contract_error

    artifact_error = _validate_report_artifacts(payload, expectations)
    if artifact_error:
        return artifact_error

    count_error = _validate_report_count(
        payload,
        field_name="primitive_count",
        list_field_name="objects",
        expected_count=expectations.object_count,
    )
    if count_error:
        return count_error
    count_error = _validate_report_count(
        payload,
        field_name="camera_count",
        list_field_name="cameras",
        expected_count=expectations.camera_count,
    )
    if count_error:
        return count_error
    item_error = _validate_report_item_fields(
        payload,
        list_field_name="objects",
        required_fields=(
            "source_id",
            "source_name",
            "sim_name",
            "source_type",
            "sim_type",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
            "collision",
            "fixed",
            "mass_kg",
            "friction",
            "restitution",
            "semantic_role",
            "asset_ref",
            "asset_scale_xyz",
        ),
    )
    if item_error:
        return item_error
    object_contract_error = _validate_expected_object_contracts(payload, expectations)
    if object_contract_error:
        return object_contract_error
    object_vector_error = _validate_expected_object_vectors(payload, expectations)
    if object_vector_error:
        return object_vector_error
    object_asset_ref_error = _validate_expected_object_asset_refs(payload, expectations)
    if object_asset_ref_error:
        return object_asset_ref_error
    asset_ref_error = _validate_report_object_asset_refs(payload)
    if asset_ref_error:
        return asset_ref_error
    camera_item_error = _validate_report_item_fields(
        payload,
        list_field_name="cameras",
        required_fields=(
            "camera_id",
            "name",
            "sim_name",
            "parent_joint",
            "parent_link",
            "position_xyz",
            "quat_wxyz",
            "width",
            "height",
            "fov_deg",
            "intrinsics",
        ),
    )
    if camera_item_error:
        return camera_item_error
    camera_id_error = _validate_expected_camera_ids(payload, expectations)
    if camera_id_error:
        return camera_id_error
    return _validate_expected_camera_contracts(payload, expectations)


def _validate_report_simulator(
    value: object,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    if not isinstance(value, Mapping):
        return "simulator validation report field 'simulator' must be an object"
    for field_name in ("id", "label"):
        error = _validate_report_string(value.get(field_name), f"simulator.{field_name}")
        if error:
            return error
    runtime = value.get("runtime")
    if not isinstance(runtime, Mapping):
        return "simulator validation report field 'simulator.runtime' must be an object"
    if expectations.simulator_id is not None and value.get("id") != expectations.simulator_id:
        return (
            "simulator validation report has wrong simulator id: "
            f"{value.get('id')!r}, expected {expectations.simulator_id!r}"
        )
    return None


def _validate_report_header(payload: SimulatorWorkspaceReportObject) -> str | None:
    for field_name in ("package_id", "version"):
        error = _validate_report_string(payload.get(field_name), field_name)
        if error:
            return error
    robot_urdf_path_error = _validate_report_existing_file_path(
        payload.get("robot_urdf_path"),
        "robot_urdf_path",
    )
    if robot_urdf_path_error:
        return robot_urdf_path_error
    frame_map_error = _validate_report_frame_map(
        payload.get("frame_map"),
        "frame_map",
        VALID_REPORT_FRAME_MAPS,
    )
    if frame_map_error:
        return frame_map_error
    requested_frame_map_error = _validate_report_frame_map(
        payload.get("requested_frame_map"),
        "requested_frame_map",
        VALID_REPORT_REQUESTED_FRAME_MAPS,
    )
    if requested_frame_map_error:
        return requested_frame_map_error
    frame_convention = payload.get("frame_convention")
    if frame_convention is not None:
        error = _validate_report_string(frame_convention, "frame_convention")
        if error:
            return error
    for field_name in ("object_count", "primitive_count", "camera_count", "joint_position_count"):
        error = _validate_report_non_negative_int(payload.get(field_name), field_name)
        if error:
            return error
    object_count = int(payload["object_count"])
    primitive_count = int(payload["primitive_count"])
    if object_count < primitive_count:
        return (
            "simulator validation report field 'object_count' must be greater than "
            "or equal to primitive_count"
        )
    error = _validate_report_asset_roots(payload.get("asset_roots"))
    if error:
        return error
    return _validate_report_string_list(payload.get("warnings"), "warnings", allow_empty=True)


def _validate_report_joint_positions(payload: SimulatorWorkspaceReportObject) -> str | None:
    joint_positions = payload.get("joint_positions")
    if not isinstance(joint_positions, Mapping):
        return "simulator validation report field 'joint_positions' must be an object"
    joint_position_count = payload.get("joint_position_count")
    if joint_position_count != len(joint_positions):
        return (
            "simulator validation report field 'joint_positions' has "
            f"{len(joint_positions)} item(s), expected {joint_position_count}"
        )
    for name, position in joint_positions.items():
        if not isinstance(name, str) or not name.strip():
            return "simulator validation report field 'joint_positions' has an invalid joint name"
        error = _validate_report_number(position, f"joint_positions[{name}]")
        if error:
            return error
    return None


def _validate_expected_joint_positions(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_joint_positions = expectations.joint_positions or {}
    if not expected_joint_positions:
        return None
    joint_positions = payload.get("joint_positions")
    if not isinstance(joint_positions, Mapping):
        return "simulator validation report field 'joint_positions' must be an object"
    for joint_name, expected_position in expected_joint_positions.items():
        if joint_name not in joint_positions:
            return f"simulator validation report missing joint position {joint_name!r}"
        error = _validate_expected_number(
            joint_positions.get(joint_name),
            expected_position,
            f"joint_positions[{joint_name}]",
        )
        if error:
            return error
    return None


def _validate_expected_runtime_joint_application(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_joint_positions = expectations.joint_positions or {}
    if not expected_joint_positions:
        return None
    simulator = payload.get("simulator")
    runtime = simulator.get("runtime") if isinstance(simulator, Mapping) else None
    if not isinstance(runtime, Mapping) or "applied_initial_joints" not in runtime:
        return None
    applied_count = runtime.get("applied_initial_joints")
    count_error = _validate_report_non_negative_int(
        applied_count,
        "simulator.runtime.applied_initial_joints",
    )
    if count_error:
        return count_error
    expected_count = len(expected_joint_positions)
    if applied_count != expected_count:
        return (
            "simulator validation report field 'simulator.runtime.applied_initial_joints' "
            f"is {applied_count!r}, expected {expected_count}"
        )
    return None


def _validate_report_frame_map(
    value: object,
    path: str,
    valid_values: frozenset[ConcreteWorldLayoutFrameMap | WorldLayoutFrameMap],
) -> str | None:
    error = _validate_report_string(value, path)
    if error:
        return error
    if value not in valid_values:
        return (
            f"simulator validation report field '{path}' must be one of: "
            f"{', '.join(sorted(valid_values))}"
        )
    return None


def _validate_expected_frame_contract(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    if (
        expectations.requested_frame_map is not None
        and payload.get("requested_frame_map") != expectations.requested_frame_map
    ):
        return (
            "simulator validation report has requested_frame_map="
            f"{payload.get('requested_frame_map')!r}, expected {expectations.requested_frame_map!r}"
        )
    if expectations.frame_map is not None and payload.get("frame_map") != expectations.frame_map:
        return (
            "simulator validation report has frame_map="
            f"{payload.get('frame_map')!r}, expected {expectations.frame_map!r}"
        )
    return None


def _validate_report_artifacts(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return "simulator validation report field 'artifacts' must be an object"
    for key in expectations.required_artifact_file_keys:
        error = _validate_report_artifact_path(artifacts, key, kind="file")
        if error:
            return error
    for key in expectations.required_artifact_dir_keys:
        error = _validate_report_artifact_path(artifacts, key, kind="directory")
        if error:
            return error
    return None


def _validate_report_artifact_path(
    artifacts: SimulatorWorkspaceReportObject,
    key: str,
    *,
    kind: str,
) -> str | None:
    value = artifacts.get(key)
    path_error = _validate_report_string(value, f"artifacts.{key}")
    if path_error:
        return path_error
    path = Path(value).expanduser()
    if not path.is_absolute():
        return f"simulator validation report artifact '{key}' is not an absolute path: {path}"
    if kind == "file":
        if not path.is_file():
            return f"simulator validation report artifact '{key}' is not a file: {path}"
        if path.stat().st_size <= 0:
            return f"simulator validation report artifact '{key}' is empty: {path}"
        return None
    if kind == "directory":
        if not path.is_dir():
            return f"simulator validation report artifact '{key}' is not a directory: {path}"
        return None
    return f"simulator validation report artifact '{key}' has unsupported kind: {kind}"


def _validate_report_existing_file_path(value: object, path: str) -> str | None:
    string_error = _validate_report_string(value, path)
    if string_error:
        return string_error
    file_path = Path(cast(str, value)).expanduser()
    if not file_path.is_absolute():
        return f"simulator validation report field '{path}' must be an absolute file path"
    if not file_path.is_file():
        return f"simulator validation report field '{path}' must be an existing file"
    if file_path.stat().st_size <= 0:
        return f"simulator validation report field '{path}' must be a non-empty file"
    return None


def _validate_report_count(
    payload: SimulatorWorkspaceReportObject,
    *,
    field_name: str,
    list_field_name: str,
    expected_count: int | None,
) -> str | None:
    count = payload.get(field_name)
    if expected_count is not None and count != expected_count:
        return (
            f"simulator validation report has {field_name}={count!r}, "
            f"expected {expected_count}"
        )
    items = payload.get(list_field_name)
    if not isinstance(items, list):
        return f"simulator validation report field '{list_field_name}' must be a list"
    if isinstance(count, int) and len(items) != count:
        return (
            f"simulator validation report field '{list_field_name}' has {len(items)} item(s), "
            f"expected {count}"
        )
    return None


def _validate_report_item_fields(
    payload: SimulatorWorkspaceReportObject,
    *,
    list_field_name: str,
    required_fields: tuple[str, ...],
) -> str | None:
    report_entries = payload.get(list_field_name)
    if not isinstance(report_entries, list):
        return f"simulator validation report field '{list_field_name}' must be a list"
    for index, report_entry in enumerate(report_entries):
        if not isinstance(report_entry, Mapping):
            return (
                f"simulator validation report field '{list_field_name}[{index}]' "
                "must be an object"
            )
        missing_fields_error = _validate_required_fields_present(
            cast(SimulatorWorkspaceReportObject, report_entry),
            required_fields=required_fields,
            path_prefix=f"simulator validation report field '{list_field_name}[{index}]'",
        )
        if missing_fields_error:
            return missing_fields_error
        value_error = _validate_report_item_values(
            report_entry,
            path=f"{list_field_name}[{index}]",
            list_field_name=list_field_name,
        )
        if value_error:
            return value_error
    if list_field_name == "objects":
        identity_fields = ("source_id", "sim_name")
    else:
        identity_fields = ("camera_id", "sim_name")
    identity_error = _validate_report_unique_item_values(
        report_entries,
        list_field_name=list_field_name,
        field_names=identity_fields,
    )
    if identity_error:
        return identity_error
    return None


def _validate_required_fields_present(
    payload: SimulatorWorkspaceReportObject,
    *,
    required_fields: tuple[str, ...],
    path_prefix: str,
) -> str | None:
    missing_fields = [field for field in required_fields if field not in payload]
    if not missing_fields:
        return None
    return f"{path_prefix} missing field(s): {', '.join(missing_fields)}"


def _index_report_entries_by_string_field(
    report_entries: list[JsonValue],
    field_name: str,
) -> dict[str, SimulatorWorkspaceReportObject]:
    indexed_entries: dict[str, SimulatorWorkspaceReportObject] = {}
    for report_entry in report_entries:
        if not isinstance(report_entry, Mapping):
            continue
        field_value = report_entry.get(field_name)
        if isinstance(field_value, str):
            indexed_entries[field_value] = cast(SimulatorWorkspaceReportObject, report_entry)
    return indexed_entries


def _report_entry_list(
    payload: SimulatorWorkspaceReportObject,
    *,
    list_field_name: str,
) -> tuple[list[JsonValue] | None, str | None]:
    report_entries = payload.get(list_field_name)
    if not isinstance(report_entries, list):
        return None, f"simulator validation report field '{list_field_name}' must be a list"
    return report_entries, None


def _indexed_report_entries(
    payload: SimulatorWorkspaceReportObject,
    *,
    list_field_name: str,
    index_field_name: str,
) -> tuple[dict[str, SimulatorWorkspaceReportObject] | None, str | None]:
    report_entries, error = _report_entry_list(
        payload,
        list_field_name=list_field_name,
    )
    if error:
        return None, error
    return _index_report_entries_by_string_field(report_entries, index_field_name), None


def _validate_expected_object_vectors(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_positions = expectations.object_positions_xyz or {}
    expected_sizes = expectations.object_sizes_xyz or {}
    if not expected_positions and not expected_sizes:
        return None
    objects_by_source_id, error = _indexed_report_entries(
        payload,
        list_field_name="objects",
        index_field_name="source_id",
    )
    if error:
        return error
    assert objects_by_source_id is not None
    for source_id, expected_position in expected_positions.items():
        object_report = objects_by_source_id.get(source_id)
        if object_report is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        error = _validate_expected_vector3(
            object_report.get("position_xyz"),
            expected_position,
            f"objects[{source_id}].position_xyz",
        )
        if error:
            return error
    for source_id, expected_size in expected_sizes.items():
        object_report = objects_by_source_id.get(source_id)
        if object_report is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        error = _validate_expected_vector3(
            object_report.get("size_xyz"),
            expected_size,
            f"objects[{source_id}].size_xyz",
        )
        if error:
            return error
    return None


def _validate_expected_object_contracts(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_contracts = expectations.object_contracts or {}
    if not expected_contracts:
        return None
    objects_by_source_id, error = _indexed_report_entries(
        payload,
        list_field_name="objects",
        index_field_name="source_id",
    )
    if error:
        return error
    assert objects_by_source_id is not None
    for source_id, expected_contract in expected_contracts.items():
        object_report = objects_by_source_id.get(source_id)
        if object_report is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        object_path = f"objects[{source_id}]"
        for field_name, expected_value in (
            ("source_name", expected_contract.source_name),
            ("sim_name", expected_contract.sim_name),
            ("source_type", expected_contract.source_type),
            ("sim_type", expected_contract.sim_type),
            ("semantic_role", expected_contract.semantic_role),
            ("asset_ref", expected_contract.asset_ref),
        ):
            error = _validate_expected_scalar_field(
                object_report,
                field_name=field_name,
                expected_value=expected_value,
                path=object_path,
            )
            if error:
                return error
        for field_name, expected_value in (
            ("collision", expected_contract.collision),
            ("fixed", expected_contract.fixed),
        ):
            error = _validate_expected_scalar_field(
                object_report,
                field_name=field_name,
                expected_value=expected_value,
                path=object_path,
                identity=True,
            )
            if error:
                return error
        for field_name, expected_value in (
            ("mass_kg", expected_contract.mass_kg),
            ("friction", expected_contract.friction),
            ("restitution", expected_contract.restitution),
        ):
            error = _validate_expected_optional_number(
                object_report.get(field_name),
                expected_value,
                f"objects[{source_id}].{field_name}",
            )
            if error:
                return error
        for field_name, expected_value in (
            ("position_xyz", expected_contract.position_xyz),
            ("size_xyz", expected_contract.size_xyz),
        ):
            error = _validate_expected_vector3(
                object_report.get(field_name),
                expected_value,
                f"objects[{source_id}].{field_name}",
            )
            if error:
                return error
        for field_name, expected_value in (
            ("quat_wxyz", expected_contract.quat_wxyz),
            ("rgba", expected_contract.rgba),
        ):
            error = _validate_expected_vector4(
                object_report.get(field_name),
                expected_value,
                f"objects[{source_id}].{field_name}",
            )
            if error:
                return error
        actual_asset_scale = object_report.get("asset_scale_xyz")
        if expected_contract.asset_scale_xyz is None:
            if actual_asset_scale is not None:
                return (
                    f"simulator validation report field 'objects[{source_id}].asset_scale_xyz' "
                    f"is {actual_asset_scale!r}, expected None"
                )
        else:
            error = _validate_expected_vector3(
                actual_asset_scale,
                expected_contract.asset_scale_xyz,
                f"objects[{source_id}].asset_scale_xyz",
            )
            if error:
                return error
    return None


def _validate_expected_object_asset_refs(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_asset_refs = expectations.object_asset_refs or {}
    if not expected_asset_refs:
        return None
    objects_by_source_id, error = _indexed_report_entries(
        payload,
        list_field_name="objects",
        index_field_name="source_id",
    )
    if error:
        return error
    assert objects_by_source_id is not None
    for source_id, expected_asset_ref in expected_asset_refs.items():
        object_report = objects_by_source_id.get(source_id)
        if object_report is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        actual_asset_ref = object_report.get("asset_ref")
        if actual_asset_ref != expected_asset_ref:
            return (
                f"simulator validation report field 'objects[{source_id}].asset_ref' "
                f"is {actual_asset_ref!r}, expected {expected_asset_ref!r}"
            )
    return None


def _validate_expected_camera_ids(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_camera_ids = expectations.camera_ids
    if expected_camera_ids is None:
        return None
    cameras, error = _report_entry_list(payload, list_field_name="cameras")
    if error:
        return error
    assert cameras is not None
    actual_camera_ids = tuple(
        camera_report.get("camera_id")
        for camera_report in cameras
        if isinstance(camera_report, Mapping)
    )
    if actual_camera_ids != expected_camera_ids:
        return (
            "simulator validation report camera_id sequence "
            f"is {actual_camera_ids!r}, expected {expected_camera_ids!r}"
        )
    return None


def _validate_expected_camera_contracts(
    payload: SimulatorWorkspaceReportObject,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_contracts = expectations.camera_contracts or {}
    if not expected_contracts:
        return None
    cameras_by_id, error = _indexed_report_entries(
        payload,
        list_field_name="cameras",
        index_field_name="camera_id",
    )
    if error:
        return error
    assert cameras_by_id is not None
    for camera_id, expected_contract in expected_contracts.items():
        camera_report = cameras_by_id.get(camera_id)
        if camera_report is None:
            return f"simulator validation report missing camera_id {camera_id!r}"
        camera_path = f"cameras[{camera_id}]"
        for field_name, expected_value in (
            ("sim_name", expected_contract.sim_name),
            ("parent_joint", expected_contract.parent_joint),
            ("parent_link", expected_contract.parent_link),
        ):
            error = _validate_expected_scalar_field(
                camera_report,
                field_name=field_name,
                expected_value=expected_value,
                path=camera_path,
            )
            if error:
                return error
        for field_name, expected_value in (
            ("width", expected_contract.width),
            ("height", expected_contract.height),
        ):
            error = _validate_expected_scalar_field(
                camera_report,
                field_name=field_name,
                expected_value=expected_value,
                path=camera_path,
            )
            if error:
                return error
        fov_error = _validate_expected_number(
            camera_report.get("fov_deg"),
            expected_contract.fov_deg,
            f"cameras[{camera_id}].fov_deg",
        )
        if fov_error:
            return fov_error
        position_error = _validate_expected_vector3(
            camera_report.get("position_xyz"),
            expected_contract.position_xyz,
            f"cameras[{camera_id}].position_xyz",
        )
        if position_error:
            return position_error
        quat_error = _validate_expected_vector4(
            camera_report.get("quat_wxyz"),
            expected_contract.quat_wxyz,
            f"cameras[{camera_id}].quat_wxyz",
        )
        if quat_error:
            return quat_error
        matrix_error = _validate_expected_matrix3(
            (camera_report.get("intrinsics") or {}).get("matrix")
            if isinstance(camera_report.get("intrinsics"), Mapping)
            else None,
            expected_contract.intrinsics_matrix,
            f"cameras[{camera_id}].intrinsics.matrix",
        )
        if matrix_error:
            return matrix_error
    return None


def _validate_report_object_asset_refs(payload: SimulatorWorkspaceReportObject) -> str | None:
    asset_roots = _report_asset_roots(payload.get("asset_roots"))
    if isinstance(asset_roots, str):
        return asset_roots
    objects = payload.get("objects")
    if not isinstance(objects, list):
        return "simulator validation report field 'objects' must be a list"
    for object_report in objects:
        if not isinstance(object_report, Mapping):
            continue
        asset_ref = object_report.get("asset_ref")
        if asset_ref is None:
            continue
        source_id = object_report.get("source_id", "<unknown>")
        if not isinstance(asset_ref, str) or not asset_ref.strip():
            return (
                f"simulator validation report field 'objects[{source_id}].asset_ref' "
                "must be null or a non-empty string"
            )
        if resolve_world_layout_asset_path(asset_ref, asset_roots) is None:
            return (
                f"simulator validation report field 'objects[{source_id}].asset_ref' "
                f"does not resolve under asset_roots: {asset_ref}"
            )
    return None


def _validate_report_asset_roots(value: object) -> str | None:
    roots = _report_asset_roots(value)
    if isinstance(roots, str):
        return roots
    return None


def _report_asset_roots(value: object) -> tuple[Path, ...] | str:
    if not isinstance(value, list):
        return "simulator validation report field 'asset_roots' must be a list"
    if not value:
        return "simulator validation report field 'asset_roots' must be a non-empty list"

    roots: list[Path] = []
    for index, root_value in enumerate(value):
        path_name = f"asset_roots[{index}]"
        string_error = _validate_report_string(root_value, path_name)
        if string_error:
            return string_error
        root_path = Path(cast(str, root_value)).expanduser()
        if not root_path.is_absolute():
            return (
                f"simulator validation report field '{path_name}' "
                "must be an absolute existing directory"
            )
        try:
            resolved_root = root_path.resolve()
        except (OSError, RuntimeError):
            return (
                f"simulator validation report field '{path_name}' "
                "must be an absolute existing directory"
            )
        if not resolved_root.is_dir():
            return (
                f"simulator validation report field '{path_name}' "
                "must be an absolute existing directory"
            )
        roots.append(resolved_root)
    return tuple(dict.fromkeys(roots))


def _validate_expected_vector3(
    value: object,
    expected: tuple[float, float, float],
    path: str,
) -> str | None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return f"simulator validation report field '{path}' must be a vector3"
    for axis, component in enumerate(value):
        if (
            not isinstance(component, int | float)
            or isinstance(component, bool)
            or not math.isfinite(component)
            or not math.isclose(float(component), expected[axis], rel_tol=1e-9, abs_tol=1e-9)
        ):
            return (
                f"simulator validation report field '{path}[{axis}]' "
                f"is {component!r}, expected {expected[axis]!r}"
            )
    return None


def _validate_expected_vector4(
    value: object,
    expected: tuple[float, float, float, float],
    path: str,
) -> str | None:
    if not isinstance(value, list | tuple) or len(value) != 4:
        return f"simulator validation report field '{path}' must be a vector4"
    for axis, component in enumerate(value):
        error = _validate_expected_number(component, expected[axis], f"{path}[{axis}]")
        if error:
            return error
    return None


def _validate_expected_matrix3(
    value: object,
    expected: tuple[tuple[float, float, float], ...],
    path: str,
) -> str | None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return f"simulator validation report field '{path}' must be a 3x3 matrix"
    for row_index, row in enumerate(value):
        if not isinstance(row, list | tuple) or len(row) != 3:
            return f"simulator validation report field '{path}' must be a 3x3 matrix"
        for column_index, component in enumerate(row):
            error = _validate_expected_number(
                component,
                expected[row_index][column_index],
                f"{path}[{row_index}][{column_index}]",
            )
            if error:
                return error
    return None


def _validate_expected_number(value: object, expected: float, path: str) -> str | None:
    if (
        not isinstance(value, int | float)
        or isinstance(value, bool)
        or not math.isfinite(value)
        or not math.isclose(float(value), expected, rel_tol=1e-9, abs_tol=1e-9)
    ):
        return f"simulator validation report field '{path}' is {value!r}, expected {expected!r}"
    return None


def _validate_expected_optional_number(
    value: object,
    expected: float | None,
    path: str,
) -> str | None:
    if expected is None:
        if value is not None:
            return f"simulator validation report field '{path}' is {value!r}, expected None"
        return None
    return _validate_expected_number(value, expected, path)


def _validate_expected_scalar_field(
    report_entry: SimulatorWorkspaceReportObject,
    *,
    field_name: str,
    expected_value: object,
    path: str,
    identity: bool = False,
) -> str | None:
    actual_value = report_entry.get(field_name)
    matches = actual_value is expected_value if identity else actual_value == expected_value
    if matches:
        return None
    return (
        f"simulator validation report field '{path}.{field_name}' "
        f"is {actual_value!r}, expected {expected_value!r}"
    )


def _validate_report_unique_item_values(
    report_entries: list[JsonValue],
    *,
    list_field_name: str,
    field_names: tuple[str, ...],
) -> str | None:
    for field_name in field_names:
        seen: set[str] = set()
        duplicates: set[str] = set()
        for report_entry in report_entries:
            if not isinstance(report_entry, Mapping):
                continue
            value = report_entry.get(field_name)
            if not isinstance(value, str):
                continue
            normalized = value.strip()
            if normalized in seen:
                duplicates.add(normalized)
            seen.add(normalized)
        if duplicates:
            return (
                f"simulator validation report field '{list_field_name}.{field_name}' "
                f"contains duplicate value(s): {', '.join(sorted(duplicates))}"
            )
    return None


def _validate_report_item_values(
    report_entry: SimulatorWorkspaceReportObject,
    *,
    path: str,
    list_field_name: str,
) -> str | None:
    if list_field_name == "objects":
        for field_name in ("source_id", "source_name", "sim_name", "source_type", "sim_type"):
            error = _validate_report_string(report_entry.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        for field_name in ("position_xyz", "size_xyz"):
            error = _validate_report_vector3(
                report_entry.get(field_name),
                f"{path}.{field_name}",
                positive=field_name == "size_xyz",
            )
            if error:
                return error
        error = _validate_report_quat_wxyz(report_entry.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        error = _validate_report_rgba(report_entry.get("rgba"), f"{path}.rgba")
        if error:
            return error
        for field_name in ("collision", "fixed"):
            error = _validate_report_bool(report_entry.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        for field_name in ("mass_kg", "friction", "restitution"):
            error = _validate_report_optional_non_negative_number(
                report_entry.get(field_name),
                f"{path}.{field_name}",
            )
            if error:
                return error
        for field_name in ("semantic_role", "asset_ref"):
            error = _validate_report_optional_string(
                report_entry.get(field_name),
                f"{path}.{field_name}",
            )
            if error:
                return error
        asset_scale = report_entry.get("asset_scale_xyz")
        if asset_scale is not None:
            return _validate_report_vector3(asset_scale, f"{path}.asset_scale_xyz", positive=True)
        return None

    if list_field_name == "cameras":
        for field_name in ("camera_id", "name", "sim_name", "parent_joint", "parent_link"):
            error = _validate_report_string(report_entry.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        error = _validate_report_vector3(report_entry.get("position_xyz"), f"{path}.position_xyz")
        if error:
            return error
        error = _validate_report_quat_wxyz(report_entry.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        for field_name in ("width", "height"):
            error = _validate_report_positive_int(
                report_entry.get(field_name),
                f"{path}.{field_name}",
            )
            if error:
                return error
        error = _validate_report_camera_fov(report_entry.get("fov_deg"), f"{path}.fov_deg")
        if error:
            return error
        return _validate_report_camera_intrinsics(
            report_entry.get("intrinsics"),
            f"{path}.intrinsics",
        )
    return None


def _validate_report_string(value: object, path: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return f"simulator validation report field '{path}' must be a non-empty string"
    return None


def _validate_report_optional_string(value: object, path: str) -> str | None:
    if value is None:
        return None
    return _validate_report_string(value, path)


def _validate_report_bool(value: object, path: str) -> str | None:
    if not isinstance(value, bool):
        return f"simulator validation report field '{path}' must be a boolean"
    return None


def _validate_report_string_list(
    value: object,
    path: str,
    *,
    allow_empty: bool = False,
) -> str | None:
    if not isinstance(value, list):
        return f"simulator validation report field '{path}' must be a list"
    if not allow_empty and not value:
        return f"simulator validation report field '{path}' must be a non-empty list"
    for index, report_entry in enumerate(value):
        error = _validate_report_string(report_entry, f"{path}[{index}]")
        if error:
            return error
    return None


def _validate_report_vector3(
    value: object,
    path: str,
    *,
    positive: bool = False,
) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=3)
    if isinstance(numbers, str):
        return numbers
    if positive and any(number <= 0.0 for number in numbers):
        return f"simulator validation report field '{path}' must contain positive numbers"
    return None


def _validate_report_quat_wxyz(value: object, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    norm = math.sqrt(sum(number * number for number in numbers))
    if norm <= 0.0:
        return f"simulator validation report field '{path}' must be a non-zero quaternion"
    return None


def _validate_report_rgba(value: object, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    if any(number < 0.0 or number > 1.0 for number in numbers):
        return f"simulator validation report field '{path}' must contain numbers between 0 and 1"
    return None


def _validate_report_positive_int(value: object, path: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return f"simulator validation report field '{path}' must be a positive integer"
    return None


def _validate_report_non_negative_int(value: object, path: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return f"simulator validation report field '{path}' must be a non-negative integer"
    return None


def _validate_report_optional_non_negative_number(value: object, path: str) -> str | None:
    if value is None:
        return None
    if not _is_finite_report_number(value) or float(value) < 0.0:
        return f"simulator validation report field '{path}' must be a non-negative finite number"
    return None


def _validate_report_number(value: object, path: str) -> str | None:
    if not _is_finite_report_number(value):
        return f"simulator validation report field '{path}' must be a finite number"
    return None


def _validate_report_camera_fov(value: object, path: str) -> str | None:
    if not _is_finite_report_number(value):
        return f"simulator validation report field '{path}' must be a finite number"
    parsed = float(value)
    if parsed <= 0.0 or parsed >= 180.0:
        return f"simulator validation report field '{path}' must be between 0 and 180 degrees"
    return None


def _validate_report_camera_intrinsics(value: object, path: str) -> str | None:
    if not isinstance(value, Mapping):
        return f"simulator validation report field '{path}' must be an object"
    matrix = value.get("matrix")
    rows = _report_matrix3(matrix, f"{path}.matrix")
    if isinstance(rows, str):
        return rows
    if rows[0][0] <= 0.0 or rows[1][1] <= 0.0:
        return f"simulator validation report field '{path}.matrix' must have positive focal lengths"
    bottom_row = rows[2]
    if not (
        math.isclose(bottom_row[0], 0.0, abs_tol=1e-9)
        and math.isclose(bottom_row[1], 0.0, abs_tol=1e-9)
        and math.isclose(bottom_row[2], 1.0, abs_tol=1e-9)
    ):
        return (
            f"simulator validation report field '{path}.matrix' must have "
            "homogeneous bottom row [0, 0, 1]"
        )
    return None


def _report_matrix3(value: object, path: str) -> tuple[tuple[float, float, float], ...] | str:
    if not isinstance(value, list) or len(value) != 3:
        return f"simulator validation report field '{path}' must be a 3x3 number matrix"
    rows: list[tuple[float, float, float]] = []
    for row_index, row in enumerate(value):
        numbers = _report_number_tuple(
            row,
            f"{path}[{row_index}]",
            expected_length=3,
        )
        if isinstance(numbers, str):
            return f"simulator validation report field '{path}' must be a 3x3 number matrix"
        rows.append((numbers[0], numbers[1], numbers[2]))
    return tuple(rows)


def _report_number_tuple(
    value: object,
    path: str,
    *,
    expected_length: int,
) -> tuple[float, ...] | str:
    if (
        not isinstance(value, list)
        or len(value) != expected_length
        or not all(_is_finite_report_number(component) for component in value)
    ):
        return (
            f"simulator validation report field '{path}' must be a "
            f"{expected_length}-number list"
        )
    return tuple(float(component) for component in value)


def _is_finite_report_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
