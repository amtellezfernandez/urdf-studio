from __future__ import annotations

import json
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from html import escape
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException

from backend.core.paths import BASE_DIR
from backend.models.cam_to_sim import (
    CamToSimCaptureCoachResponse,
    CamToSimCaptureCoachTargetSummary,
    CamToSimCaptureReadinessResponse,
    CamToSimGeometryMeshRunRequest,
    CamToSimGeometryMeshRunResponse,
    CamToSimPhoneFrameResponse,
    CamToSimPhoneFrameStatsResponse,
    CamToSimR2R2RPrepareResponse,
    CamToSimReferenceSyncSummary,
    CamToSimRuntimePreviewFrame,
    CamToSimRuntimeResultResponse,
    CamToSimSessionCreateRequest,
    CamToSimSessionSnapshot,
    CamToSimStaticWorldTestRunRequest,
    CamToSimStaticWorldTestRunResponse,
    CamToSimStreamIngestRequest,
    CamToSimStreamIngestResponse,
    CamToSimStreamRecord,
)
from backend.services.cam_to_sim_params import (
    CAM_TO_SIM_FRAME_ID_NBYTES,
    CAM_TO_SIM_MAX_PHONE_FRAMES_PER_SESSION,
    CAM_TO_SIM_MAX_PHONE_FRAME_TOTAL_BYTES,
    CAM_TO_SIM_MAX_STREAM_RECORDS_PER_SESSION,
    CAM_TO_SIM_GEOMETRY_JOBS_DIRNAME,
    CAM_TO_SIM_GEOMETRY_JOB_CONFIG_FILENAME,
    CAM_TO_SIM_GEOMETRY_JOB_PROXY_URDF_FILENAME,
    CAM_TO_SIM_GEOMETRY_JOB_REPORT_FILENAME,
    CAM_TO_SIM_GEOMETRY_JOB_RESULT_FILENAME,
    CAM_TO_SIM_PHONE_FRAMES_DIRNAME,
    CAM_TO_SIM_PHONE_FRAMES_FILENAME,
    CAM_TO_SIM_PHONE_FRAME_MAX_BYTES,
    CAM_TO_SIM_PHONE_FRAME_SOURCE_MAX_LENGTH,
    CAM_TO_SIM_QR_IMAGE_SIZE_PX,
    CAM_TO_SIM_R2R2R_CAPTURE_READINESS_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_DEPTH_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_DIRNAME,
    CAM_TO_SIM_R2R2R_EXPORT_FRAMES_DIRNAME,
    CAM_TO_SIM_R2R2R_EXPORT_FRAMES_MANIFEST_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_IMU_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_INTRINSICS_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_MANIFEST_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_POSES_FILENAME,
    CAM_TO_SIM_R2R2R_REFERENCE_DIRNAME,
    CAM_TO_SIM_REFERENCE_COPY_DIRS,
    CAM_TO_SIM_REFERENCE_COPY_FILES,
    CAM_TO_SIM_REFERENCE_DIRNAME,
    CAM_TO_SIM_REFERENCE_SYNC_FILENAME,
    CAM_TO_SIM_SESSION_ACCESS_FILENAME,
    CAM_TO_SIM_SESSION_ACCESS_TOKEN_NBYTES,
    CAM_TO_SIM_SESSION_ID_NBYTES,
    CAM_TO_SIM_SESSION_METADATA_FILENAME,
    CAM_TO_SIM_SESSIONS_DIRNAME,
    CAM_TO_SIM_STREAM_ID_NBYTES,
    CAM_TO_SIM_STREAMS_FILENAME,
)

HTTP_NOT_FOUND = 404
HTTP_SERVER_ERROR = 500
HTTP_REQUEST_ENTITY_TOO_LARGE = 413
HTTP_UNPROCESSABLE_ENTITY = 422
JSON_INDENT_SPACES = 2
RUNTIME_PREVIEW_FRAME_COUNT = 3
PHONE_STATS_FPS_WINDOW_SEC = 3.0
PHONE_STATS_MAX_ANALYSIS_FRAMES = 240


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output_file:
        json.dump(payload, output_file, indent=JSON_INDENT_SPACES)
        output_file.write("\n")


def _read_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as input_file:
        return json.load(input_file)


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output_file:
        for row in rows:
            output_file.write(json.dumps(row))
            output_file.write("\n")


def _as_dict(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    return None


def _is_numeric(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _parse_iso_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _metadata_has_pose(metadata: dict[str, object]) -> bool:
    pose_value = _as_dict(metadata.get("pose"))
    return pose_value is not None and len(pose_value) > 0


def _metadata_has_depth(metadata: dict[str, object]) -> bool:
    depth_value = _as_dict(metadata.get("depth"))
    return bool(depth_value and depth_value.get("available") is True)


def _metadata_has_intrinsics(metadata: dict[str, object]) -> bool:
    intrinsics_value = _as_dict(metadata.get("camera_intrinsics"))
    if intrinsics_value is None:
        intrinsics_value = _as_dict(metadata.get("intrinsics"))
    if intrinsics_value is None:
        return False
    if _is_numeric(intrinsics_value.get("fx_px")) and _is_numeric(intrinsics_value.get("fy_px")):
        return True
    if _is_numeric(intrinsics_value.get("fx")) and _is_numeric(intrinsics_value.get("fy")):
        return True
    return len(intrinsics_value) > 0


def _metadata_has_calibrated_intrinsics(metadata: dict[str, object]) -> bool:
    intrinsics_value = _as_dict(metadata.get("camera_intrinsics"))
    if intrinsics_value is None:
        intrinsics_value = _as_dict(metadata.get("intrinsics"))
    if intrinsics_value is None:
        return False
    has_focal = (
        (_is_numeric(intrinsics_value.get("fx_px")) and _is_numeric(intrinsics_value.get("fy_px")))
        or (_is_numeric(intrinsics_value.get("fx")) and _is_numeric(intrinsics_value.get("fy")))
    )
    estimated_value = intrinsics_value.get("estimated")
    if isinstance(estimated_value, bool):
        return has_focal and not estimated_value
    return has_focal


def _metadata_has_imu(metadata: dict[str, object]) -> bool:
    imu_value = _as_dict(metadata.get("imu"))
    if imu_value is not None and len(imu_value) > 0:
        return True
    orientation_value = _as_dict(metadata.get("orientation"))
    motion_value = _as_dict(metadata.get("motion"))
    return bool((orientation_value and len(orientation_value) > 0) or (motion_value and len(motion_value) > 0))


def _capture_profile_from_metadata(metadata: dict[str, object]) -> str | None:
    profile_value = metadata.get("capture_profile")
    if isinstance(profile_value, str):
        normalized = profile_value.strip()
        if normalized:
            return normalized[:80]
    return None


def _capture_target_id_from_metadata(metadata: dict[str, object]) -> str | None:
    target_value = _as_dict(metadata.get("capture_target"))
    if target_value is not None:
        target_id_value = target_value.get("id")
        if isinstance(target_id_value, str) and target_id_value.strip():
            return target_id_value.strip()[:80]
    direct_value = metadata.get("capture_target_id")
    if isinstance(direct_value, str) and direct_value.strip():
        return direct_value.strip()[:80]
    return None


def _capture_target_label_from_metadata(metadata: dict[str, object]) -> str | None:
    target_value = _as_dict(metadata.get("capture_target"))
    if target_value is not None:
        label_value = target_value.get("label")
        if isinstance(label_value, str) and label_value.strip():
            return label_value.strip()[:80]
    direct_value = metadata.get("capture_target_label")
    if isinstance(direct_value, str) and direct_value.strip():
        return direct_value.strip()[:80]
    return None


def _normalize_primitive_family(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"box", "cube"}:
        return "box"
    if normalized in {"mug", "cup"}:
        return "mug"
    if normalized in {"sphere", "ball"}:
        return "sphere"
    if normalized in {"cylinder"}:
        return "cylinder"
    return None


def _capture_target_family_from_metadata(metadata: dict[str, object]) -> str | None:
    target_value = _as_dict(metadata.get("capture_target"))
    if target_value is not None:
        family = _normalize_primitive_family(target_value.get("family"))
        if family:
            return family
        family = _normalize_primitive_family(target_value.get("primitive_family"))
        if family:
            return family
    family = _normalize_primitive_family(metadata.get("capture_target_family"))
    if family:
        return family
    family = _normalize_primitive_family(metadata.get("capture_target_primitive_family"))
    if family:
        return family
    return None


def _stack_capture_from_metadata(metadata: dict[str, object]) -> dict[str, object] | None:
    stack_value = _as_dict(metadata.get("stack_capture"))
    if stack_value is not None:
        return stack_value
    return None


def _capture_scenario_from_metadata(metadata: dict[str, object]) -> str:
    scenario_value = metadata.get("capture_scenario")
    if isinstance(scenario_value, str):
        normalized = scenario_value.strip().lower()
        if normalized in {"single_object", "multi_objects", "stacked_objects"}:
            return normalized
    return "multi_objects"


def _build_stack_support_graph(
    manifest_payload: list[object],
) -> dict[str, object]:
    groups: dict[str, dict[str, dict[str, object]]] = {}
    phase_counts: dict[str, int] = {"scene_pass": 0, "object_pass": 0}

    for entry in manifest_payload:
        entry_value = _as_dict(entry)
        if entry_value is None:
            continue
        metadata = _as_dict(entry_value.get("metadata"))
        if metadata is None:
            continue
        capture_scenario = _capture_scenario_from_metadata(metadata)
        stack_meta = _stack_capture_from_metadata(metadata)
        if stack_meta is None and capture_scenario != "stacked_objects":
            continue
        enabled_value = stack_meta.get("enabled") if stack_meta is not None else False
        if enabled_value is not True and capture_scenario != "stacked_objects":
            continue
        phase_value = stack_meta.get("phase") if stack_meta is not None else None
        if isinstance(phase_value, str) and phase_value in phase_counts:
            phase_counts[phase_value] += 1
        group_id_value = stack_meta.get("stack_group_id") if stack_meta is not None else None
        if not isinstance(group_id_value, str) or not group_id_value.strip():
            continue
        group_id = group_id_value.strip()[:80]
        target_id = _capture_target_id_from_metadata(metadata) or "object_1"
        target_label = _capture_target_label_from_metadata(metadata) or target_id
        target_value = groups.setdefault(group_id, {}).setdefault(
            target_id,
            {
                "target_id": target_id,
                "target_label": target_label,
                "level": "middle",
                "order": None,
                "frame_count": 0,
            },
        )
        target_value["frame_count"] = int(target_value.get("frame_count", 0)) + 1
        level_value = None
        capture_target_value = _as_dict(metadata.get("capture_target"))
        if capture_target_value is not None:
            level_value = capture_target_value.get("level")
            order_value = capture_target_value.get("order")
            if isinstance(order_value, int) and order_value > 0:
                target_value["order"] = order_value
        if isinstance(level_value, str) and level_value in {"bottom", "middle", "top"}:
            target_value["level"] = level_value

    graph_groups: list[dict[str, object]] = []
    support_edges: list[dict[str, object]] = []
    support_hierarchy: list[dict[str, object]] = []
    contact_constraints: list[dict[str, object]] = []
    total_targets = 0
    for group_id, targets in groups.items():
        level_rank = {"bottom": 0, "middle": 1, "top": 2}
        ordered_targets = sorted(
            targets.values(),
            key=lambda item: (
                int(item.get("order")) if isinstance(item.get("order"), int) else 9999,
                level_rank.get(str(item.get("level", "middle")), 1),
                str(item.get("target_id", "")),
            ),
        )
        total_targets += len(ordered_targets)
        normalized_targets = [
            {
                "target_id": str(item.get("target_id", "")),
                "target_label": str(item.get("target_label", "")),
                "level": str(item.get("level", "middle")),
                "order": int(item.get("order")) if isinstance(item.get("order"), int) else None,
                "frame_count": int(item.get("frame_count", 0)),
            }
            for item in ordered_targets
        ]
        for index, item in enumerate(normalized_targets):
            frame_count = int(item.get("frame_count", 0))
            has_order = item.get("order") is not None
            level_value = str(item.get("level", "middle"))
            confidence = 0.45 + min(0.4, frame_count / 30.0 * 0.4)
            if has_order:
                confidence += 0.1
            if level_value in {"bottom", "top"}:
                confidence += 0.05
            confidence = max(0.0, min(0.99, confidence))
            support_hierarchy.append(
                {
                    "stack_group_id": group_id,
                    "target_id": item["target_id"],
                    "target_label": item["target_label"],
                    "level": level_value,
                    "order": item.get("order"),
                    "supported_by_target_id": (
                        normalized_targets[index - 1]["target_id"] if index > 0 else None
                    ),
                    "supports_target_id": (
                        normalized_targets[index + 1]["target_id"] if index < len(normalized_targets) - 1 else None
                    ),
                    "support_confidence": round(confidence, 3),
                }
            )
        graph_groups.append(
            {
                "stack_group_id": group_id,
                "targets": normalized_targets,
            }
        )
        for index in range(len(normalized_targets) - 1):
            support_edges.append(
                {
                    "stack_group_id": group_id,
                    "supports_target_id": normalized_targets[index]["target_id"],
                    "supported_target_id": normalized_targets[index + 1]["target_id"],
                }
            )
            lower_target = normalized_targets[index]
            upper_target = normalized_targets[index + 1]
            lower_frames = int(lower_target.get("frame_count", 0))
            upper_frames = int(upper_target.get("frame_count", 0))
            contact_confidence = max(0.35, min(0.98, 0.4 + min(lower_frames, upper_frames) / 25.0))
            contact_constraints.append(
                {
                    "stack_group_id": group_id,
                    "relation": "supported_by",
                    "object_a_target_id": upper_target["target_id"],
                    "object_b_target_id": lower_target["target_id"],
                    "object_a_face": "bottom",
                    "object_b_face": "top",
                    "constraint_type": "touching_planes",
                    "inference_sources": ["stack_order", "box_level", "frame_overlap"],
                    "confidence": round(contact_confidence, 3),
                }
            )

    return {
        "stack_mode_detected": len(graph_groups) > 0,
        "scene_pass_frame_count": phase_counts["scene_pass"],
        "object_pass_frame_count": phase_counts["object_pass"],
        "total_stack_targets": total_targets,
        "groups": graph_groups,
        "support_edges": support_edges,
        "support_hierarchy": support_hierarchy,
        "support_hierarchy_nodes_count": len(support_hierarchy),
        "contact_constraints": contact_constraints,
        "contact_constraints_count": len(contact_constraints),
        "occlusion_completion_mode": "primitive_box_faces",
        "contact_inference_enabled": len(contact_constraints) > 0,
    }


def _capture_scenario_summary(manifest_payload: list[object]) -> dict[str, object]:
    scenario_counts: dict[str, int] = {
        "single_object": 0,
        "multi_objects": 0,
        "stacked_objects": 0,
    }
    for entry in manifest_payload:
        entry_value = _as_dict(entry)
        if entry_value is None:
            continue
        metadata = _as_dict(entry_value.get("metadata"))
        if metadata is None:
            continue
        capture_scenario = _capture_scenario_from_metadata(metadata)
        scenario_counts[capture_scenario] = scenario_counts.get(capture_scenario, 0) + 1
    dominant = max(scenario_counts, key=lambda key: scenario_counts.get(key, 0))
    return {
        "dominant_capture_scenario": dominant,
        "capture_scenario_counts": scenario_counts,
    }


def _choose_primitive_family(label: str, object_families: list[str]) -> str:
    normalized_label = label.lower()
    normalized_families = [family.lower() for family in object_families]
    if "sphere" in normalized_label or "ball" in normalized_label:
        return "sphere"
    if "mug" in normalized_label or "cup" in normalized_label:
        return "mug"
    if "cylinder" in normalized_label:
        return "cylinder"
    if "box" in normalized_label or "cube" in normalized_label:
        return "box"
    # Fallback preference: box first for safer collision proxies on unknown labels.
    if "box" in normalized_families or "cube" in normalized_families:
        return "box"
    if "mug" in normalized_families:
        return "mug"
    if "cylinder" in normalized_families:
        return "cylinder"
    if "sphere" in normalized_families:
        return "sphere"
    return "box"


def _proxy_dimensions_for_family(family: str, level: str) -> dict[str, float]:
    if family == "sphere":
        return {"radius": 0.045}
    if family in {"mug", "cylinder"}:
        height = 0.10 if level != "top" else 0.09
        return {"radius": 0.04, "length": height}
    # box/cube default
    if level == "bottom":
        return {"x": 0.12, "y": 0.12, "z": 0.09}
    if level == "top":
        return {"x": 0.11, "y": 0.11, "z": 0.08}
    return {"x": 0.115, "y": 0.115, "z": 0.085}


def _render_proxy_urdf(proxy_objects: list[dict[str, object]]) -> str:
    lines: list[str] = [
        '<?xml version="1.0"?>',
        '<robot name="cam_to_sim_geometry_proxy">',
    ]
    for index, obj in enumerate(proxy_objects):
        link_name = f"proxy_{index + 1}"
        family = str(obj.get("primitive_family", "box"))
        dimensions = obj.get("dimensions")
        lines.append(f'  <link name="{link_name}">')
        lines.append("    <collision>")
        lines.append('      <origin xyz="0 0 0" rpy="0 0 0"/>')
        lines.append("      <geometry>")
        if family == "sphere" and isinstance(dimensions, dict):
            radius = float(dimensions.get("radius", 0.045))
            lines.append(f'        <sphere radius="{radius:.4f}"/>')
        elif family in {"mug", "cylinder"} and isinstance(dimensions, dict):
            radius = float(dimensions.get("radius", 0.04))
            length = float(dimensions.get("length", 0.10))
            lines.append(f'        <cylinder radius="{radius:.4f}" length="{length:.4f}"/>')
        else:
            if isinstance(dimensions, dict):
                size_x = float(dimensions.get("x", 0.11))
                size_y = float(dimensions.get("y", 0.11))
                size_z = float(dimensions.get("z", 0.08))
            else:
                size_x = 0.11
                size_y = 0.11
                size_z = 0.08
            lines.append(f'        <box size="{size_x:.4f} {size_y:.4f} {size_z:.4f}"/>')
        lines.append("      </geometry>")
        lines.append("    </collision>")
        lines.append("  </link>")
    lines.append("</robot>")
    return "\n".join(lines) + "\n"


class CamToSimService:
    def __init__(
        self,
        *,
        cam_to_sim_repo_dir: Path | None = None,
        real2render2real_repo_dir: Path | None = None,
    ) -> None:
        self._cam_to_sim_repo_dir = (
            cam_to_sim_repo_dir
            if cam_to_sim_repo_dir is not None
            else BASE_DIR / "cam-to-sim"
        )
        self._real2render2real_repo_dir = (
            real2render2real_repo_dir
            if real2render2real_repo_dir is not None
            else BASE_DIR.parent / "real2render2real"
        )
        self._sessions_dir = self._cam_to_sim_repo_dir / CAM_TO_SIM_SESSIONS_DIRNAME
        self._reference_dir = (
            self._cam_to_sim_repo_dir
            / CAM_TO_SIM_REFERENCE_DIRNAME
            / CAM_TO_SIM_R2R2R_REFERENCE_DIRNAME
        )

    def sync_reference_code(self) -> CamToSimReferenceSyncSummary:
        copied_paths: list[str] = []
        missing_paths: list[str] = []
        self._reference_dir.mkdir(parents=True, exist_ok=True)

        for relative_dir in CAM_TO_SIM_REFERENCE_COPY_DIRS:
            source_dir = self._real2render2real_repo_dir / relative_dir
            destination_dir = self._reference_dir / relative_dir
            if not source_dir.exists():
                missing_paths.append(relative_dir)
                continue
            shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)
            copied_paths.append(relative_dir)

        for relative_file in CAM_TO_SIM_REFERENCE_COPY_FILES:
            source_file = self._real2render2real_repo_dir / relative_file
            destination_file = self._reference_dir / relative_file
            if not source_file.exists():
                missing_paths.append(relative_file)
                continue
            destination_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, destination_file)
            copied_paths.append(relative_file)

        summary = CamToSimReferenceSyncSummary(
            synced_at_iso=_now_iso(),
            source_root=(
                self._public_artifact_path(self._real2render2real_repo_dir)
                or self._real2render2real_repo_dir.name
            ),
            destination_root=self._public_reference_root(),
            copied_paths=copied_paths,
            missing_paths=missing_paths,
        )
        _write_json(
            self._cam_to_sim_repo_dir / CAM_TO_SIM_REFERENCE_SYNC_FILENAME,
            summary.model_dump(mode="json"),
        )
        return summary

    @staticmethod
    def _build_qr_image_url(connect_url: str) -> str:
        size = CAM_TO_SIM_QR_IMAGE_SIZE_PX
        connect_label = escape(connect_url[-84:])
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            '<rect width="100%" height="100%" fill="#0f172a" rx="20" />'
            '<rect x="16" y="16" width="288" height="288" fill="#111827" stroke="#334155" stroke-width="4" rx="18" />'
            '<text x="50%" y="46%" text-anchor="middle" font-family="monospace" font-size="20" fill="#e2e8f0">Open Link</text>'
            '<text x="50%" y="56%" text-anchor="middle" font-family="monospace" font-size="12" fill="#94a3b8">Scan disabled for local-only security</text>'
            f'<text x="50%" y="70%" text-anchor="middle" font-family="monospace" font-size="10" fill="#64748b">{connect_label}</text>'
            '</svg>'
        )
        return f"data:image/svg+xml;charset=utf-8,{quote(svg)}"

    @staticmethod
    def _append_token_query(url: str, token: str) -> str:
        parsed = urlsplit(url)
        query_pairs = [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key != "token"
        ]
        query_pairs.append(("token", token))
        return urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urlencode(query_pairs),
                parsed.fragment,
            )
        )

    def _new_session_id(self) -> str:
        return secrets.token_hex(CAM_TO_SIM_SESSION_ID_NBYTES)

    def _new_session_access_token(self) -> str:
        return secrets.token_hex(CAM_TO_SIM_SESSION_ACCESS_TOKEN_NBYTES)

    def _new_stream_id(self) -> str:
        return secrets.token_hex(CAM_TO_SIM_STREAM_ID_NBYTES)

    def _session_dir(self, session_id: str) -> Path:
        return self._sessions_dir / session_id

    def _session_metadata_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_SESSION_METADATA_FILENAME

    def _session_access_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_SESSION_ACCESS_FILENAME

    def _session_streams_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_STREAMS_FILENAME

    def _session_phone_frames_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_PHONE_FRAMES_FILENAME

    def _session_phone_frames_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_PHONE_FRAMES_DIRNAME

    def _session_r2r2r_export_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_R2R2R_EXPORT_DIRNAME

    def _session_geometry_jobs_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / CAM_TO_SIM_GEOMETRY_JOBS_DIRNAME

    def get_session_access_token(self, session_id: str) -> str | None:
        self.get_session(session_id)
        access_path = self._session_access_path(session_id)
        if not access_path.exists():
            return None
        payload = _read_json(access_path)
        if not isinstance(payload, dict):
            return None
        token_value = payload.get("session_token")
        if not isinstance(token_value, str):
            return None
        normalized = token_value.strip()
        return normalized or None

    def _public_artifact_path(self, path: Path | str | None) -> str | None:
        if path is None:
            return None
        raw_path = Path(path)
        if not raw_path.is_absolute():
            return str(raw_path)
        try:
            return str(raw_path.relative_to(self._cam_to_sim_repo_dir))
        except ValueError:
            return raw_path.name

    def _public_reference_root(self) -> str:
        return self._public_artifact_path(self._reference_dir) or self._reference_dir.name

    def _find_geometry_job_dir(self, job_id: str, session_id: str | None = None) -> Path:
        job_id_value = job_id.strip()
        if not job_id_value:
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail="Unknown geometry job.")

        if session_id is not None:
            session_id_value = session_id.strip()
            self.get_session(session_id_value)
            session_job_dir = self._session_geometry_jobs_dir(session_id_value) / job_id_value
            if session_job_dir.exists():
                return session_job_dir
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail=f"Unknown geometry job '{job_id_value}'.")

        static_job_dir = self._cam_to_sim_repo_dir / CAM_TO_SIM_GEOMETRY_JOBS_DIRNAME / f"static-{job_id_value}"
        if static_job_dir.exists():
            return static_job_dir

        raise HTTPException(
            status_code=HTTP_UNPROCESSABLE_ENTITY,
            detail="session_id is required for live-capture geometry jobs.",
        )

    def _geometry_run_response_from_payload(
        self,
        *,
        geometry_job_dir: Path,
        report_path: Path,
        config_path: Path,
        report_payload: dict[str, object],
    ) -> CamToSimGeometryMeshRunResponse:
        def _as_str(value: object) -> str | None:
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    return normalized
            return None

        def _as_bool(value: object, fallback: bool = False) -> bool:
            if isinstance(value, bool):
                return value
            return fallback

        def _as_int(value: object, fallback: int = 0) -> int:
            if isinstance(value, int):
                return value
            return fallback

        def _as_list(value: object) -> list[object]:
            if isinstance(value, list):
                return value
            return []

        def _as_dict_list(value: object) -> list[dict[str, object]]:
            items = _as_list(value)
            return [item for item in items if isinstance(item, dict)]

        stack_support_graph_value = report_payload.get("stack_support_graph")
        stack_support_graph = (
            stack_support_graph_value
            if isinstance(stack_support_graph_value, dict)
            else {}
        )
        result_path_value = _as_str(report_payload.get("result_path"))
        result_payload: dict[str, object] = {}
        if result_path_value:
            result_file_path = Path(result_path_value)
            if result_file_path.exists():
                raw_result_payload = _read_json(result_file_path)
                if isinstance(raw_result_payload, dict):
                    result_payload = raw_result_payload

        proxy_objects = _as_dict_list(result_payload.get("proxy_objects"))
        support_hierarchy = _as_dict_list(result_payload.get("support_hierarchy"))
        contact_constraints = _as_dict_list(result_payload.get("contact_constraints"))
        if len(support_hierarchy) == 0:
            support_hierarchy = _as_dict_list(stack_support_graph.get("support_hierarchy"))
        if len(contact_constraints) == 0:
            contact_constraints = _as_dict_list(stack_support_graph.get("contact_constraints"))

        notes = [str(item) for item in _as_list(report_payload.get("notes"))]
        command_hints = [str(item) for item in _as_list(report_payload.get("command_hints"))]
        exact_mesh_requirements_missing = [
            str(item) for item in _as_list(report_payload.get("exact_mesh_requirements_missing"))
        ]
        return CamToSimGeometryMeshRunResponse(
            job_id=_as_str(report_payload.get("job_id")) or geometry_job_dir.name.replace("static-", ""),
            created_at_iso=_as_str(report_payload.get("created_at_iso")) or _now_iso(),
            mode=_as_str(report_payload.get("mode")) or "live_capture",
            status=_as_str(report_payload.get("status")) or "staged",
            session_id=_as_str(report_payload.get("session_id")),
            world_layout_label=_as_str(report_payload.get("world_layout_label")),
            reconstruction_mode=_as_str(report_payload.get("reconstruction_mode")) or "proxy_geometry",
            geometry_job_dir=self._public_artifact_path(geometry_job_dir) or geometry_job_dir.name,
            report_path=self._public_artifact_path(report_path) or report_path.name,
            config_path=self._public_artifact_path(config_path) or config_path.name,
            ready_for_geometry_reconstruction=_as_bool(report_payload.get("ready_for_geometry_reconstruction")),
            ready_for_r2r2r_parity=_as_bool(report_payload.get("ready_for_r2r2r_parity")),
            stack_mode_detected=_as_bool(report_payload.get("stack_mode_detected")),
            stack_support_edges_count=_as_int(report_payload.get("stack_support_edges_count"), 0),
            occlusion_completion_mode=_as_str(report_payload.get("occlusion_completion_mode")),
            support_hierarchy_nodes_count=_as_int(
                report_payload.get("support_hierarchy_nodes_count"),
                len(support_hierarchy),
            ),
            contact_constraints_count=_as_int(
                report_payload.get("contact_constraints_count"),
                len(contact_constraints),
            ),
            contact_inference_enabled=_as_bool(report_payload.get("contact_inference_enabled")),
            dominant_capture_scenario=_as_str(report_payload.get("dominant_capture_scenario")),
            executed_in_ui=_as_bool(report_payload.get("executed_in_ui")),
            completed_at_iso=_as_str(report_payload.get("completed_at_iso")),
            result_path=self._public_artifact_path(result_path_value),
            proxy_urdf_path=self._public_artifact_path(_as_str(report_payload.get("proxy_urdf_path"))),
            proxy_count=_as_int(report_payload.get("proxy_count"), 0),
            proxy_objects=proxy_objects,
            support_hierarchy=support_hierarchy,
            contact_constraints=contact_constraints,
            exact_mesh_ready=_as_bool(report_payload.get("exact_mesh_ready")),
            exact_mesh_requirements_missing=exact_mesh_requirements_missing,
            notes=notes,
            command_hints=command_hints,
        )

    def _validate_frame_filename(self, filename: str) -> str:
        normalized = filename.strip()
        if not normalized:
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail="Unknown frame file.")
        if Path(normalized).name != normalized:
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail="Unknown frame file.")
        return normalized

    def get_phone_frame_file_path(self, session_id: str, filename: str) -> Path:
        self.get_session(session_id)
        normalized_filename = self._validate_frame_filename(filename)
        frame_path = self._session_phone_frames_dir(session_id) / normalized_filename
        if not frame_path.exists():
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail="Unknown frame file.")
        return frame_path

    def _new_frame_id(self) -> str:
        return secrets.token_hex(CAM_TO_SIM_FRAME_ID_NBYTES)

    def create_session(
        self,
        req: CamToSimSessionCreateRequest,
        *,
        base_url: str,
    ) -> CamToSimSessionSnapshot:
        if not self._cam_to_sim_repo_dir.exists():
            raise HTTPException(
                status_code=HTTP_SERVER_ERROR,
                detail=f"cam-to-sim repository missing at {self._cam_to_sim_repo_dir}",
            )

        reference_sync = self.sync_reference_code()

        session_id = self._new_session_id()
        session_access_token = self._new_session_access_token()
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=False)

        device_label = req.device_label.strip()
        if not device_label:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="device_label cannot be empty.",
            )

        normalized_base_url = base_url.rstrip("/")
        connect_url = self._append_token_query(
            f"{normalized_base_url}/cam-to-sim/connect/{session_id}",
            session_access_token,
        )
        ingest_stream_url = self._append_token_query(
            f"{normalized_base_url}/cam-to-sim/sessions/{session_id}/stream",
            session_access_token,
        )
        snapshot = CamToSimSessionSnapshot(
            session_id=session_id,
            created_at_iso=_now_iso(),
            device_label=device_label,
            connect_url=connect_url,
            ingest_stream_url=ingest_stream_url,
            qr_image_url=self._build_qr_image_url(connect_url),
            reference_sync=reference_sync,
        )
        _write_json(self._session_metadata_path(session_id), snapshot.model_dump(mode="json"))
        _write_json(
            self._session_access_path(session_id),
            {"session_token": session_access_token},
        )
        _write_json(self._session_streams_path(session_id), [])
        _write_json(self._session_phone_frames_path(session_id), [])
        return snapshot

    def run_static_world_test(self, req: CamToSimStaticWorldTestRunRequest) -> CamToSimStaticWorldTestRunResponse:
        world_layout_label = req.world_layout_label.strip()
        if not world_layout_label:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="world_layout_label cannot be empty.",
            )

        run_id = secrets.token_hex(8)
        ready_for_static_world_checks = True
        ready_for_full_runtime = req.camera_count > 0 and req.camera_pose_defined
        notes: list[str] = [
            "Static world uploaded and staged for test checks.",
        ]
        if req.camera_count == 0:
            notes.append("No cameras loaded yet; allowed for static-world validation.")
        elif not req.camera_pose_defined:
            notes.append("Camera loaded but pose undefined; full runtime remains blocked.")
        if req.world_layout_url:
            notes.append("World source loaded from URL.")

        return CamToSimStaticWorldTestRunResponse(
            run_id=run_id,
            created_at_iso=_now_iso(),
            world_layout_label=world_layout_label,
            camera_count=req.camera_count,
            camera_pose_defined=req.camera_pose_defined,
            ready_for_static_world_checks=ready_for_static_world_checks,
            ready_for_full_runtime=ready_for_full_runtime,
            notes=notes,
        )

    def run_geometry_mesh_job(self, req: CamToSimGeometryMeshRunRequest) -> CamToSimGeometryMeshRunResponse:
        mode = req.mode.strip().lower()
        if mode not in {"live_capture", "static_world_test"}:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="mode must be one of: live_capture, static_world_test.",
            )
        reconstruction_mode = req.reconstruction_mode.strip().lower()
        if reconstruction_mode not in {"proxy_geometry", "exact_mesh"}:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="reconstruction_mode must be one of: proxy_geometry, exact_mesh.",
            )

        job_id = secrets.token_hex(8)
        created_at_iso = _now_iso()
        object_families = [name.strip() for name in req.object_families if isinstance(name, str) and name.strip()]
        if len(object_families) == 0:
            object_families = ["cube", "sphere", "box", "mug"]

        status = "staged"
        notes: list[str] = []
        command_hints: list[str] = []
        ready_for_geometry_reconstruction = False
        ready_for_r2r2r_parity = False
        stack_mode_detected = False
        stack_support_edges_count = 0
        occlusion_completion_mode: str | None = None
        support_hierarchy_nodes_count = 0
        contact_constraints_count = 0
        contact_inference_enabled = False
        dominant_capture_scenario: str | None = None
        exact_mesh_requirements_missing: list[str] = []
        exact_mesh_ready = False
        world_layout_label = req.world_layout_label.strip() if isinstance(req.world_layout_label, str) else None
        session_id: str | None = None
        geometry_job_dir: Path
        reference_root = self._public_reference_root()
        internal_reference_root = str(self._reference_dir)

        config_payload: dict[str, object] = {
            "job_id": job_id,
            "created_at_iso": created_at_iso,
            "mode": mode,
            "reconstruction_mode": reconstruction_mode,
            "prioritize_primitives": req.prioritize_primitives,
            "ignore_textures": req.ignore_textures,
            "object_families": object_families,
            "reference_root": internal_reference_root,
        }

        if mode == "live_capture":
            if not isinstance(req.session_id, str) or not req.session_id.strip():
                raise HTTPException(
                    status_code=HTTP_UNPROCESSABLE_ENTITY,
                    detail="session_id is required for live_capture mode.",
                )
            session_id = req.session_id.strip()
            self.get_session(session_id)
            prepared = self.prepare_r2r2r_export(session_id)
            readiness = self.get_capture_readiness(session_id)
            capture_coach = self.get_capture_coach(session_id)
            frames_manifest_path = self._session_phone_frames_path(session_id)
            raw_manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
            manifest_payload: list[object] = raw_manifest_payload if isinstance(raw_manifest_payload, list) else []
            stack_support_graph = _build_stack_support_graph(manifest_payload)
            scenario_summary = _capture_scenario_summary(manifest_payload)
            dominant_capture_scenario_value = scenario_summary.get("dominant_capture_scenario")
            if isinstance(dominant_capture_scenario_value, str) and dominant_capture_scenario_value.strip():
                dominant_capture_scenario = dominant_capture_scenario_value.strip()
            stack_mode_detected = bool(stack_support_graph.get("stack_mode_detected") is True)
            stack_support_edges = stack_support_graph.get("support_edges")
            if isinstance(stack_support_edges, list):
                stack_support_edges_count = len(stack_support_edges)
            hierarchy_count_value = stack_support_graph.get("support_hierarchy_nodes_count")
            if isinstance(hierarchy_count_value, int) and hierarchy_count_value >= 0:
                support_hierarchy_nodes_count = hierarchy_count_value
            contact_count_value = stack_support_graph.get("contact_constraints_count")
            if isinstance(contact_count_value, int) and contact_count_value >= 0:
                contact_constraints_count = contact_count_value
            contact_inference_value = stack_support_graph.get("contact_inference_enabled")
            if isinstance(contact_inference_value, bool):
                contact_inference_enabled = contact_inference_value
            occlusion_mode_value = stack_support_graph.get("occlusion_completion_mode")
            if isinstance(occlusion_mode_value, str) and occlusion_mode_value.strip():
                occlusion_completion_mode = occlusion_mode_value.strip()

            geometry_jobs_dir = self._session_geometry_jobs_dir(session_id)
            geometry_jobs_dir.mkdir(parents=True, exist_ok=True)
            geometry_job_dir = geometry_jobs_dir / job_id
            geometry_job_dir.mkdir(parents=True, exist_ok=False)

            ready_for_geometry_reconstruction = prepared.frame_count > 0 and readiness.ready_for_real_to_sim
            ready_for_r2r2r_parity = readiness.ready_for_r2r2r_parity
            if reconstruction_mode == "exact_mesh":
                if prepared.frame_count <= 0:
                    exact_mesh_requirements_missing.append("rgb_frames")
                if not readiness.has_pose_data:
                    exact_mesh_requirements_missing.append("camera_pose")
                if not readiness.has_intrinsics_data:
                    exact_mesh_requirements_missing.append("camera_intrinsics")
                if not readiness.has_depth_data:
                    exact_mesh_requirements_missing.append("depth_data")
                if not readiness.has_calibrated_intrinsics_data:
                    exact_mesh_requirements_missing.append("calibrated_intrinsics")
                exact_mesh_ready = len(exact_mesh_requirements_missing) == 0
                ready_for_geometry_reconstruction = exact_mesh_ready
                ready_for_r2r2r_parity = exact_mesh_ready
                if exact_mesh_ready:
                    status = "staged_exact_mesh"
                else:
                    status = "blocked_missing_exact_signals"
            elif not ready_for_geometry_reconstruction:
                status = "blocked_missing_capture_signals"
            elif ready_for_r2r2r_parity:
                status = "staged_r2r2r_parity"
            else:
                status = "staged_geometry_first"

            if reconstruction_mode == "exact_mesh":
                notes.append("Exact mesh mode selected. Primitive proxies are disabled for this run.")
            else:
                notes.append("Geometry-first pipeline ignores textures and prioritizes solid object shape.")
            notes.append(
                f"Object-first capture targets tracked: {len(capture_coach.targets)} "
                f"(completed: {capture_coach.completed_targets})."
            )
            if dominant_capture_scenario:
                notes.append(f"Capture scenario detected: {dominant_capture_scenario}.")
            if stack_support_graph.get("stack_mode_detected") is True:
                notes.append(
                    "Stacked-objects capture detected. Support graph and occlusion-aware box completion are enabled."
                )
            if contact_inference_enabled:
                notes.append(
                    f"Contact constraints inferred: {contact_constraints_count} "
                    f"(hierarchy nodes: {support_hierarchy_nodes_count})."
                )
            if not readiness.ready_for_real_to_sim:
                notes.append(
                    "Capture is missing pose/intrinsics signals; mesh generation quality will be limited."
                )
            if not readiness.ready_for_r2r2r_parity:
                notes.append("Depth/LiDAR or calibrated intrinsics are still missing for full R2R2R parity.")
            if reconstruction_mode == "exact_mesh" and len(exact_mesh_requirements_missing) > 0:
                notes.append(
                    "Exact mesh requirements missing: "
                    + ", ".join(exact_mesh_requirements_missing)
                )

            if reconstruction_mode == "exact_mesh":
                command_hints = [
                    f"cd {reference_root}",
                    "conda activate r2r2r_sugar",
                    f"# frames: {prepared.frames_dir}",
                    f"# poses: {prepared.poses_path}",
                    f"# intrinsics: {prepared.intrinsics_path or 'missing'}",
                    f"# depth: {prepared.depth_path or 'missing'}",
                    "# run exact mesh reconstruction (no primitive proxy fallback)",
                ]
            else:
                command_hints = [
                    f"cd {reference_root}",
                    "conda activate r2r2r_sugar",
                    f"# frames: {prepared.frames_dir}",
                    f"# poses: {prepared.poses_path}",
                    f"# intrinsics: {prepared.intrinsics_path or 'missing'}",
                    f"# depth: {prepared.depth_path or 'missing'}",
                    "# run SuGaR/geometry reconstruction with texture disabled or ignored",
                ]
            config_payload.update(
                {
                    "session_id": session_id,
                    "capture_readiness": readiness.model_dump(mode='json'),
                    "capture_coach": capture_coach.model_dump(mode='json'),
                    "stack_support_graph": stack_support_graph,
                    "capture_scenario_summary": scenario_summary,
                    "prepare_export": prepared.model_dump(mode='json'),
                }
            )
        else:
            geometry_root = self._cam_to_sim_repo_dir / CAM_TO_SIM_GEOMETRY_JOBS_DIRNAME
            geometry_root.mkdir(parents=True, exist_ok=True)
            geometry_job_dir = geometry_root / f"static-{job_id}"
            geometry_job_dir.mkdir(parents=True, exist_ok=False)

            ready_for_geometry_reconstruction = isinstance(world_layout_label, str) and len(world_layout_label) > 0
            ready_for_r2r2r_parity = False
            if reconstruction_mode == "exact_mesh":
                ready_for_geometry_reconstruction = False
                exact_mesh_ready = False
                exact_mesh_requirements_missing = ["live_capture_required"]
                status = "blocked_exact_mesh_requires_live_capture"
                notes.append("Exact mesh mode requires live capture with depth + calibrated intrinsics + pose.")
            else:
                status = "staged_static_world" if ready_for_geometry_reconstruction else "blocked_missing_world_layout"
                notes.append("Static-world geometry staging created.")
                notes.append("This path is for primitive/object geometry checks before live capture.")
            if not ready_for_geometry_reconstruction and reconstruction_mode != "exact_mesh":
                notes.append("world_layout_label is required to stage static geometry mesh work.")

            command_hints = [
                f"cd {reference_root}",
                "# load static world objects and fit primitive geometry proxies (cube/sphere/box/mug)",
                "# skip texture/color reconstruction",
            ]
            config_payload.update(
                {
                    "world_layout_label": world_layout_label,
                }
            )

        report_payload = {
            "job_id": job_id,
            "created_at_iso": created_at_iso,
            "mode": mode,
            "reconstruction_mode": reconstruction_mode,
            "status": status,
            "session_id": session_id,
            "world_layout_label": world_layout_label,
            "ready_for_geometry_reconstruction": ready_for_geometry_reconstruction,
            "ready_for_r2r2r_parity": ready_for_r2r2r_parity,
            "stack_mode_detected": stack_mode_detected,
            "stack_support_edges_count": stack_support_edges_count,
            "occlusion_completion_mode": occlusion_completion_mode,
            "support_hierarchy_nodes_count": support_hierarchy_nodes_count,
            "contact_constraints_count": contact_constraints_count,
            "contact_inference_enabled": contact_inference_enabled,
            "dominant_capture_scenario": dominant_capture_scenario,
            "prioritize_primitives": req.prioritize_primitives,
            "ignore_textures": req.ignore_textures,
            "object_families": object_families,
            "exact_mesh_ready": exact_mesh_ready,
            "exact_mesh_requirements_missing": exact_mesh_requirements_missing,
            "notes": notes,
            "command_hints": command_hints,
        }
        if mode == "live_capture":
            report_payload["capture_targets"] = [
                target.model_dump(mode="json")
                for target in capture_coach.targets
            ]
            report_payload["stack_support_graph"] = stack_support_graph

        config_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_CONFIG_FILENAME
        report_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_REPORT_FILENAME
        _write_json(config_path, config_payload)
        _write_json(report_path, report_payload)

        return self._geometry_run_response_from_payload(
            geometry_job_dir=geometry_job_dir,
            report_path=report_path,
            config_path=config_path,
            report_payload=report_payload,
        )

    def execute_geometry_mesh_job(
        self,
        *,
        job_id: str,
        session_id: str | None = None,
        force: bool = False,
    ) -> CamToSimGeometryMeshRunResponse:
        geometry_job_dir = self._find_geometry_job_dir(job_id, session_id=session_id)
        report_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_REPORT_FILENAME
        config_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_CONFIG_FILENAME
        if not report_path.exists() or not config_path.exists():
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail="Geometry job artifacts are missing.")

        report_raw = _read_json(report_path)
        config_raw = _read_json(config_path)
        report_payload = report_raw if isinstance(report_raw, dict) else {}
        config_payload = config_raw if isinstance(config_raw, dict) else {}
        reconstruction_mode_value = report_payload.get("reconstruction_mode")
        reconstruction_mode = (
            reconstruction_mode_value
            if isinstance(reconstruction_mode_value, str) and reconstruction_mode_value.strip()
            else "proxy_geometry"
        )

        ready_value = report_payload.get("ready_for_geometry_reconstruction")
        ready_for_geometry = bool(ready_value is True)
        if not ready_for_geometry and not force:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="Geometry job is not ready. Capture quality gate is not satisfied.",
            )

        existing_status_value = report_payload.get("status")
        existing_status = existing_status_value if isinstance(existing_status_value, str) else ""
        result_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_RESULT_FILENAME
        proxy_urdf_path = geometry_job_dir / CAM_TO_SIM_GEOMETRY_JOB_PROXY_URDF_FILENAME
        has_existing_outputs = result_path.exists() and (
            reconstruction_mode == "exact_mesh" or proxy_urdf_path.exists()
        )
        if existing_status.startswith("completed") and has_existing_outputs:
            return self._geometry_run_response_from_payload(
                geometry_job_dir=geometry_job_dir,
                report_path=report_path,
                config_path=config_path,
                report_payload=report_payload,
            )

        if reconstruction_mode == "exact_mesh":
            completed_at_iso = _now_iso()
            result_payload = {
                "job_id": report_payload.get("job_id"),
                "executed_at_iso": completed_at_iso,
                "mode": report_payload.get("mode"),
                "reconstruction_mode": "exact_mesh",
                "mesh_count": 0,
                "notes": [
                    "Exact mesh execution path prepared.",
                    "External dense reconstruction engine must write final meshes into this job directory.",
                ],
            }
            _write_json(result_path, result_payload)
            notes_raw = report_payload.get("notes")
            notes = [str(item) for item in notes_raw] if isinstance(notes_raw, list) else []
            notes.append("Exact mesh execution staged. Awaiting external dense reconstruction output.")
            report_payload["status"] = "completed_exact_mesh_staged"
            report_payload["executed_in_ui"] = True
            report_payload["completed_at_iso"] = completed_at_iso
            report_payload["result_path"] = str(result_path)
            report_payload["proxy_urdf_path"] = None
            report_payload["proxy_count"] = 0
            report_payload["notes"] = notes
            _write_json(report_path, report_payload)
            return self._geometry_run_response_from_payload(
                geometry_job_dir=geometry_job_dir,
                report_path=report_path,
                config_path=config_path,
                report_payload=report_payload,
            )

        object_families_raw = config_payload.get("object_families")
        object_families = (
            [str(item) for item in object_families_raw if isinstance(item, str)]
            if isinstance(object_families_raw, list)
            else ["box", "sphere", "mug"]
        )
        stack_support_graph_value = report_payload.get("stack_support_graph")
        stack_support_graph = stack_support_graph_value if isinstance(stack_support_graph_value, dict) else {}
        hierarchy_lookup: dict[str, dict[str, object]] = {}
        hierarchy_items = stack_support_graph.get("support_hierarchy")
        if isinstance(hierarchy_items, list):
            for item in hierarchy_items:
                item_value = item if isinstance(item, dict) else None
                if item_value is None:
                    continue
                target_id_value = item_value.get("target_id")
                if isinstance(target_id_value, str) and target_id_value.strip():
                    hierarchy_lookup[target_id_value.strip()] = item_value

        proxy_objects: list[dict[str, object]] = []
        capture_targets_raw = report_payload.get("capture_targets")
        capture_targets = capture_targets_raw if isinstance(capture_targets_raw, list) else []
        for index, target in enumerate(capture_targets):
            target_value = target if isinstance(target, dict) else None
            if target_value is None:
                continue
            target_id = str(target_value.get("target_id") or f"object_{index + 1}")
            target_label = str(target_value.get("target_label") or target_id)
            hierarchy_value = hierarchy_lookup.get(target_id, {})
            level_value = hierarchy_value.get("level")
            level = level_value if isinstance(level_value, str) and level_value.strip() else "middle"
            order_value = hierarchy_value.get("order")
            order = order_value if isinstance(order_value, int) and order_value > 0 else index + 1
            target_family = _normalize_primitive_family(target_value.get("primitive_family"))
            family = target_family or _choose_primitive_family(target_label, object_families)
            dimensions = _proxy_dimensions_for_family(family, level)
            proxy_objects.append(
                {
                    "target_id": target_id,
                    "target_label": target_label,
                    "primitive_family": family,
                    "dimensions": dimensions,
                    "level": level,
                    "order": order,
                }
            )

        if len(proxy_objects) == 0:
            world_layout_label_value = report_payload.get("world_layout_label")
            fallback_label = (
                world_layout_label_value
                if isinstance(world_layout_label_value, str) and world_layout_label_value.strip()
                else "object_1"
            )
            fallback_family = _choose_primitive_family(fallback_label, object_families)
            proxy_objects.append(
                {
                    "target_id": "object_1",
                    "target_label": fallback_label,
                    "primitive_family": fallback_family,
                    "dimensions": _proxy_dimensions_for_family(fallback_family, "middle"),
                    "level": "middle",
                    "order": 1,
                }
            )

        completed_at_iso = _now_iso()
        result_payload = {
            "job_id": report_payload.get("job_id"),
            "executed_at_iso": completed_at_iso,
            "mode": report_payload.get("mode"),
            "proxy_count": len(proxy_objects),
            "proxy_objects": proxy_objects,
            "support_hierarchy": stack_support_graph.get("support_hierarchy", []),
            "contact_constraints": stack_support_graph.get("contact_constraints", []),
            "occlusion_completion_mode": report_payload.get("occlusion_completion_mode"),
            "notes": [
                "UI-driven geometry proxy generation completed.",
                "Generated primitive proxy URDF for immediate runtime use.",
            ],
        }
        _write_json(result_path, result_payload)
        proxy_urdf_text = _render_proxy_urdf(proxy_objects)
        proxy_urdf_path.write_text(proxy_urdf_text, encoding="utf-8")

        notes_raw = report_payload.get("notes")
        notes = [str(item) for item in notes_raw] if isinstance(notes_raw, list) else []
        notes.append("Geometry proxy executed in UI. Output artifacts are ready.")
        report_payload["status"] = "completed_ui_geometry_proxy"
        report_payload["executed_in_ui"] = True
        report_payload["completed_at_iso"] = completed_at_iso
        report_payload["result_path"] = str(result_path)
        report_payload["proxy_urdf_path"] = str(proxy_urdf_path)
        report_payload["proxy_count"] = len(proxy_objects)
        report_payload["notes"] = notes
        _write_json(report_path, report_payload)

        return self._geometry_run_response_from_payload(
            geometry_job_dir=geometry_job_dir,
            report_path=report_path,
            config_path=config_path,
            report_payload=report_payload,
        )

    def get_session(self, session_id: str) -> CamToSimSessionSnapshot:
        session_metadata_path = self._session_metadata_path(session_id)
        if not session_metadata_path.exists():
            raise HTTPException(status_code=HTTP_NOT_FOUND, detail=f"Unknown session '{session_id}'.")
        payload = _read_json(session_metadata_path)
        return CamToSimSessionSnapshot.model_validate(payload)

    def register_stream(
        self,
        session_id: str,
        req: CamToSimStreamIngestRequest,
    ) -> CamToSimStreamIngestResponse:
        self.get_session(session_id)
        streams_path = self._session_streams_path(session_id)
        existing_payload = _read_json(streams_path) if streams_path.exists() else []
        if not isinstance(existing_payload, list):
            existing_payload = []

        normalized_stream_url = req.video_stream_url.strip()
        if not normalized_stream_url:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="video_stream_url cannot be empty.",
            )
        normalized_source = req.source.strip()
        if not normalized_source:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail="source cannot be empty.",
            )
        stream_record = CamToSimStreamRecord(
            stream_id=self._new_stream_id(),
            received_at_iso=_now_iso(),
            video_stream_url=normalized_stream_url,
            source=normalized_source,
            note=req.note.strip() if isinstance(req.note, str) and req.note.strip() else None,
        )
        if len(existing_payload) >= CAM_TO_SIM_MAX_STREAM_RECORDS_PER_SESSION:
            raise HTTPException(
                status_code=HTTP_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    "cam-to-sim stream records exceeded the configured per-session limit: "
                    f"{len(existing_payload)} >= {CAM_TO_SIM_MAX_STREAM_RECORDS_PER_SESSION}"
                ),
            )
        existing_payload.append(stream_record.model_dump(mode="json"))
        _write_json(streams_path, existing_payload)

        session_dir = self._session_dir(session_id)
        public_session_dir = self._public_artifact_path(session_dir) or session_dir.name
        reference_root = self._public_reference_root()
        workflow_command_preview = (
            f"python {reference_root}/scripts/run.py "
            f"# stream={stream_record.video_stream_url} session={public_session_dir}"
        )
        return CamToSimStreamIngestResponse(
            session_id=session_id,
            accepted_count=len(existing_payload),
            last_stream=stream_record,
            workflow_command_preview=workflow_command_preview,
        )

    def register_phone_frame(
        self,
        session_id: str,
        *,
        frame_bytes: bytes,
        content_type: str,
        source: str,
        frame_metadata: dict[str, object] | None = None,
    ) -> CamToSimPhoneFrameResponse:
        self.get_session(session_id)
        normalized_source = source.strip()[:CAM_TO_SIM_PHONE_FRAME_SOURCE_MAX_LENGTH] or "phone-camera"
        if len(frame_bytes) == 0:
            raise HTTPException(status_code=HTTP_UNPROCESSABLE_ENTITY, detail="phone frame body is empty.")
        if len(frame_bytes) > CAM_TO_SIM_PHONE_FRAME_MAX_BYTES:
            raise HTTPException(
                status_code=HTTP_UNPROCESSABLE_ENTITY,
                detail=f"phone frame body exceeds {CAM_TO_SIM_PHONE_FRAME_MAX_BYTES} bytes.",
            )

        content_type_lower = content_type.strip().lower()
        extension = "png" if "png" in content_type_lower else "jpg"
        frame_id = self._new_frame_id()
        received_at_iso = _now_iso()

        frames_manifest_path = self._session_phone_frames_path(session_id)
        manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
        if not isinstance(manifest_payload, list):
            manifest_payload = []
        existing_total_bytes = sum(
            int(item.get("size_bytes", 0))
            for item in manifest_payload
            if isinstance(item, dict) and isinstance(item.get("size_bytes", 0), int)
        )
        if len(manifest_payload) >= CAM_TO_SIM_MAX_PHONE_FRAMES_PER_SESSION:
            raise HTTPException(
                status_code=HTTP_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    "cam-to-sim frame count exceeded the configured per-session limit: "
                    f"{len(manifest_payload)} >= {CAM_TO_SIM_MAX_PHONE_FRAMES_PER_SESSION}"
                ),
            )
        if existing_total_bytes + len(frame_bytes) > CAM_TO_SIM_MAX_PHONE_FRAME_TOTAL_BYTES:
            raise HTTPException(
                status_code=HTTP_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    "cam-to-sim frame storage exceeded the configured per-session byte limit: "
                    f"{existing_total_bytes + len(frame_bytes)} > {CAM_TO_SIM_MAX_PHONE_FRAME_TOTAL_BYTES}"
                ),
            )

        frame_dir = self._session_phone_frames_dir(session_id)
        frame_dir.mkdir(parents=True, exist_ok=True)
        frame_path = frame_dir / f"{frame_id}.{extension}"
        frame_path.write_bytes(frame_bytes)
        manifest_record: dict[str, object] = {
            "frame_id": frame_id,
            "received_at_iso": received_at_iso,
            "source": normalized_source,
            "content_type": content_type_lower or "application/octet-stream",
            "size_bytes": len(frame_bytes),
            "filename": frame_path.name,
        }
        if frame_metadata:
            manifest_record["metadata"] = frame_metadata
        manifest_payload.append(manifest_record)
        _write_json(frames_manifest_path, manifest_payload)

        return CamToSimPhoneFrameResponse(
            session_id=session_id,
            frame_id=frame_id,
            frame_count=len(manifest_payload),
            received_at_iso=received_at_iso,
        )

    def get_phone_frame_stats(self, session_id: str) -> CamToSimPhoneFrameStatsResponse:
        self.get_session(session_id)
        frames_manifest_path = self._session_phone_frames_path(session_id)
        manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
        if not isinstance(manifest_payload, list):
            manifest_payload = []

        last_received_at_iso: str | None = None
        latest_source: str | None = None
        latest_client_time_ms: int | None = None
        ingest_fps = 0.0
        approx_latency_ms: int | None = None
        dropped_frames_estimate = 0
        latest_capture_interval_ms: int | None = None
        latest_jpeg_quality: float | None = None
        latest_max_width_px: int | None = None
        capture_profile: str | None = None
        has_orientation_data = False
        has_motion_data = False
        has_pose_data = False
        has_depth_data = False
        has_intrinsics_data = False
        has_calibrated_intrinsics_data = False
        has_imu_data = False

        if manifest_payload and isinstance(manifest_payload[-1], dict):
            last_frame = manifest_payload[-1]
            received_value = last_frame.get("received_at_iso")
            source_value = last_frame.get("source")
            last_received_at_iso = received_value if isinstance(received_value, str) else None
            latest_source = source_value if isinstance(source_value, str) else None
            last_metadata = _as_dict(last_frame.get("metadata"))
            if last_metadata is not None:
                capture_profile = _capture_profile_from_metadata(last_metadata)
                if capture_profile is None:
                    capture_profile = "qr-web-lite"
                client_time_value = last_metadata.get("client_time_ms")
                if isinstance(client_time_value, int) and client_time_value >= 0:
                    latest_client_time_ms = client_time_value
                stream_tuning_value = _as_dict(last_metadata.get("stream_tuning"))
                if stream_tuning_value is not None:
                    interval_value = stream_tuning_value.get("capture_interval_ms")
                    quality_value = stream_tuning_value.get("jpeg_quality")
                    max_width_value = stream_tuning_value.get("max_width_px")
                    if isinstance(interval_value, int) and interval_value > 0:
                        latest_capture_interval_ms = interval_value
                    if isinstance(quality_value, (int, float)) and 0.0 <= float(quality_value) <= 1.0:
                        latest_jpeg_quality = round(float(quality_value), 3)
                    if isinstance(max_width_value, int) and max_width_value > 0:
                        latest_max_width_px = max_width_value

        analysis_window_payload = manifest_payload[-PHONE_STATS_MAX_ANALYSIS_FRAMES:]
        now_utc = datetime.now(timezone.utc)
        recent_frame_count = 0
        recent_cutoff = now_utc.timestamp() - PHONE_STATS_FPS_WINDOW_SEC
        previous_sequence: int | None = None

        for entry in analysis_window_payload:
            entry_value = _as_dict(entry)
            if entry_value is None:
                continue
            received_at = _parse_iso_datetime(entry_value.get("received_at_iso"))
            if received_at is not None and received_at.timestamp() >= recent_cutoff:
                recent_frame_count += 1

            metadata = _as_dict(entry_value.get("metadata"))
            if metadata is None:
                continue
            sequence_value = metadata.get("frame_sequence")
            if isinstance(sequence_value, int):
                if previous_sequence is not None and sequence_value > previous_sequence + 1:
                    dropped_frames_estimate += sequence_value - previous_sequence - 1
                previous_sequence = sequence_value

        ingest_fps = round(recent_frame_count / PHONE_STATS_FPS_WINDOW_SEC, 2)
        if last_received_at_iso is not None and latest_client_time_ms is not None:
            received_at = _parse_iso_datetime(last_received_at_iso)
            if received_at is not None:
                received_epoch_ms = int(received_at.timestamp() * 1000)
                latency_ms = received_epoch_ms - latest_client_time_ms
                if latency_ms >= 0:
                    approx_latency_ms = latency_ms

        for entry in manifest_payload:
            entry_value = _as_dict(entry)
            if entry_value is None:
                continue
            metadata = _as_dict(entry_value.get("metadata"))
            if metadata is None:
                continue
            orientation_value = _as_dict(metadata.get("orientation"))
            motion_value = _as_dict(metadata.get("motion"))
            has_orientation_data = has_orientation_data or bool(orientation_value and len(orientation_value) > 0)
            has_motion_data = has_motion_data or bool(motion_value and len(motion_value) > 0)
            has_pose_data = has_pose_data or _metadata_has_pose(metadata)
            has_depth_data = has_depth_data or _metadata_has_depth(metadata)
            has_intrinsics_data = has_intrinsics_data or _metadata_has_intrinsics(metadata)
            has_calibrated_intrinsics_data = (
                has_calibrated_intrinsics_data or _metadata_has_calibrated_intrinsics(metadata)
            )
            has_imu_data = has_imu_data or _metadata_has_imu(metadata)

        return CamToSimPhoneFrameStatsResponse(
            session_id=session_id,
            frame_count=len(manifest_payload),
            last_received_at_iso=last_received_at_iso,
            latest_source=latest_source,
            latest_client_time_ms=latest_client_time_ms,
            ingest_fps=ingest_fps,
            approx_latency_ms=approx_latency_ms,
            dropped_frames_estimate=dropped_frames_estimate,
            latest_capture_interval_ms=latest_capture_interval_ms,
            latest_jpeg_quality=latest_jpeg_quality,
            latest_max_width_px=latest_max_width_px,
            has_orientation_data=has_orientation_data,
            has_motion_data=has_motion_data,
            has_pose_data=has_pose_data,
            has_depth_data=has_depth_data,
            has_intrinsics_data=has_intrinsics_data,
            has_calibrated_intrinsics_data=has_calibrated_intrinsics_data,
            has_imu_data=has_imu_data,
            capture_profile=capture_profile,
        )

    def get_capture_readiness(self, session_id: str) -> CamToSimCaptureReadinessResponse:
        stats = self.get_phone_frame_stats(session_id)
        has_rgb_frames = stats.frame_count > 0
        ready_for_real_to_sim = has_rgb_frames and stats.has_pose_data and stats.has_intrinsics_data
        ready_for_r2r2r_parity = (
            ready_for_real_to_sim
            and stats.has_imu_data
            and stats.has_depth_data
            and stats.has_calibrated_intrinsics_data
        )

        missing_requirements: list[str] = []
        if not has_rgb_frames:
            missing_requirements.append("rgb_frames")
        if not stats.has_pose_data:
            missing_requirements.append("camera_pose")
        if not stats.has_intrinsics_data:
            missing_requirements.append("camera_intrinsics")
        if not stats.has_imu_data:
            missing_requirements.append("imu_data")
        if not stats.has_depth_data:
            missing_requirements.append("depth_data")
        if not stats.has_calibrated_intrinsics_data:
            missing_requirements.append("calibrated_intrinsics")

        capture_profiles = [stats.capture_profile] if isinstance(stats.capture_profile, str) else []
        recommended_capture_notes: list[str] = []
        if not stats.has_depth_data:
            recommended_capture_notes.append(
                "Use LiDAR-capable capture (ARKit/native app) to stream depth for full parity."
            )
        if not stats.has_calibrated_intrinsics_data:
            recommended_capture_notes.append(
                "Provide calibrated intrinsics (fx/fy/cx/cy, estimated=false) for accurate reconstruction."
            )
        if not stats.has_pose_data:
            recommended_capture_notes.append(
                "Provide per-frame camera pose from VIO/SLAM or AR tracking."
            )

        return CamToSimCaptureReadinessResponse(
            session_id=session_id,
            frame_count=stats.frame_count,
            has_rgb_frames=has_rgb_frames,
            has_pose_data=stats.has_pose_data,
            has_depth_data=stats.has_depth_data,
            has_intrinsics_data=stats.has_intrinsics_data,
            has_calibrated_intrinsics_data=stats.has_calibrated_intrinsics_data,
            has_imu_data=stats.has_imu_data,
            capture_profiles=capture_profiles,
            ready_for_real_to_sim=ready_for_real_to_sim,
            ready_for_r2r2r_parity=ready_for_r2r2r_parity,
            missing_requirements=missing_requirements,
            recommended_capture_notes=recommended_capture_notes,
        )

    def get_capture_coach(self, session_id: str) -> CamToSimCaptureCoachResponse:
        self.get_session(session_id)
        frames_manifest_path = self._session_phone_frames_path(session_id)
        manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
        if not isinstance(manifest_payload, list):
            manifest_payload = []

        target_yaw_values: dict[str, list[float]] = {}
        target_pitch_values: dict[str, list[float]] = {}
        target_frame_counts: dict[str, int] = {}
        target_labels: dict[str, str] = {}
        target_families: dict[str, str] = {}
        target_order: list[str] = []
        active_target_id: str | None = None
        scenario_counts: dict[str, int] = {
            "single_object": 0,
            "multi_objects": 0,
            "stacked_objects": 0,
        }

        def _target_coverage_score(yaw_values: list[float], pitch_values: list[float], frame_count: int) -> int:
            yaw_range_value = max(yaw_values) - min(yaw_values) if len(yaw_values) >= 2 else 0.0
            pitch_range_value = max(pitch_values) - min(pitch_values) if len(pitch_values) >= 2 else 0.0
            yaw_coverage = min(1.0, max(0.0, yaw_range_value / 180.0))
            pitch_coverage = min(1.0, max(0.0, pitch_range_value / 90.0))
            frame_factor = min(1.0, frame_count / 30.0)
            return int(round((0.55 * yaw_coverage + 0.25 * pitch_coverage + 0.20 * frame_factor) * 100.0))

        def _is_target_ready(yaw_values: list[float], pitch_values: list[float], frame_count: int) -> bool:
            yaw_range_value = max(yaw_values) - min(yaw_values) if len(yaw_values) >= 2 else 0.0
            pitch_range_value = max(pitch_values) - min(pitch_values) if len(pitch_values) >= 2 else 0.0
            return frame_count >= 20 and yaw_range_value >= 45.0 and pitch_range_value >= 20.0

        for entry in manifest_payload:
            entry_value = _as_dict(entry)
            if entry_value is None:
                continue
            metadata = _as_dict(entry_value.get("metadata"))
            if metadata is None:
                continue
            capture_scenario = _capture_scenario_from_metadata(metadata)
            scenario_counts[capture_scenario] = scenario_counts.get(capture_scenario, 0) + 1
            target_id = _capture_target_id_from_metadata(metadata) or "object_1"
            target_label = _capture_target_label_from_metadata(metadata) or target_id.replace("_", " ").title()
            target_family = _capture_target_family_from_metadata(metadata)
            active_target_id = target_id
            if target_id not in target_labels:
                target_labels[target_id] = target_label
            if target_family is not None:
                target_families[target_id] = target_family
            if target_id not in target_order:
                target_order.append(target_id)
            target_frame_counts[target_id] = target_frame_counts.get(target_id, 0) + 1
            pose_value = _as_dict(metadata.get("pose"))
            if pose_value is None:
                continue
            yaw = pose_value.get("yaw_deg")
            pitch = pose_value.get("pitch_deg")
            if isinstance(yaw, (int, float)):
                target_yaw_values.setdefault(target_id, []).append(float(yaw))
            if isinstance(pitch, (int, float)):
                target_pitch_values.setdefault(target_id, []).append(float(pitch))

        if active_target_id is None and len(target_order) > 0:
            active_target_id = target_order[-1]
        if active_target_id is None:
            active_target_id = "object_1"
            target_labels.setdefault(active_target_id, "Object 1")

        active_target_label = target_labels.get(active_target_id, "Object 1")
        active_yaw_values = target_yaw_values.get(active_target_id, [])
        active_pitch_values = target_pitch_values.get(active_target_id, [])
        target_frame_count = target_frame_counts.get(active_target_id, 0)

        yaw_range_deg = max(active_yaw_values) - min(active_yaw_values) if len(active_yaw_values) >= 2 else 0.0
        pitch_range_deg = (
            max(active_pitch_values) - min(active_pitch_values)
            if len(active_pitch_values) >= 2
            else 0.0
        )
        frame_count = len(manifest_payload)
        coverage_score = _target_coverage_score(active_yaw_values, active_pitch_values, target_frame_count)
        stack_support_graph = _build_stack_support_graph(manifest_payload)
        dominant_capture_scenario = max(scenario_counts, key=lambda key: scenario_counts.get(key, 0))

        completed_targets = 0
        target_summaries: list[CamToSimCaptureCoachTargetSummary] = []
        ordered_target_ids = target_order if len(target_order) > 0 else ["object_1"]
        for target_id in ordered_target_ids:
            count = target_frame_counts.get(target_id, 0)
            yaw_values = target_yaw_values.get(target_id, [])
            pitch_values = target_pitch_values.get(target_id, [])
            target_yaw_range = max(yaw_values) - min(yaw_values) if len(yaw_values) >= 2 else 0.0
            target_pitch_range = max(pitch_values) - min(pitch_values) if len(pitch_values) >= 2 else 0.0
            target_coverage = _target_coverage_score(yaw_values, pitch_values, count)
            target_ready = _is_target_ready(yaw_values, pitch_values, count)
            if target_ready:
                completed_targets += 1
            target_summaries.append(
                CamToSimCaptureCoachTargetSummary(
                    target_id=target_id,
                    target_label=target_labels.get(target_id, target_id.replace("_", " ").title()),
                    primitive_family=target_families.get(target_id),
                    frame_count=count,
                    coverage_score=target_coverage,
                    yaw_range_deg=target_yaw_range,
                    pitch_range_deg=target_pitch_range,
                    ready=target_ready,
                )
            )

        readiness = self.get_capture_readiness(session_id)
        guidance: list[str] = []
        if target_frame_count < 20:
            guidance.append(f"Keep capturing {active_target_label} until at least 20 frames.")
        if yaw_range_deg < 45.0:
            guidance.append(f"Move left/right around {active_target_label} to improve side coverage.")
        if pitch_range_deg < 20.0:
            guidance.append(f"Tilt up/down around {active_target_label} to capture top and bottom geometry.")
        if not readiness.has_pose_data:
            guidance.append("Move smoothly so pose can be inferred reliably.")
        if not readiness.has_intrinsics_data:
            guidance.append("Keep camera active and stable to preserve intrinsics metadata.")
        if not readiness.has_depth_data:
            guidance.append("Depth is unavailable in browser mode; LiDAR capture improves geometry quality.")
        if dominant_capture_scenario == "single_object":
            guidance.append("Single-object mode: keep one object centered and complete full 360 coverage.")
        elif dominant_capture_scenario == "multi_objects":
            guidance.append("Multi-object mode: use Next Object after each object reaches good coverage.")
        if stack_support_graph.get("stack_mode_detected") is True:
            scene_frames = int(stack_support_graph.get("scene_pass_frame_count", 0))
            if scene_frames < 12:
                guidance.append("Do a full scene pass around the entire stack before object pass.")
            guidance.append("For stacks: scan bottom to top with overlap between consecutive boxes.")
        if coverage_score >= 60 and target_frame_count >= 20:
            guidance.append(f"{active_target_label} looks good. Tap Next Object and continue.")
        if len(guidance) == 0:
            guidance.append("Coverage looks good. You can run processing now.")

        ready_for_processing = (
            readiness.ready_for_real_to_sim
            and _is_target_ready(active_yaw_values, active_pitch_values, target_frame_count)
        )
        if ready_for_processing:
            status_label = f"{active_target_label}: ready"
        elif frame_count == 0:
            status_label = "Waiting for frames"
        elif coverage_score < 40:
            status_label = f"{active_target_label}: need more coverage"
        else:
            status_label = f"{active_target_label}: keep scanning"

        return CamToSimCaptureCoachResponse(
            session_id=session_id,
            frame_count=frame_count,
            capture_scenario=dominant_capture_scenario,
            coverage_score=coverage_score,
            yaw_range_deg=yaw_range_deg,
            pitch_range_deg=pitch_range_deg,
            active_target_id=active_target_id,
            active_target_label=active_target_label,
            target_frame_count=target_frame_count,
            completed_targets=completed_targets,
            ready_for_processing=ready_for_processing,
            status_label=status_label,
            guidance=guidance,
            targets=target_summaries,
        )

    def reset_phone_frames(self, session_id: str) -> CamToSimPhoneFrameStatsResponse:
        self.get_session(session_id)
        frames_manifest_path = self._session_phone_frames_path(session_id)
        frames_dir = self._session_phone_frames_dir(session_id)
        export_dir = self._session_r2r2r_export_dir(session_id)

        if frames_dir.exists():
            shutil.rmtree(frames_dir)
        frames_dir.mkdir(parents=True, exist_ok=True)
        _write_json(frames_manifest_path, [])

        if export_dir.exists():
            shutil.rmtree(export_dir)

        return self.get_phone_frame_stats(session_id)

    def prepare_r2r2r_export(self, session_id: str) -> CamToSimR2R2RPrepareResponse:
        self.get_session(session_id)
        frames_manifest_path = self._session_phone_frames_path(session_id)
        manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
        if not isinstance(manifest_payload, list):
            manifest_payload = []

        frame_source_dir = self._session_phone_frames_dir(session_id)
        export_dir = self._session_r2r2r_export_dir(session_id)
        if export_dir.exists():
            shutil.rmtree(export_dir)
        export_frames_dir = export_dir / CAM_TO_SIM_R2R2R_EXPORT_FRAMES_DIRNAME
        export_frames_dir.mkdir(parents=True, exist_ok=True)

        poses_rows: list[dict[str, object]] = []
        frames_rows: list[dict[str, object]] = []
        intrinsics_rows: list[dict[str, object]] = []
        imu_rows: list[dict[str, object]] = []
        depth_rows: list[dict[str, object]] = []
        exported_frame_count = 0
        has_pose_data = False
        has_depth_data = False
        has_intrinsics_data = False
        has_calibrated_intrinsics_data = False
        has_imu_data = False

        for index, entry in enumerate(manifest_payload):
            entry_value = _as_dict(entry)
            if entry_value is None:
                continue
            filename = entry_value.get("filename")
            if not isinstance(filename, str) or not filename:
                continue
            source_frame_path = frame_source_dir / filename
            if not source_frame_path.exists():
                continue
            extension = source_frame_path.suffix.lower() or ".jpg"
            exported_name = f"frame_{index:06d}{extension}"
            exported_path = export_frames_dir / exported_name
            shutil.copy2(source_frame_path, exported_path)
            exported_frame_count += 1

            metadata = _as_dict(entry_value.get("metadata"))
            pose_value = metadata.get("pose") if metadata else None
            depth_value = metadata.get("depth") if metadata else None
            intrinsics_value = (
                metadata.get("camera_intrinsics")
                if metadata and isinstance(metadata.get("camera_intrinsics"), dict)
                else metadata.get("intrinsics")
                if metadata and isinstance(metadata.get("intrinsics"), dict)
                else None
            )
            imu_value = metadata.get("imu") if metadata and isinstance(metadata.get("imu"), dict) else None
            orientation_value = metadata.get("orientation") if metadata else None
            motion_value = metadata.get("motion") if metadata else None

            frame_row = {
                "frame_index": index,
                "frame_file": exported_name,
                "received_at_iso": entry_value.get("received_at_iso"),
                "source": entry_value.get("source"),
                "metadata": metadata,
            }
            frames_rows.append(frame_row)

            if isinstance(pose_value, dict) and len(pose_value) > 0:
                has_pose_data = True
            if metadata and _metadata_has_depth(metadata):
                has_depth_data = True
            if metadata and _metadata_has_intrinsics(metadata):
                has_intrinsics_data = True
            if metadata and _metadata_has_calibrated_intrinsics(metadata):
                has_calibrated_intrinsics_data = True
            if metadata and _metadata_has_imu(metadata):
                has_imu_data = True

            if isinstance(intrinsics_value, dict):
                intrinsics_rows.append(
                    {
                        "frame_index": index,
                        "frame_file": exported_name,
                        "received_at_iso": entry_value.get("received_at_iso"),
                        "client_time_ms": metadata.get("client_time_ms") if metadata else None,
                        "intrinsics": intrinsics_value,
                    }
                )
            if isinstance(depth_value, dict):
                depth_rows.append(
                    {
                        "frame_index": index,
                        "frame_file": exported_name,
                        "received_at_iso": entry_value.get("received_at_iso"),
                        "client_time_ms": metadata.get("client_time_ms") if metadata else None,
                        "depth": depth_value,
                    }
                )
            if isinstance(imu_value, dict) or isinstance(orientation_value, dict) or isinstance(motion_value, dict):
                imu_rows.append(
                    {
                        "frame_index": index,
                        "frame_file": exported_name,
                        "received_at_iso": entry_value.get("received_at_iso"),
                        "client_time_ms": metadata.get("client_time_ms") if metadata else None,
                        "imu": imu_value,
                        "orientation": orientation_value,
                        "motion": motion_value,
                    }
                )

            poses_rows.append(
                {
                    "frame_index": index,
                    "frame_file": exported_name,
                    "received_at_iso": entry_value.get("received_at_iso"),
                    "source": entry_value.get("source"),
                    "client_time_ms": metadata.get("client_time_ms") if metadata else None,
                    "camera": {
                        "video_width": metadata.get("video_width") if metadata else None,
                        "video_height": metadata.get("video_height") if metadata else None,
                    },
                    "orientation": orientation_value,
                    "motion": motion_value,
                    "pose": pose_value,
                    "depth": depth_value,
                    "intrinsics": intrinsics_value,
                    "imu": imu_value,
                }
            )

        poses_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_POSES_FILENAME
        _write_jsonl(poses_path, poses_rows)
        frames_manifest_export_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_FRAMES_MANIFEST_FILENAME
        _write_jsonl(frames_manifest_export_path, frames_rows)
        intrinsics_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_INTRINSICS_FILENAME
        _write_jsonl(intrinsics_path, intrinsics_rows)
        imu_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_IMU_FILENAME
        _write_jsonl(imu_path, imu_rows)
        depth_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_DEPTH_FILENAME
        _write_jsonl(depth_path, depth_rows)

        manifest_path = export_dir / CAM_TO_SIM_R2R2R_EXPORT_MANIFEST_FILENAME
        ready_for_real_to_sim = exported_frame_count > 0 and has_pose_data and has_intrinsics_data
        ready_for_r2r2r_parity = (
            ready_for_real_to_sim
            and has_depth_data
            and has_imu_data
            and has_calibrated_intrinsics_data
        )
        manifest_payload_export = {
            "session_id": session_id,
            "frame_count": exported_frame_count,
            "frames_dir": str(export_frames_dir),
            "poses_path": str(poses_path),
            "frames_manifest_path": str(frames_manifest_export_path),
            "intrinsics_path": str(intrinsics_path),
            "imu_path": str(imu_path),
            "depth_path": str(depth_path),
            "reference_root": str(self._reference_dir),
            "ready_for_real_to_sim": ready_for_real_to_sim,
            "ready_for_r2r2r_parity": ready_for_r2r2r_parity,
            "has_pose_data": has_pose_data,
            "has_depth_data": has_depth_data,
            "has_intrinsics_data": has_intrinsics_data,
            "has_calibrated_intrinsics_data": has_calibrated_intrinsics_data,
            "has_imu_data": has_imu_data,
        }
        _write_json(manifest_path, manifest_payload_export)
        readiness_path = export_dir / CAM_TO_SIM_R2R2R_CAPTURE_READINESS_FILENAME
        _write_json(readiness_path, self.get_capture_readiness(session_id).model_dump(mode="json"))

        reference_root = self._public_reference_root()
        public_export_dir = self._public_artifact_path(export_dir) or export_dir.name
        public_frames_dir = self._public_artifact_path(export_frames_dir) or export_frames_dir.name
        public_poses_path = self._public_artifact_path(poses_path) or poses_path.name
        public_frames_manifest_path = (
            self._public_artifact_path(frames_manifest_export_path)
            or frames_manifest_export_path.name
        )
        public_intrinsics_path = self._public_artifact_path(intrinsics_path) or intrinsics_path.name
        public_imu_path = self._public_artifact_path(imu_path) or imu_path.name
        public_depth_path = self._public_artifact_path(depth_path) or depth_path.name
        public_readiness_path = self._public_artifact_path(readiness_path) or readiness_path.name
        public_manifest_path = self._public_artifact_path(manifest_path) or manifest_path.name
        command_hints = [
            f"cd {reference_root}",
            "conda activate r2r2r_rsrd  # run env_real_to_sim.sh first",
            f"# Use frames from: {public_frames_dir}",
            f"# Use pose/motion from: {public_poses_path}",
            f"# Use intrinsics from: {public_intrinsics_path}",
            f"# Use imu from: {public_imu_path}",
            f"# Use depth from: {public_depth_path}",
            "python scripts/run.py  # data generation step after real-to-sim asset prep",
        ]

        return CamToSimR2R2RPrepareResponse(
            session_id=session_id,
            frame_count=exported_frame_count,
            export_dir=public_export_dir,
            frames_dir=public_frames_dir,
            poses_path=public_poses_path,
            frames_manifest_path=public_frames_manifest_path,
            intrinsics_path=public_intrinsics_path,
            imu_path=public_imu_path,
            depth_path=public_depth_path,
            readiness_path=public_readiness_path,
            manifest_path=public_manifest_path,
            reference_root=reference_root,
            ready_for_real_to_sim=ready_for_real_to_sim,
            ready_for_r2r2r_parity=ready_for_r2r2r_parity,
            has_pose_data=has_pose_data,
            has_depth_data=has_depth_data,
            has_intrinsics_data=has_intrinsics_data,
            has_calibrated_intrinsics_data=has_calibrated_intrinsics_data,
            has_imu_data=has_imu_data,
            command_hints=command_hints,
        )

    def build_runtime_result(self, session_id: str) -> CamToSimRuntimeResultResponse:
        self.get_session(session_id)
        frames_manifest_path = self._session_phone_frames_path(session_id)
        manifest_payload = _read_json(frames_manifest_path) if frames_manifest_path.exists() else []
        if not isinstance(manifest_payload, list):
            manifest_payload = []

        frame_entries: list[dict[str, Any]] = [entry for entry in manifest_payload if isinstance(entry, dict)]
        frame_count = len(frame_entries)
        if frame_count == 0:
            return CamToSimRuntimeResultResponse(
                session_id=session_id,
                frame_count=0,
                duration_seconds=0.0,
                preview_frames=[],
            )

        client_times: list[int] = []
        yaw_values: list[float] = []
        pitch_values: list[float] = []
        roll_values: list[float] = []
        has_pose_data = False
        has_depth_data = False

        for entry in frame_entries:
            metadata_value = entry.get("metadata")
            metadata = metadata_value if isinstance(metadata_value, dict) else None
            if metadata is None:
                continue

            client_time_value = metadata.get("client_time_ms")
            if isinstance(client_time_value, int) and client_time_value >= 0:
                client_times.append(client_time_value)

            pose_value = metadata.get("pose")
            if isinstance(pose_value, dict) and len(pose_value) > 0:
                has_pose_data = True
                yaw_value = pose_value.get("yaw_deg")
                pitch_value = pose_value.get("pitch_deg")
                roll_value = pose_value.get("roll_deg")
                if isinstance(yaw_value, (int, float)):
                    yaw_values.append(float(yaw_value))
                if isinstance(pitch_value, (int, float)):
                    pitch_values.append(float(pitch_value))
                if isinstance(roll_value, (int, float)):
                    roll_values.append(float(roll_value))

            depth_value = metadata.get("depth")
            if (
                isinstance(depth_value, dict)
                and isinstance(depth_value.get("available"), bool)
                and depth_value.get("available") is True
            ):
                has_depth_data = True

        duration_seconds = 0.0
        if len(client_times) >= 2:
            duration_seconds = max(0.0, (max(client_times) - min(client_times)) / 1000.0)

        preview_indices: list[int] = []
        if frame_count == 1:
            preview_indices = [0]
        elif frame_count == 2:
            preview_indices = [0, 1]
        else:
            preview_indices = sorted({0, frame_count // 2, frame_count - 1})
        preview_indices = preview_indices[:RUNTIME_PREVIEW_FRAME_COUNT]

        preview_frames: list[CamToSimRuntimePreviewFrame] = []
        for index in preview_indices:
            entry = frame_entries[index]
            filename = entry.get("filename")
            if not isinstance(filename, str) or not filename:
                continue
            preview_frames.append(
                CamToSimRuntimePreviewFrame(
                    filename=filename,
                    image_url=f"/cam-to-sim/sessions/{session_id}/frames/{filename}",
                    received_at_iso=entry.get("received_at_iso")
                    if isinstance(entry.get("received_at_iso"), str)
                    else None,
                )
            )

        yaw_range_deg = (max(yaw_values) - min(yaw_values)) if len(yaw_values) >= 2 else None
        pitch_range_deg = (max(pitch_values) - min(pitch_values)) if len(pitch_values) >= 2 else None
        roll_range_deg = (max(roll_values) - min(roll_values)) if len(roll_values) >= 2 else None

        return CamToSimRuntimeResultResponse(
            session_id=session_id,
            frame_count=frame_count,
            duration_seconds=duration_seconds,
            has_pose_data=has_pose_data,
            has_depth_data=has_depth_data,
            yaw_range_deg=yaw_range_deg,
            pitch_range_deg=pitch_range_deg,
            roll_range_deg=roll_range_deg,
            preview_frames=preview_frames,
        )


cam_to_sim_service = CamToSimService()
