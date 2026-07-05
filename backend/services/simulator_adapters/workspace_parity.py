from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias, TypedDict, cast

from backend.models.json_payload import JsonObject
from backend.services.simulator_adapters.camera_artifacts import (
    MIN_VISIBLE_CHANNEL_SPAN,
    camera_artifact_name,
    inspect_rgb_image,
)

WORKSPACE_PARITY_ID = "workspace-parity"
PARITY_REPORT_FIELDS = (
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
)
PARITY_REQUIRED_REPORT_FIELDS = (
    *PARITY_REPORT_FIELDS,
    "robot_urdf_path",
    "asset_roots",
    "warnings",
    "objects",
    "cameras",
    "artifacts",
)


@dataclass(frozen=True)
class WorkspaceParityInput:
    label: str
    report_path: Path


@dataclass(frozen=True)
class WorkspaceParityResult:
    passed: bool
    detail: str


ParityReportPayload: TypeAlias = JsonObject
ParityReportView: TypeAlias = Mapping[str, object]
ParitySignature: TypeAlias = dict[str, object]


class CameraImageEntry(TypedDict):
    camera_id: str
    sim_name: str
    name: str
    width: int
    height: int


class CameraImageManifest(TypedDict):
    images: list[CameraImageEntry]


class ExpectedCameraImage(TypedDict):
    camera_id: str
    sim_name: str
    name: str
    width: int
    height: int


LoadedParityReport: TypeAlias = tuple[WorkspaceParityInput, ParityReportPayload]
LoadedParityReportView: TypeAlias = tuple[WorkspaceParityInput, ParityReportView]


def check_simulator_workspace_parity(
    inputs: Sequence[WorkspaceParityInput],
) -> WorkspaceParityResult | None:
    if len(inputs) < 2:
        return None

    loaded_reports: list[LoadedParityReport] = []
    for parity_input in inputs:
        try:
            report = _load_report(parity_input.report_path)
        except ValueError as exc:
            return WorkspaceParityResult(
                passed=False,
                detail=f"could not read {parity_input.label} validation report: {exc}",
            )
        loaded_reports.append((parity_input, report))

    reference_input, reference_report = loaded_reports[0]
    reference_signature = _parity_report_signature(reference_report)
    for candidate_input, candidate_report in loaded_reports[1:]:
        difference = _first_difference(
            reference_signature,
            _parity_report_signature(candidate_report),
            path="report",
        )
        if difference is not None:
            return WorkspaceParityResult(
                passed=False,
                detail=f"{candidate_input.label} differs from {reference_input.label}: {difference}",
            )

    image_difference = _validate_camera_image_parity(loaded_reports)
    if image_difference is not None:
        return WorkspaceParityResult(passed=False, detail=image_difference)
    return _successful_workspace_parity_result(loaded_reports)


def _successful_workspace_parity_result(
    loaded_reports: Sequence[LoadedParityReport],
) -> WorkspaceParityResult:
    labels = ", ".join(parity_input.label for parity_input, _report in loaded_reports)
    return WorkspaceParityResult(
        passed=True,
        detail=f"canonical scene and camera artifacts match across: {labels}",
    )


def _load_report(path: Path) -> ParityReportPayload:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid parity report {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    missing_fields = [
        field for field in PARITY_REQUIRED_REPORT_FIELDS if field not in payload
    ]
    if missing_fields:
        raise ValueError(
            "missing parity report field(s): "
            f"{', '.join(missing_fields)}"
        )
    payload_error = _validate_parity_report_payload(cast(ParityReportView, payload))
    if payload_error is not None:
        raise ValueError(payload_error)
    return cast(ParityReportPayload, payload)


def _validate_parity_report_payload(report: ParityReportView) -> str | None:
    robot_urdf_path = report.get("robot_urdf_path")
    if not isinstance(robot_urdf_path, str) or not robot_urdf_path.strip():
        return "parity report field 'robot_urdf_path' must be a non-empty string"

    asset_roots = report.get("asset_roots")
    if not isinstance(asset_roots, list):
        return "parity report field 'asset_roots' must be a list"
    for index, asset_root in enumerate(asset_roots):
        if not isinstance(asset_root, str) or not asset_root.strip():
            return f"parity report field 'asset_roots[{index}]' must be a non-empty string"

    warnings = report.get("warnings")
    if not isinstance(warnings, list):
        return "parity report field 'warnings' must be a list"
    for index, warning in enumerate(warnings):
        if not isinstance(warning, str):
            return f"parity report field 'warnings[{index}]' must be a string"

    objects = report.get("objects")
    if not isinstance(objects, list):
        return "parity report field 'objects' must be a list"

    cameras = report.get("cameras")
    if not isinstance(cameras, list):
        return "parity report field 'cameras' must be a list"

    artifacts = report.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return "parity report field 'artifacts' must be an object"
    return None


def _parity_report_signature(report: ParityReportView) -> ParitySignature:
    signature: ParitySignature = {
        field: _normalize_for_parity(report.get(field)) for field in PARITY_REPORT_FIELDS
    }
    signature["warnings"] = sorted(
        str(warning)
        for warning in report.get("warnings", [])
        if isinstance(warning, str)
    )
    signature["objects"] = sorted(
        (_normalize_for_parity(scene_object) for scene_object in _list_field(report, "objects")),
        key=lambda scene_object: (
            str(scene_object.get("source_id", "")) if isinstance(scene_object, Mapping) else "",
            str(scene_object.get("sim_name", "")) if isinstance(scene_object, Mapping) else "",
        ),
    )
    signature["cameras"] = sorted(
        (_normalize_for_parity(camera) for camera in _list_field(report, "cameras")),
        key=lambda camera: (
            str(camera.get("sim_name", "")) if isinstance(camera, Mapping) else "",
            str(camera.get("camera_id", "")) if isinstance(camera, Mapping) else "",
        ),
    )
    return signature


def _list_field(report: ParityReportView, field_name: str) -> list[object]:
    value = report.get(field_name)
    return value if isinstance(value, list) else []


def _normalize_for_parity(value: object) -> object:
    if isinstance(value, float):
        return round(value, 10)
    if isinstance(value, Mapping):
        return {
            str(key): _normalize_for_parity(nested_value)
            for key, nested_value in sorted(value.items(), key=lambda entry: str(entry[0]))
        }
    if isinstance(value, list):
        return [_normalize_for_parity(nested_value) for nested_value in value]
    return value


def _first_difference(expected: object, actual: object, *, path: str) -> str | None:
    if isinstance(expected, Mapping) and isinstance(actual, Mapping):
        expected_keys = set(expected.keys())
        actual_keys = set(actual.keys())
        if expected_keys != actual_keys:
            missing = sorted(expected_keys - actual_keys, key=str)
            extra = sorted(actual_keys - expected_keys, key=str)
            return f"{path} keys differ: missing={missing}, extra={extra}"
        for key in sorted(expected_keys, key=str):
            difference = _first_difference(
                expected[key],
                actual[key],
                path=f"{path}.{key}",
            )
            if difference is not None:
                return difference
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return f"{path} length differs: {len(actual)} != {len(expected)}"
        for index, (expected_item, actual_item) in enumerate(zip(expected, actual)):
            difference = _first_difference(
                expected_item,
                actual_item,
                path=f"{path}[{index}]",
            )
            if difference is not None:
                return difference
        return None
    if expected != actual:
        return f"{path} differs: {actual!r} != {expected!r}"
    return None


def _validate_camera_image_parity(
    loaded_reports: Sequence[LoadedParityReportView],
) -> str | None:
    reference_label, reference_manifest = _camera_image_manifest(loaded_reports[0])
    if isinstance(reference_manifest, str):
        return reference_manifest
    for candidate_report in loaded_reports[1:]:
        label, manifest = _camera_image_manifest(candidate_report)
        if isinstance(manifest, str):
            return manifest
        difference = _first_difference(
            reference_manifest,
            manifest,
            path="camera_images",
        )
        if difference is not None:
            return f"{label} camera images differ from {reference_label}: {difference}"
    return None


def _camera_image_manifest(
    loaded_report: LoadedParityReportView,
) -> tuple[str, CameraImageManifest | str]:
    parity_input, report = loaded_report
    label = parity_input.label
    cameras = _list_field(report, "cameras")
    expected_images_or_error = _expected_camera_images(label, cameras)
    if isinstance(expected_images_or_error, str):
        return _labeled_camera_manifest(label, expected_images_or_error)
    expected_images = expected_images_or_error
    if not expected_images:
        return _labeled_camera_manifest(label, {"images": []})

    directory_or_error = _camera_image_directory(report, label=label)
    if isinstance(directory_or_error, str):
        return _labeled_camera_manifest(label, directory_or_error)
    directory = directory_or_error
    image_paths_or_error = _camera_image_paths(directory, label=label)
    if isinstance(image_paths_or_error, str):
        return _labeled_camera_manifest(label, image_paths_or_error)
    image_paths = image_paths_or_error
    names_error = _camera_image_name_error(
        image_paths,
        expected_images=expected_images,
        label=label,
    )
    if names_error is not None:
        return _labeled_camera_manifest(label, names_error)

    images: list[CameraImageEntry] = []
    image_by_name = {path.name: path for path in image_paths}
    for expected in expected_images:
        path = image_by_name[expected["name"]]
        try:
            image_stats = inspect_rgb_image(path)
        except (OSError, ValueError) as exc:
            return _labeled_camera_manifest(label, f"invalid camera_images artifact {path}: {exc}")
        if image_stats.size != (expected["width"], expected["height"]):
            return _labeled_camera_manifest(
                label,
                f"{label} camera_images PNG {path.name} size {image_stats.size} "
                f"does not match report camera size {(expected['width'], expected['height'])}",
            )
        if image_stats.channel_span <= MIN_VISIBLE_CHANNEL_SPAN:
            return _labeled_camera_manifest(label, f"{label} camera_images PNG {path.name} is blank")
        images.append(
            {
                "camera_id": expected["camera_id"],
                "sim_name": expected["sim_name"],
                "name": path.name,
                "width": image_stats.size[0],
                "height": image_stats.size[1],
            }
        )
    return _labeled_camera_manifest(label, {"images": images})


def _labeled_camera_manifest(
    label: str,
    value: CameraImageManifest | str,
) -> tuple[str, CameraImageManifest | str]:
    return label, value


def _camera_image_paths(directory: Path, *, label: str) -> list[Path] | str:
    image_paths = sorted(directory.glob("*.png"))
    if image_paths:
        return image_paths
    return f"{label} camera_images has no PNG artifacts in {directory}"


def _camera_image_name_error(
    image_paths: Sequence[Path],
    *,
    expected_images: Sequence[ExpectedCameraImage],
    label: str,
) -> str | None:
    actual_names = sorted(path.name for path in image_paths)
    expected_names = sorted(entry["name"] for entry in expected_images)
    if actual_names == expected_names:
        return None
    return (
        f"{label} camera_images PNG names do not match report cameras: "
        f"actual={actual_names}, expected={expected_names}"
    )


def _camera_image_directory(
    report: ParityReportView,
    *,
    label: str,
) -> Path | str:
    artifacts = report.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return f"{label} camera_images validation report has no artifacts object"
    directory_raw = artifacts.get("camera_screenshot_dir")
    if not isinstance(directory_raw, str) or not directory_raw.strip():
        return f"{label} camera_images validation report has no camera_screenshot_dir"
    directory = Path(directory_raw)
    if not directory.is_dir():
        return f"{label} camera_images directory is not a directory: {directory}"
    return directory


def _expected_camera_images(
    label: str,
    cameras: Sequence[object],
) -> list[ExpectedCameraImage] | str:
    expected_images: list[ExpectedCameraImage] = []
    for index, camera in enumerate(cameras, start=1):
        if not isinstance(camera, Mapping):
            return f"{label} camera_images validation report camera[{index - 1}] must be an object"
        camera_id = camera.get("camera_id")
        sim_name = camera.get("sim_name")
        width = camera.get("width")
        height = camera.get("height")
        if not isinstance(camera_id, str) or not camera_id.strip():
            return f"{label} camera_images validation report camera[{index - 1}].camera_id must be a non-empty string"
        if not isinstance(sim_name, str) or not sim_name.strip():
            return f"{label} camera_images validation report camera[{index - 1}].sim_name must be a non-empty string"
        if not isinstance(width, int) or isinstance(width, bool) or width <= 0:
            return f"{label} camera_images validation report camera[{index - 1}].width must be a positive integer"
        if not isinstance(height, int) or isinstance(height, bool) or height <= 0:
            return f"{label} camera_images validation report camera[{index - 1}].height must be a positive integer"
        expected_images.append(
            {
                "camera_id": camera_id,
                "sim_name": sim_name,
                "name": camera_artifact_name(index=index, camera_name=sim_name),
                "width": width,
                "height": height,
            }
        )
    return expected_images
