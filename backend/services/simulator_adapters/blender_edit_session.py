from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

BLENDER_EDIT_SESSION_SCHEMA = "urdf-studio.blender-edit-session.v1"
BLENDER_SUPPORTED_WORLD_OBJECT_CHANGES = frozenset(
    (
        "world_object.position_xyz",
        "world_object.rotation_rpy_rad",
        "world_object.size_xyz",
        "world_object.color",
    )
)
BLENDER_REVIEW_ONLY_CHANGES = frozenset(
    (
        "camera.pose",
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
    error = _validate_blender_edit_session_entries(
        payload.get("objects"),
        "objects",
        expected_count=expected_object_count,
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
    if error:
        return error
    return _validate_blender_edit_session_entries(
        payload.get("cameras"),
        "cameras",
        expected_count=expected_camera_count,
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
        ("supported_changes", BLENDER_SUPPORTED_WORLD_OBJECT_CHANGES),
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
