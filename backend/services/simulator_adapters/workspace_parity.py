from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

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
)


@dataclass(frozen=True)
class WorkspaceParityInput:
    label: str
    report_path: Path


@dataclass(frozen=True)
class WorkspaceParityResult:
    passed: bool
    detail: str


def check_simulator_workspace_parity(
    inputs: Sequence[WorkspaceParityInput],
) -> WorkspaceParityResult | None:
    if len(inputs) < 2:
        return None

    loaded_reports: list[tuple[WorkspaceParityInput, dict[str, Any]]] = []
    for item in inputs:
        try:
            report = _load_report(item.report_path)
        except Exception as exc:
            return WorkspaceParityResult(
                passed=False,
                detail=f"could not read {item.label} validation report: {exc}",
            )
        loaded_reports.append((item, report))

    reference_input, reference_report = loaded_reports[0]
    reference_signature = _parity_report_signature(reference_report)
    for item, report in loaded_reports[1:]:
        difference = _first_difference(
            reference_signature,
            _parity_report_signature(report),
            path="report",
        )
        if difference is not None:
            return WorkspaceParityResult(
                passed=False,
                detail=f"{item.label} differs from {reference_input.label}: {difference}",
            )

    image_difference = _validate_camera_image_parity(loaded_reports)
    if image_difference is not None:
        return WorkspaceParityResult(passed=False, detail=image_difference)
    labels = ", ".join(item.label for item, _report in loaded_reports)
    return WorkspaceParityResult(
        passed=True,
        detail=f"canonical scene and camera artifacts match across: {labels}",
    )


def _load_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def _parity_report_signature(report: Mapping[str, Any]) -> dict[str, Any]:
    signature = {field: _normalize_for_parity(report.get(field)) for field in PARITY_REPORT_FIELDS}
    signature["warnings"] = sorted(
        str(warning)
        for warning in report.get("warnings", [])
        if isinstance(warning, str)
    )
    signature["objects"] = sorted(
        (_normalize_for_parity(item) for item in _list_field(report, "objects")),
        key=lambda item: (
            str(item.get("source_id", "")) if isinstance(item, Mapping) else "",
            str(item.get("sim_name", "")) if isinstance(item, Mapping) else "",
        ),
    )
    signature["cameras"] = sorted(
        (_normalize_for_parity(item) for item in _list_field(report, "cameras")),
        key=lambda item: (
            str(item.get("sim_name", "")) if isinstance(item, Mapping) else "",
            str(item.get("camera_id", "")) if isinstance(item, Mapping) else "",
        ),
    )
    return signature


def _list_field(report: Mapping[str, Any], field_name: str) -> list[Any]:
    value = report.get(field_name)
    return value if isinstance(value, list) else []


def _normalize_for_parity(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 10)
    if isinstance(value, Mapping):
        return {
            str(key): _normalize_for_parity(item)
            for key, item in sorted(value.items(), key=lambda entry: str(entry[0]))
        }
    if isinstance(value, list):
        return [_normalize_for_parity(item) for item in value]
    return value


def _first_difference(expected: Any, actual: Any, *, path: str) -> str | None:
    if isinstance(expected, Mapping) and isinstance(actual, Mapping):
        expected_keys = set(expected.keys())
        actual_keys = set(actual.keys())
        if expected_keys != actual_keys:
            missing = sorted(expected_keys - actual_keys)
            extra = sorted(actual_keys - expected_keys)
            return f"{path} keys differ: missing={missing}, extra={extra}"
        for key in sorted(expected_keys):
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
    loaded_reports: Sequence[tuple[WorkspaceParityInput, Mapping[str, Any]]],
) -> str | None:
    reference_label, reference_manifest = _camera_image_manifest(loaded_reports[0])
    if isinstance(reference_manifest, str):
        return reference_manifest
    for loaded_report in loaded_reports[1:]:
        label, manifest = _camera_image_manifest(loaded_report)
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
    loaded_report: tuple[WorkspaceParityInput, Mapping[str, Any]],
) -> tuple[str, dict[str, Any] | str]:
    item, report = loaded_report
    artifacts = report.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return item.label, f"{item.label} validation report has no artifacts object"
    directory_raw = artifacts.get("camera_screenshot_dir")
    if not isinstance(directory_raw, str) or not directory_raw.strip():
        return item.label, f"{item.label} validation report has no camera_screenshot_dir"
    directory = Path(directory_raw)
    image_paths = sorted(directory.glob("*.png")) if directory.exists() else []
    if not image_paths:
        return item.label, f"{item.label} has no camera PNG artifacts in {directory}"

    try:
        from PIL import Image
    except Exception as exc:
        return item.label, f"could not inspect camera artifacts: {exc}"

    images: list[dict[str, Any]] = []
    for path in image_paths:
        try:
            with Image.open(path) as image:
                size = image.size
        except Exception as exc:
            return item.label, f"invalid camera artifact {path}: {exc}"
        images.append({"name": path.name, "width": size[0], "height": size[1]})
    return item.label, {"images": images}
