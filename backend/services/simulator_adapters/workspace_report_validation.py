from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from backend.models.simulator_runtime import SimulatorId
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    WorldLayoutFrameMap,
)

VALID_REPORT_FRAME_MAPS = frozenset(("identity", "studio-y-up-to-z-up"))
VALID_REPORT_REQUESTED_FRAME_MAPS = frozenset(("auto", *VALID_REPORT_FRAME_MAPS))


@dataclass(frozen=True)
class SimulatorWorkspaceReportExpectations:
    simulator_id: SimulatorId | None = None
    object_count: int | None = None
    camera_count: int | None = None
    requested_frame_map: WorldLayoutFrameMap | None = None
    frame_map: ConcreteWorldLayoutFrameMap | None = None
    object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    required_artifact_file_keys: tuple[str, ...] = ()
    required_artifact_dir_keys: tuple[str, ...] = ()


def validate_simulator_workspace_report(
    report_path: Path,
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    if not report_path.exists():
        return f"missing simulator validation report: {report_path}"
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return f"invalid simulator validation report {report_path}: {exc}"
    if not isinstance(payload, dict):
        return f"invalid simulator validation report {report_path}: expected JSON object"

    required_fields = (
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
        "robot_urdf_path",
        "asset_roots",
        "warnings",
        "objects",
        "cameras",
        "artifacts",
    )
    missing_fields = [field for field in required_fields if field not in payload]
    if missing_fields:
        return f"simulator validation report missing field(s): {', '.join(missing_fields)}"

    simulator = payload.get("simulator")
    simulator_error = _validate_report_simulator(simulator, expectations)
    if simulator_error:
        return simulator_error

    header_error = _validate_report_header(payload)
    if header_error:
        return header_error

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
    object_vector_error = _validate_expected_object_vectors(payload, expectations)
    if object_vector_error:
        return object_vector_error
    return _validate_report_item_fields(
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


def _validate_report_simulator(
    value: Any,
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


def _validate_report_header(payload: Mapping[str, Any]) -> str | None:
    for field_name in ("package_id", "version", "robot_urdf_path"):
        error = _validate_report_string(payload.get(field_name), field_name)
        if error:
            return error
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
    error = _validate_report_string_list(payload.get("asset_roots"), "asset_roots")
    if error:
        return error
    return _validate_report_string_list(payload.get("warnings"), "warnings", allow_empty=True)


def _validate_report_frame_map(
    value: Any,
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
    payload: Mapping[str, Any],
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
    payload: Mapping[str, Any],
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
    artifacts: Mapping[str, Any],
    key: str,
    *,
    kind: str,
) -> str | None:
    value = artifacts.get(key)
    path_error = _validate_report_string(value, f"artifacts.{key}")
    if path_error:
        return path_error
    path = Path(value)
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


def _validate_report_count(
    payload: Mapping[str, Any],
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
    payload: Mapping[str, Any],
    *,
    list_field_name: str,
    required_fields: tuple[str, ...],
) -> str | None:
    items = payload.get(list_field_name)
    if not isinstance(items, list):
        return f"simulator validation report field '{list_field_name}' must be a list"
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            return (
                f"simulator validation report field '{list_field_name}[{index}]' "
                "must be an object"
            )
        missing_fields = [field for field in required_fields if field not in item]
        if missing_fields:
            return (
                f"simulator validation report field '{list_field_name}[{index}]' "
                f"missing field(s): {', '.join(missing_fields)}"
            )
        value_error = _validate_report_item_values(
            item,
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
        items,
        list_field_name=list_field_name,
        field_names=identity_fields,
    )
    if identity_error:
        return identity_error
    return None


def _validate_expected_object_vectors(
    payload: Mapping[str, Any],
    expectations: SimulatorWorkspaceReportExpectations,
) -> str | None:
    expected_positions = expectations.object_positions_xyz or {}
    expected_sizes = expectations.object_sizes_xyz or {}
    if not expected_positions and not expected_sizes:
        return None
    objects = payload.get("objects")
    if not isinstance(objects, list):
        return "simulator validation report field 'objects' must be a list"
    objects_by_source_id = {
        item.get("source_id"): item
        for item in objects
        if isinstance(item, Mapping) and isinstance(item.get("source_id"), str)
    }
    for source_id, expected_position in expected_positions.items():
        item = objects_by_source_id.get(source_id)
        if item is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        error = _validate_expected_vector3(
            item.get("position_xyz"),
            expected_position,
            f"objects[{source_id}].position_xyz",
        )
        if error:
            return error
    for source_id, expected_size in expected_sizes.items():
        item = objects_by_source_id.get(source_id)
        if item is None:
            return f"simulator validation report missing object source_id {source_id!r}"
        error = _validate_expected_vector3(
            item.get("size_xyz"),
            expected_size,
            f"objects[{source_id}].size_xyz",
        )
        if error:
            return error
    return None


def _validate_expected_vector3(
    value: Any,
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


def _validate_report_unique_item_values(
    items: list[Any],
    *,
    list_field_name: str,
    field_names: tuple[str, ...],
) -> str | None:
    for field_name in field_names:
        seen: set[str] = set()
        duplicates: set[str] = set()
        for item in items:
            if not isinstance(item, Mapping):
                continue
            value = item.get(field_name)
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
    item: Mapping[str, Any],
    *,
    path: str,
    list_field_name: str,
) -> str | None:
    if list_field_name == "objects":
        for field_name in ("source_id", "source_name", "sim_name", "source_type", "sim_type"):
            error = _validate_report_string(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        for field_name in ("position_xyz", "size_xyz"):
            error = _validate_report_vector3(
                item.get(field_name),
                f"{path}.{field_name}",
                positive=field_name == "size_xyz",
            )
            if error:
                return error
        error = _validate_report_quat_wxyz(item.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        error = _validate_report_rgba(item.get("rgba"), f"{path}.rgba")
        if error:
            return error
        for field_name in ("collision", "fixed"):
            error = _validate_report_bool(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        for field_name in ("mass_kg", "friction", "restitution"):
            error = _validate_report_optional_non_negative_number(
                item.get(field_name),
                f"{path}.{field_name}",
            )
            if error:
                return error
        for field_name in ("semantic_role", "asset_ref"):
            error = _validate_report_optional_string(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        asset_scale = item.get("asset_scale_xyz")
        if asset_scale is not None:
            return _validate_report_vector3(asset_scale, f"{path}.asset_scale_xyz", positive=True)
        return None

    if list_field_name == "cameras":
        for field_name in ("camera_id", "name", "sim_name", "parent_joint", "parent_link"):
            error = _validate_report_string(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        error = _validate_report_vector3(item.get("position_xyz"), f"{path}.position_xyz")
        if error:
            return error
        error = _validate_report_quat_wxyz(item.get("quat_wxyz"), f"{path}.quat_wxyz")
        if error:
            return error
        for field_name in ("width", "height"):
            error = _validate_report_positive_int(item.get(field_name), f"{path}.{field_name}")
            if error:
                return error
        error = _validate_report_camera_fov(item.get("fov_deg"), f"{path}.fov_deg")
        if error:
            return error
        return _validate_report_camera_intrinsics(
            item.get("intrinsics"),
            f"{path}.intrinsics",
        )
    return None


def _validate_report_string(value: Any, path: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return f"simulator validation report field '{path}' must be a non-empty string"
    return None


def _validate_report_optional_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return _validate_report_string(value, path)


def _validate_report_bool(value: Any, path: str) -> str | None:
    if not isinstance(value, bool):
        return f"simulator validation report field '{path}' must be a boolean"
    return None


def _validate_report_string_list(
    value: Any,
    path: str,
    *,
    allow_empty: bool = False,
) -> str | None:
    if not isinstance(value, list):
        return f"simulator validation report field '{path}' must be a list"
    if not allow_empty and not value:
        return f"simulator validation report field '{path}' must be a non-empty list"
    for index, item in enumerate(value):
        error = _validate_report_string(item, f"{path}[{index}]")
        if error:
            return error
    return None


def _validate_report_vector3(
    value: Any,
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


def _validate_report_quat_wxyz(value: Any, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    norm = math.sqrt(sum(number * number for number in numbers))
    if norm <= 0.0:
        return f"simulator validation report field '{path}' must be a non-zero quaternion"
    return None


def _validate_report_rgba(value: Any, path: str) -> str | None:
    numbers = _report_number_tuple(value, path, expected_length=4)
    if isinstance(numbers, str):
        return numbers
    if any(number < 0.0 or number > 1.0 for number in numbers):
        return f"simulator validation report field '{path}' must contain numbers between 0 and 1"
    return None


def _validate_report_positive_int(value: Any, path: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return f"simulator validation report field '{path}' must be a positive integer"
    return None


def _validate_report_non_negative_int(value: Any, path: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return f"simulator validation report field '{path}' must be a non-negative integer"
    return None


def _validate_report_optional_non_negative_number(value: Any, path: str) -> str | None:
    if value is None:
        return None
    if not _is_finite_report_number(value) or float(value) < 0.0:
        return f"simulator validation report field '{path}' must be a non-negative finite number"
    return None


def _validate_report_camera_fov(value: Any, path: str) -> str | None:
    if not _is_finite_report_number(value):
        return f"simulator validation report field '{path}' must be a finite number"
    parsed = float(value)
    if parsed <= 0.0 or parsed >= 180.0:
        return f"simulator validation report field '{path}' must be between 0 and 180 degrees"
    return None


def _validate_report_camera_intrinsics(value: Any, path: str) -> str | None:
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


def _report_matrix3(value: Any, path: str) -> tuple[tuple[float, float, float], ...] | str:
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
    value: Any,
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


def _is_finite_report_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
