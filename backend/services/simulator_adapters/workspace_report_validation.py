from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from backend.models.simulator_runtime import SimulatorId


@dataclass(frozen=True)
class SimulatorWorkspaceReportExpectations:
    simulator_id: SimulatorId | None = None
    object_count: int | None = None
    camera_count: int | None = None
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
        "frame_map",
        "primitive_count",
        "camera_count",
        "objects",
        "cameras",
        "artifacts",
    )
    missing_fields = [field for field in required_fields if field not in payload]
    if missing_fields:
        return f"simulator validation report missing field(s): {', '.join(missing_fields)}"

    simulator = payload.get("simulator")
    if not isinstance(simulator, Mapping):
        return "simulator validation report field 'simulator' must be an object"
    if expectations.simulator_id is not None and simulator.get("id") != expectations.simulator_id:
        return (
            "simulator validation report has wrong simulator id: "
            f"{simulator.get('id')!r}, expected {expectations.simulator_id!r}"
        )

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
            "sim_name",
            "sim_type",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
        ),
    )
    if item_error:
        return item_error
    return _validate_report_item_fields(
        payload,
        list_field_name="cameras",
        required_fields=(
            "camera_id",
            "sim_name",
            "parent_link",
            "position_xyz",
            "quat_wxyz",
            "width",
            "height",
            "fov_deg",
            "intrinsics",
        ),
    )


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
    return None


def _validate_report_item_values(
    item: Mapping[str, Any],
    *,
    path: str,
    list_field_name: str,
) -> str | None:
    if list_field_name == "objects":
        for field_name in ("source_id", "sim_name", "sim_type"):
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
        return _validate_report_rgba(item.get("rgba"), f"{path}.rgba")

    if list_field_name == "cameras":
        for field_name in ("camera_id", "sim_name", "parent_link"):
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
