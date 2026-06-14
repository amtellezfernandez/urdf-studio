from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

from backend.services.simulator_adapters.blender_change_sets import (
    BLENDER_CHANGE_SET_SOURCE_SCHEMA,
)
from backend.services.simulator_adapters.numeric import is_finite_number

BLENDER_EDIT_SESSION_SCHEMA = "urdf-studio.blender-edit-session.v1"
BLENDER_SUPPORTED_LAYOUT_CHANGES = frozenset(
    (
        "camera.intrinsics.fov_deg",
        "camera.pose",
        "world_object.position_xyz",
        "world_object.rotation_rpy_rad",
        "world_object.size_xyz",
        "world_object.color",
    )
)
BLENDER_REVIEW_ONLY_CHANGES = frozenset(
    (
        "mesh.materials",
        "new_world_object",
    )
)
BLENDER_LOCKED_DOMAINS = frozenset(
    (
        "robot.kinematics",
        "robot.inertials",
        "robot.collisions",
        "robot.transmissions",
    )
)


def validate_blender_edit_session_artifact(
    path: Path,
    *,
    expected_object_count: int | None = None,
    expected_camera_count: int | None = None,
) -> str | None:
    if not path.is_file():
        return f"missing Blender edit-session artifact: {path}"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return f"invalid Blender edit-session artifact {path}: {exc}"
    if not isinstance(payload, Mapping):
        return f"invalid Blender edit-session artifact {path}: expected JSON object"
    error = _validate_blender_edit_session_header(payload)
    if error:
        return error
    error = _validate_blender_edit_session_round_trip(payload.get("round_trip"))
    if error:
        return error
    error = _validate_blender_edit_session_robot(payload.get("robot"))
    if error:
        return error
    object_error = _validate_blender_edit_session_entries(
        payload.get("objects"),
        "objects",
        expected_count=expected_object_count,
        expected_kind="world_object",
        required_fields=(
            "kind",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
        ),
    )
    if object_error:
        return object_error
    camera_error = _validate_blender_edit_session_entries(
        payload.get("cameras"),
        "cameras",
        expected_count=expected_camera_count,
        expected_kind="camera",
        required_fields=(
            "kind",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "width",
            "height",
            "fov_deg",
        ),
    )
    if camera_error:
        return camera_error
    return _validate_blender_edit_session_source(
        payload.get("source"),
        package=payload.get("package"),
        object_entries=payload.get("objects"),
        camera_entries=payload.get("cameras"),
    )


def _validate_blender_edit_session_header(payload: Mapping[str, Any]) -> str | None:
    required_fields = (
        "schema",
        "mode",
        "source",
        "package",
        "round_trip",
        "robot",
        "objects",
        "cameras",
        "blend_path",
    )
    missing_fields = [field for field in required_fields if field not in payload]
    if missing_fields:
        return f"Blender edit-session missing field(s): {', '.join(missing_fields)}"
    if payload.get("schema") != BLENDER_EDIT_SESSION_SCHEMA:
        return "Blender edit-session has unsupported schema"
    if payload.get("mode") != "visual-layout":
        return "Blender edit-session mode must be 'visual-layout'"
    for field_name in ("source", "package"):
        if not isinstance(payload.get(field_name), Mapping):
            return f"Blender edit-session field '{field_name}' must be an object"
    return _validate_non_empty_string(payload.get("blend_path"), "blend_path")


def _validate_blender_edit_session_round_trip(value: Any) -> str | None:
    if not isinstance(value, Mapping):
        return "Blender edit-session field 'round_trip' must be an object"
    for field_name, expected_values in (
        ("supported_changes", BLENDER_SUPPORTED_LAYOUT_CHANGES),
        ("review_only", BLENDER_REVIEW_ONLY_CHANGES),
        ("locked", BLENDER_LOCKED_DOMAINS),
    ):
        error = _validate_contains_strings(value.get(field_name), f"round_trip.{field_name}")
        if error:
            return error
        missing = sorted(expected_values - set(value[field_name]))
        if missing:
            return (
                f"Blender edit-session field 'round_trip.{field_name}' "
                f"missing value(s): {', '.join(missing)}"
            )
    error = _validate_non_empty_string(value.get("change_set_path"), "round_trip.change_set_path")
    if error:
        return error
    error = _validate_non_empty_string(value.get("export_script_path"), "round_trip.export_script_path")
    if error:
        return error
    export_script_path = Path(value["export_script_path"])
    if not export_script_path.is_file():
        return f"Blender edit-session export script is not a file: {export_script_path}"
    return None


def _validate_blender_edit_session_robot(value: Any) -> str | None:
    if not isinstance(value, Mapping):
        return "Blender edit-session field 'robot' must be an object"
    if value.get("locked") is not True:
        return "Blender edit-session robot.locked must be true"
    for field_name in ("urdf_path", "visual_usd_path"):
        error = _validate_existing_file_string(value.get(field_name), f"robot.{field_name}")
        if error:
            return error
    visual_glb_path = value.get("visual_glb_path")
    if visual_glb_path is not None:
        error = _validate_existing_file_string(visual_glb_path, "robot.visual_glb_path")
        if error:
            return error
    return None


def _validate_blender_edit_session_entries(
    value: Any,
    field_name: str,
    *,
    expected_count: int | None,
    expected_kind: str,
    required_fields: Sequence[str],
) -> str | None:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return f"Blender edit-session field '{field_name}' must be a list"
    if expected_count is not None and len(value) != expected_count:
        return (
            f"Blender edit-session field '{field_name}' has wrong count: "
            f"{len(value)}, expected {expected_count}"
        )
    for index, entry in enumerate(value):
        if not isinstance(entry, Mapping):
            return f"Blender edit-session {field_name}[{index}] must be an object"
        missing_fields = [field for field in required_fields if field not in entry]
        if missing_fields:
            return (
                f"Blender edit-session {field_name}[{index}] missing field(s): "
                f"{', '.join(missing_fields)}"
            )
        if entry.get("kind") != expected_kind:
            return (
                f"Blender edit-session {field_name}[{index}].kind must be "
                f"{expected_kind!r}"
            )
        error = _validate_non_empty_string(
            entry.get("stable_id"),
            f"{field_name}[{index}].stable_id",
        )
        if error:
            return error
        error = _validate_non_empty_string(
            entry.get("sim_name"),
            f"{field_name}[{index}].sim_name",
        )
        if error:
            return error
        error = _validate_blender_edit_session_entry_numbers(
            entry,
            f"{field_name}[{index}]",
        )
        if error:
            return error
    return None


def _validate_blender_edit_session_source(
    value: Any,
    *,
    package: Any,
    object_entries: Any,
    camera_entries: Any,
) -> str | None:
    if not isinstance(value, Mapping):
        return "Blender edit-session field 'source' must be an object"
    if not isinstance(package, Mapping):
        return "Blender edit-session field 'package' must be an object"
    if value.get("schema") != BLENDER_CHANGE_SET_SOURCE_SCHEMA:
        return "Blender edit-session source has unsupported schema"
    for source_key, package_key in (
        ("package_id", "package_id"),
        ("version", "version"),
        ("frame_convention", "frame_convention"),
        ("frame_map", "frame_map"),
    ):
        source_value = value.get(source_key)
        package_value = package.get(package_key)
        if source_value != package_value:
            return (
                f"Blender edit-session source.{source_key} does not match "
                f"package.{package_key}"
            )
    for field_name in ("world_snapshot_digest_sha256",):
        error = _validate_non_empty_string(value.get(field_name), f"source.{field_name}")
        if error:
            return error
    object_ids = _validate_source_id_list(value.get("world_object_ids"), "source.world_object_ids")
    if isinstance(object_ids, str):
        return object_ids
    camera_ids = _validate_source_id_list(value.get("camera_ids"), "source.camera_ids")
    if isinstance(camera_ids, str):
        return camera_ids
    object_entry_ids = _entry_stable_ids(object_entries, "objects")
    if isinstance(object_entry_ids, str):
        return object_entry_ids
    camera_entry_ids = _entry_stable_ids(camera_entries, "cameras")
    if isinstance(camera_entry_ids, str):
        return camera_entry_ids
    return _validate_id_coverage(
        source_ids=object_ids,
        entry_ids=object_entry_ids,
        source_name="source.world_object_ids",
        entry_name="objects",
    ) or _validate_id_coverage(
        source_ids=camera_ids,
        entry_ids=camera_entry_ids,
        source_name="source.camera_ids",
        entry_name="cameras",
    )


def _validate_source_id_list(value: Any, path_name: str) -> tuple[str, ...] | str:
    error = _validate_contains_strings(value, path_name)
    if error:
        return error
    values = tuple(str(item).strip() for item in value)
    duplicate_ids = _duplicate_ids(values)
    if duplicate_ids:
        return (
            f"Blender edit-session field '{path_name}' contains duplicate id(s): "
            f"{', '.join(duplicate_ids)}"
        )
    return values


def _entry_stable_ids(value: Any, field_name: str) -> tuple[str, ...] | str:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return f"Blender edit-session field '{field_name}' must be a list"
    stable_ids = tuple(
        str(entry.get("stable_id", "")).strip()
        for entry in value
        if isinstance(entry, Mapping)
    )
    duplicate_ids = _duplicate_ids(stable_ids)
    if duplicate_ids:
        return (
            f"Blender edit-session field '{field_name}' contains duplicate stable_id(s): "
            f"{', '.join(duplicate_ids)}"
        )
    return stable_ids


def _validate_id_coverage(
    *,
    source_ids: Sequence[str],
    entry_ids: Sequence[str],
    source_name: str,
    entry_name: str,
) -> str | None:
    missing_ids = sorted(set(source_ids) - set(entry_ids))
    if missing_ids:
        return (
            f"Blender edit-session field '{source_name}' references id(s) "
            f"missing from {entry_name}: {', '.join(missing_ids)}"
        )
    extra_ids = sorted(set(entry_ids) - set(source_ids))
    if extra_ids:
        return (
            f"Blender edit-session field '{entry_name}' contains id(s) "
            f"missing from {source_name}: {', '.join(extra_ids)}"
        )
    return None


def _duplicate_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted(value for value, count in Counter(values).items() if count > 1))


def _validate_blender_edit_session_entry_numbers(
    entry: Mapping[str, Any],
    path_name: str,
) -> str | None:
    validators = (
        ("position_xyz", _validate_vector3),
        ("quat_wxyz", _validate_quat_wxyz),
        ("size_xyz", _validate_positive_vector3),
        ("rgba", _validate_rgba),
        ("width", _validate_positive_int),
        ("height", _validate_positive_int),
        ("fov_deg", _validate_fov_deg),
    )
    for field_name, validator in validators:
        if field_name in entry:
            error = validator(entry[field_name], f"{path_name}.{field_name}")
            if error:
                return error
    return None


def _validate_vector(
    value: Any,
    path_name: str,
    *,
    expected_length: int,
) -> tuple[float, ...] | str:
    if not isinstance(value, Sequence) or isinstance(value, str) or len(value) != expected_length:
        return (
            f"Blender edit-session field '{path_name}' must be a "
            f"{expected_length}-number list"
        )
    if not all(is_finite_number(item) for item in value):
        return f"Blender edit-session field '{path_name}' must contain only finite numbers"
    return tuple(float(item) for item in value)


def _validate_vector3(value: Any, path_name: str) -> str | None:
    result = _validate_vector(value, path_name, expected_length=3)
    return result if isinstance(result, str) else None


def _validate_positive_vector3(value: Any, path_name: str) -> str | None:
    result = _validate_vector(value, path_name, expected_length=3)
    if isinstance(result, str):
        return result
    if any(number <= 0.0 for number in result):
        return f"Blender edit-session field '{path_name}' must contain positive dimensions"
    return None


def _validate_quat_wxyz(value: Any, path_name: str) -> str | None:
    result = _validate_vector(value, path_name, expected_length=4)
    if isinstance(result, str):
        return result
    if sum(number * number for number in result) <= 0.0:
        return f"Blender edit-session field '{path_name}' must be a non-zero quaternion"
    return None


def _validate_rgba(value: Any, path_name: str) -> str | None:
    result = _validate_vector(value, path_name, expected_length=4)
    if isinstance(result, str):
        return result
    if any(number < 0.0 or number > 1.0 for number in result):
        return f"Blender edit-session field '{path_name}' must contain numbers between 0 and 1"
    return None


def _validate_positive_int(value: Any, path_name: str) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return f"Blender edit-session field '{path_name}' must be a positive integer"
    return None


def _validate_fov_deg(value: Any, path_name: str) -> str | None:
    if not is_finite_number(value) or float(value) <= 0.0 or float(value) >= 180.0:
        return f"Blender edit-session field '{path_name}' must be between 0 and 180 degrees"
    return None


def _validate_existing_file_string(value: Any, path_name: str) -> str | None:
    error = _validate_non_empty_string(value, path_name)
    if error:
        return error
    path = Path(value)
    if not path.is_file():
        return f"Blender edit-session field '{path_name}' is not a file: {path}"
    return None


def _validate_contains_strings(value: Any, path_name: str) -> str | None:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return f"Blender edit-session field '{path_name}' must be a list"
    if any(not isinstance(item, str) or not item.strip() for item in value):
        return f"Blender edit-session field '{path_name}' must contain only non-empty strings"
    return None


def _validate_non_empty_string(value: Any, path_name: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return f"Blender edit-session field '{path_name}' must be a non-empty string"
    return None
