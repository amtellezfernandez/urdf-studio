from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from scipy.spatial.transform import Rotation

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.camera_conventions import (
    world_camera_to_opengl_camera_rotation,
)
from backend.services.simulator_adapters.camera_intrinsics import (
    focal_length_px_from_vertical_fov_deg,
)
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.world_asset_refs import normalize_portable_world_asset_ref
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    normalize_world_snapshot_artifact_digests,
)
from backend.services.world_scene_package_params import MAX_OBJECTS_PER_WORLD

BLENDER_CHANGE_SET_SCHEMA = "urdf-studio.blender-change-set.v1"
BLENDER_CHANGE_SET_SOURCE_SCHEMA = "urdf-studio.blender-change-set-source.v1"
BLENDER_APPLY_FRAME_MAPS = frozenset({"identity"})
BLENDER_CAMERA_CHANGE_POSE_FRAME = "opengl_render_local"
BLENDER_REVIEW_ONLY_ENTITY_TYPES = frozenset(
    {"deleted_camera", "new_world_object", "deleted_world_object"}
)


@dataclass(frozen=True)
class BlenderLayoutChangeSetApplyResult:
    world_package: WorldScenePackageManifest
    applied_change_count: int
    review_only_count: int


@dataclass(frozen=True)
class BlenderWorldObjectChange:
    stable_id: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]
    rgba: tuple[float, float, float, float] | None


@dataclass(frozen=True)
class BlenderNewWorldObject:
    sim_name: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]
    rgba: tuple[float, float, float, float] | None
    asset_ref: str | None


@dataclass(frozen=True)
class BlenderCameraChange:
    stable_id: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    fov_deg: float | None
    pose_frame: str


@dataclass(frozen=True)
class BlenderChangeSetSource:
    world_object_ids: tuple[str, ...]
    camera_ids: tuple[str, ...]


def build_blender_change_set_source(
    world_package: WorldScenePackageManifest,
    *,
    world_object_ids: Sequence[str],
    camera_ids: Sequence[str],
    frame_map: str | None = None,
) -> dict[str, Any]:
    source = _blender_change_set_source_metadata(world_package)
    if frame_map is not None:
        source["frame_map"] = frame_map
    source["world_object_ids"] = list(world_object_ids)
    source["camera_ids"] = list(camera_ids)
    return source


def apply_blender_layout_change_set(
    world_package: WorldScenePackageManifest,
    change_set: Mapping[str, Any],
) -> WorldScenePackageManifest:
    return apply_blender_layout_change_set_with_summary(
        world_package,
        change_set,
    ).world_package


def apply_blender_layout_change_set_with_summary(
    world_package: WorldScenePackageManifest,
    change_set: Mapping[str, Any],
) -> BlenderLayoutChangeSetApplyResult:
    (
        object_updates,
        camera_updates,
        new_world_objects,
        review_only_count,
    ) = _validate_blender_change_set(change_set, world_package)
    updated = world_package.model_copy(deep=True)
    package_object_ids = _world_package_object_ids(updated)
    missing_object_ids = sorted(set(object_updates) - package_object_ids)
    if missing_object_ids:
        raise ValueError(
            "Blender change-set references unknown world object id(s): "
            f"{', '.join(missing_object_ids)}."
        )
    applied_change_count = 0
    next_objects: list[dict[str, Any]] = []
    for item in updated.world_snapshot.objects:
        next_item = dict(item)
        object_id = str(next_item.get("id", "")).strip()
        change = object_updates.get(object_id)
        if change is not None:
            next_item.update(_world_object_change_fields(change))
            applied_change_count += 1
        next_objects.append(next_item)
    next_objects.extend(_new_world_object_fields(new_world_objects, package_object_ids))
    applied_change_count += len(new_world_objects)
    if len(next_objects) > MAX_OBJECTS_PER_WORLD:
        raise ValueError(
            "Blender change-set would exceed the maximum world object count "
            f"({MAX_OBJECTS_PER_WORLD})."
        )
    updated.world_snapshot.objects = next_objects
    updated.world_snapshot.cameras = _updated_camera_fields(
        updated.world_snapshot.cameras,
        camera_updates,
    )
    applied_change_count += len(camera_updates)
    normalized = normalize_world_snapshot_artifact_digests(updated)
    return BlenderLayoutChangeSetApplyResult(
        world_package=normalized,
        applied_change_count=applied_change_count,
        review_only_count=review_only_count,
    )


def _blender_change_set_source_metadata(
    world_package: WorldScenePackageManifest,
) -> dict[str, Any]:
    return {
        "schema": BLENDER_CHANGE_SET_SOURCE_SCHEMA,
        "package_id": world_package.package_id,
        "version": world_package.version,
        "world_snapshot_digest_sha256": computed_world_snapshot_digest(world_package),
        "frame_convention": world_package.interface.frame_convention,
    }


def _validate_blender_change_set(
    change_set: Mapping[str, Any],
    world_package: WorldScenePackageManifest,
) -> tuple[
    dict[str, BlenderWorldObjectChange],
    dict[str, BlenderCameraChange],
    tuple[BlenderNewWorldObject, ...],
    int,
]:
    if change_set.get("schema") != BLENDER_CHANGE_SET_SCHEMA:
        raise ValueError("Unsupported Blender change-set schema.")
    source = _validate_change_set_source(
        change_set.get("source"),
        world_package,
    )
    changes = _required_list(change_set.get("changes"), "Blender change-set changes")
    review_only = _required_list(
        change_set.get("review_only"),
        "Blender change-set review_only",
    )

    object_updates: dict[str, BlenderWorldObjectChange] = {}
    camera_updates: dict[str, BlenderCameraChange] = {}
    for index, change in enumerate(changes):
        entity_type = _change_entity_type(change, f"changes[{index}]")
        if entity_type == "world_object":
            normalized = _validate_world_object_change(change, f"changes[{index}]")
            if normalized.stable_id in object_updates:
                raise ValueError(
                    f"Blender change-set changes duplicate stable_id {normalized.stable_id!r}."
                )
            object_updates[normalized.stable_id] = normalized
            continue
        if entity_type == "camera":
            camera_change = _validate_camera_change(change, f"changes[{index}]")
            if camera_change.stable_id in camera_updates:
                raise ValueError(
                    f"Blender change-set changes duplicate stable_id {camera_change.stable_id!r}."
                )
            camera_updates[camera_change.stable_id] = camera_change
            continue
        raise ValueError(
            f"Blender change-set changes[{index}].entity_type must be 'world_object' or 'camera'."
        )

    seen_review_ids: set[str] = set()
    deleted_world_object_ids: set[str] = set()
    deleted_camera_ids: set[str] = set()
    new_world_objects: list[BlenderNewWorldObject] = []
    for index, entry in enumerate(review_only):
        review_key = _validate_review_only_entry(entry, f"review_only[{index}]")
        if review_key in seen_review_ids:
            raise ValueError(f"Blender change-set review_only duplicates stable_id {review_key!r}.")
        entity_type, _, stable_id = review_key.partition(":")
        if entity_type == "deleted_world_object" and stable_id in object_updates:
            raise ValueError(
                f"Blender change-set cannot both update and delete world object {stable_id!r}."
            )
        if entity_type == "deleted_world_object":
            deleted_world_object_ids.add(stable_id)
        if entity_type == "deleted_camera":
            if stable_id in camera_updates:
                raise ValueError(
                    f"Blender change-set cannot both update and delete camera {stable_id!r}."
                )
            deleted_camera_ids.add(stable_id)
        if entity_type == "new_world_object":
            new_world_objects.append(
                _validate_new_world_object_import(entry, f"review_only[{index}]")
            )
        seen_review_ids.add(review_key)

    _validate_change_set_source_coverage(
        source.world_object_ids,
        object_update_ids=set(object_updates),
        deleted_world_object_ids=deleted_world_object_ids,
    )
    _validate_change_set_camera_coverage(
        source.camera_ids,
        camera_update_ids=set(camera_updates),
        deleted_camera_ids=deleted_camera_ids,
    )

    return (
        object_updates,
        camera_updates,
        tuple(new_world_objects),
        len(review_only) - len(new_world_objects),
    )


def _validate_change_set_source(
    value: Any,
    world_package: WorldScenePackageManifest,
) -> BlenderChangeSetSource:
    if not isinstance(value, Mapping):
        raise ValueError("Blender change-set source must be an object.")
    _reject_unknown_fields(
        value,
        "source",
        {
            "schema",
            "package_id",
            "version",
            "world_snapshot_digest_sha256",
            "frame_convention",
            "frame_map",
            "world_object_ids",
            "camera_ids",
        },
    )
    schema = _required_string(value.get("schema"), "source.schema")
    if schema != BLENDER_CHANGE_SET_SOURCE_SCHEMA:
        raise ValueError("Unsupported Blender change-set source schema.")

    expected = _blender_change_set_source_metadata(world_package)
    actual_package_id = _required_string(value.get("package_id"), "source.package_id")
    actual_version = _required_string(value.get("version"), "source.version")
    actual_digest = _required_string(
        value.get("world_snapshot_digest_sha256"),
        "source.world_snapshot_digest_sha256",
    ).lower()
    actual_frame_convention = _required_string(
        value.get("frame_convention"),
        "source.frame_convention",
    )
    actual_frame_map = value.get("frame_map")
    if actual_frame_map is not None:
        actual_frame_map = _required_string(actual_frame_map, "source.frame_map")
    actual_world_object_ids = _required_string_list(
        value.get("world_object_ids"),
        "source.world_object_ids",
    )
    actual_camera_ids = _required_string_list(
        value.get("camera_ids"),
        "source.camera_ids",
    )

    if actual_package_id != expected["package_id"] or actual_version != expected["version"]:
        raise ValueError(
            "Blender change-set source package does not match the current world package."
        )
    if actual_frame_convention != expected["frame_convention"]:
        raise ValueError(
            "Blender change-set source frame convention does not match the current world package."
        )
    if actual_digest != expected["world_snapshot_digest_sha256"]:
        raise ValueError(
            "Blender change-set source world snapshot does not match the current world package."
        )
    if actual_frame_map is not None and actual_frame_map not in BLENDER_APPLY_FRAME_MAPS:
        raise ValueError(
            "Blender change-set source frame_map is not supported for direct apply. "
            "Only identity frame_map sessions can be imported without coordinate conversion."
        )
    _validate_source_world_object_ids(actual_world_object_ids, world_package)
    _validate_source_camera_ids(actual_camera_ids, world_package)
    return BlenderChangeSetSource(
        world_object_ids=actual_world_object_ids,
        camera_ids=actual_camera_ids,
    )


def _validate_change_set_source_coverage(
    source_world_object_ids: Sequence[str],
    *,
    object_update_ids: set[str],
    deleted_world_object_ids: set[str],
) -> None:
    source_ids = set(source_world_object_ids)
    unexpected_updates = sorted(object_update_ids - source_ids)
    if unexpected_updates:
        raise ValueError(
            "Blender change-set changes reference object id(s) outside source "
            f"world_object_ids: {', '.join(unexpected_updates)}."
        )
    unexpected_deletions = sorted(deleted_world_object_ids - source_ids)
    if unexpected_deletions:
        raise ValueError(
            "Blender change-set review_only deletes object id(s) outside source "
            f"world_object_ids: {', '.join(unexpected_deletions)}."
        )
    missing_ids = sorted(source_ids - object_update_ids - deleted_world_object_ids)
    if missing_ids:
        raise ValueError(
            "Blender change-set is missing update or deletion review for source "
            f"world object id(s): {', '.join(missing_ids)}."
        )


def _validate_change_set_camera_coverage(
    source_camera_ids: Sequence[str],
    *,
    camera_update_ids: set[str],
    deleted_camera_ids: set[str],
) -> None:
    source_ids = set(source_camera_ids)
    unexpected_updates = sorted(camera_update_ids - source_ids)
    if unexpected_updates:
        raise ValueError(
            "Blender change-set changes reference camera id(s) outside source "
            f"camera_ids: {', '.join(unexpected_updates)}."
        )
    unexpected_deletions = sorted(deleted_camera_ids - source_ids)
    if unexpected_deletions:
        raise ValueError(
            "Blender change-set review_only deletes camera id(s) outside source "
            f"camera_ids: {', '.join(unexpected_deletions)}."
        )
    missing_ids = sorted(source_ids - camera_update_ids - deleted_camera_ids)
    if missing_ids:
        raise ValueError(
            "Blender change-set is missing camera update or deletion review for "
            f"source camera id(s): {', '.join(missing_ids)}."
        )


def _change_entity_type(value: Any, path: str) -> str:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    return _required_string(value.get("entity_type"), f"{path}.entity_type")


def _validate_world_object_change(value: Any, path: str) -> BlenderWorldObjectChange:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    _reject_unknown_fields(
        value,
        path,
        {
            "entity_type",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
        },
    )
    entity_type = _required_string(value.get("entity_type"), f"{path}.entity_type")
    if entity_type != "world_object":
        raise ValueError(
            f"Blender change-set {path}.entity_type must be 'world_object'. "
            "Camera, robot, material, and mesh edits must stay in review_only."
        )
    stable_id = _required_string(value.get("stable_id"), f"{path}.stable_id")
    return BlenderWorldObjectChange(
        stable_id=stable_id,
        position_xyz=_required_vector3(value.get("position_xyz"), f"{path}.position_xyz"),
        quat_wxyz=_required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz"),
        size_xyz=_required_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz"),
        rgba=_optional_rgba(value.get("rgba"), f"{path}.rgba"),
    )


def _validate_camera_change(value: Any, path: str) -> BlenderCameraChange:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    _reject_unknown_fields(
        value,
        path,
        {
            "entity_type",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "fov_deg",
            "pose_frame",
        },
    )
    entity_type = _required_string(value.get("entity_type"), f"{path}.entity_type")
    if entity_type != "camera":
        raise ValueError(f"Blender change-set {path}.entity_type must be 'camera'.")
    pose_frame = _required_string(value.get("pose_frame"), f"{path}.pose_frame")
    if pose_frame != BLENDER_CAMERA_CHANGE_POSE_FRAME:
        raise ValueError(
            f"Blender change-set {path}.pose_frame must be {BLENDER_CAMERA_CHANGE_POSE_FRAME!r}."
        )
    return BlenderCameraChange(
        stable_id=_required_string(value.get("stable_id"), f"{path}.stable_id"),
        position_xyz=_required_vector3(value.get("position_xyz"), f"{path}.position_xyz"),
        quat_wxyz=_required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz"),
        fov_deg=_optional_camera_fov_deg(value.get("fov_deg"), f"{path}.fov_deg"),
        pose_frame=pose_frame,
    )


def _validate_new_world_object_import(value: Any, path: str) -> BlenderNewWorldObject:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    return BlenderNewWorldObject(
        sim_name=_required_string(value.get("sim_name"), f"{path}.sim_name"),
        position_xyz=_required_vector3(value.get("position_xyz"), f"{path}.position_xyz"),
        quat_wxyz=_required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz"),
        size_xyz=_required_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz"),
        rgba=_optional_rgba(value.get("rgba"), f"{path}.rgba"),
        asset_ref=_optional_asset_ref(value.get("asset_ref"), f"{path}.asset_ref"),
    )


def _validate_review_only_entry(value: Any, path: str) -> str:
    if not isinstance(value, Mapping):
        raise ValueError(f"Blender change-set {path} must be an object.")
    _reject_unknown_fields(
        value,
        path,
        {
            "entity_type",
            "stable_id",
            "sim_name",
            "position_xyz",
            "quat_wxyz",
            "size_xyz",
            "rgba",
            "asset_ref",
            "reason",
        },
    )
    entity_type = _required_string(value.get("entity_type"), f"{path}.entity_type")
    if entity_type not in BLENDER_REVIEW_ONLY_ENTITY_TYPES:
        raise ValueError(
            f"Blender change-set {path}.entity_type must be one of: "
            f"{', '.join(sorted(BLENDER_REVIEW_ONLY_ENTITY_TYPES))}."
        )
    if entity_type == "new_world_object":
        stable_id = _required_string(value.get("sim_name"), f"{path}.sim_name")
    else:
        stable_id = _required_string(value.get("stable_id"), f"{path}.stable_id")
    if "position_xyz" in value:
        _required_vector3(value.get("position_xyz"), f"{path}.position_xyz")
    if "quat_wxyz" in value:
        _required_quat_wxyz(value.get("quat_wxyz"), f"{path}.quat_wxyz")
    if "size_xyz" in value:
        _required_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz")
    if "rgba" in value:
        if entity_type != "new_world_object":
            raise ValueError(
                f"Blender change-set {path}.rgba is only supported for new_world_object."
            )
        _optional_rgba(value.get("rgba"), f"{path}.rgba")
    if "asset_ref" in value:
        if entity_type != "new_world_object":
            raise ValueError(
                f"Blender change-set {path}.asset_ref is only supported for new_world_object."
            )
        _optional_asset_ref(value.get("asset_ref"), f"{path}.asset_ref")
    if "reason" in value:
        _required_string(value.get("reason"), f"{path}.reason")
    return f"{entity_type}:{stable_id}"


def _world_package_object_ids(world_package: WorldScenePackageManifest) -> set[str]:
    object_ids: set[str] = set()
    for index, item in enumerate(world_package.world_snapshot.objects):
        if not isinstance(item, Mapping):
            raise ValueError(f"World package object at index {index} must be an object.")
        object_id = str(item.get("id", "")).strip()
        if not object_id:
            raise ValueError(f"World package object at index {index} is missing id.")
        if object_id in object_ids:
            raise ValueError(f"World package contains duplicate object id {object_id!r}.")
        object_ids.add(object_id)
    return object_ids


def _world_package_camera_ids(world_package: WorldScenePackageManifest) -> set[str]:
    camera_ids: set[str] = set()
    for index, item in enumerate(world_package.world_snapshot.cameras):
        if not isinstance(item, Mapping):
            raise ValueError(f"World package camera at index {index} must be an object.")
        camera_id = str(item.get("id", "")).strip()
        if not camera_id:
            raise ValueError(f"World package camera at index {index} is missing id.")
        if camera_id in camera_ids:
            raise ValueError(f"World package contains duplicate camera id {camera_id!r}.")
        camera_ids.add(camera_id)
    return camera_ids


def _updated_camera_fields(
    cameras: Sequence[dict[str, Any]],
    camera_updates: Mapping[str, BlenderCameraChange],
) -> list[dict[str, Any]]:
    if not camera_updates:
        return [dict(camera) for camera in cameras]
    package_camera_ids = {
        str(camera.get("id", "")).strip()
        for camera in cameras
        if isinstance(camera, Mapping)
    }
    missing_camera_ids = sorted(set(camera_updates) - package_camera_ids)
    if missing_camera_ids:
        raise ValueError(
            "Blender change-set references unknown camera id(s): "
            f"{', '.join(missing_camera_ids)}."
        )
    next_cameras: list[dict[str, Any]] = []
    for camera in cameras:
        next_camera = dict(camera)
        camera_id = str(next_camera.get("id", "")).strip()
        change = camera_updates.get(camera_id)
        if change is not None:
            next_camera.update(_world_camera_change_fields(change, next_camera))
        next_cameras.append(next_camera)
    return next_cameras


def _validate_source_world_object_ids(
    stable_ids: Sequence[str],
    world_package: WorldScenePackageManifest,
) -> None:
    duplicate_ids = sorted(
        stable_id
        for stable_id, count in Counter(stable_ids).items()
        if count > 1
    )
    if duplicate_ids:
        raise ValueError(
            "Blender change-set source world_object_ids contains duplicate id(s): "
            f"{', '.join(duplicate_ids)}."
        )
    package_object_ids = _world_package_object_ids(world_package)
    unknown_ids = sorted(set(stable_ids) - package_object_ids)
    if unknown_ids:
        raise ValueError(
            "Blender change-set source world_object_ids references unknown world object id(s): "
            f"{', '.join(unknown_ids)}."
        )


def _validate_source_camera_ids(
    stable_ids: Sequence[str],
    world_package: WorldScenePackageManifest,
) -> None:
    duplicate_ids = sorted(
        stable_id
        for stable_id, count in Counter(stable_ids).items()
        if count > 1
    )
    if duplicate_ids:
        raise ValueError(
            "Blender change-set source camera_ids contains duplicate id(s): "
            f"{', '.join(duplicate_ids)}."
        )
    package_camera_ids = _world_package_camera_ids(world_package)
    unknown_ids = sorted(set(stable_ids) - package_camera_ids)
    if unknown_ids:
        raise ValueError(
            "Blender change-set source camera_ids references unknown camera id(s): "
            f"{', '.join(unknown_ids)}."
        )


def _required_string_list(value: Any, label: str) -> tuple[str, ...]:
    values = _required_list(value, f"Blender change-set {label}")
    return tuple(
        _required_string(item, f"{label}[{index}]")
        for index, item in enumerate(values)
    )


def _world_object_change_fields(change: BlenderWorldObjectChange) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "position_xyz": list(change.position_xyz),
        "rotation_rpy_rad": list(_quat_wxyz_to_rpy(change.quat_wxyz)),
        "size_xyz": list(change.size_xyz),
    }
    if change.rgba is not None:
        fields["color"] = _rgba_to_hex(change.rgba)
    return fields


def _world_camera_change_fields(
    change: BlenderCameraChange,
    camera: Mapping[str, Any],
) -> dict[str, Any]:
    studio_rotation = _render_local_quat_to_studio_rotation(change.quat_wxyz)
    rpy = studio_rotation.as_euler("xyz")
    fields: dict[str, Any] = {
        "pose": {
            "xyz": list(change.position_xyz),
            "rpy": [float(rpy[0]), float(rpy[1]), float(rpy[2])],
        },
    }
    if change.fov_deg is not None:
        fields["intrinsics"] = _camera_intrinsics_with_fov(
            camera.get("intrinsics"),
            change.fov_deg,
        )
    return fields


def _camera_intrinsics_with_fov(value: Any, fov_deg: float) -> dict[str, Any]:
    intrinsics = dict(value) if isinstance(value, Mapping) else {}
    intrinsics["fov_deg"] = fov_deg
    width = intrinsics.get("width")
    height = intrinsics.get("height")
    if (
        is_finite_number(width)
        and is_finite_number(height)
        and float(width) > 0.0
        and float(height) > 0.0
        and ("fx" in intrinsics or "fy" in intrinsics)
    ):
        fy = focal_length_px_from_vertical_fov_deg(fov_deg, int(float(height)))
        intrinsics["fy"] = fy
        intrinsics["fx"] = fy * (float(width) / float(height))
    return intrinsics


def _render_local_quat_to_studio_rotation(
    quat_wxyz: tuple[float, float, float, float],
) -> Rotation:
    render_rotation = Rotation.from_quat((quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]))
    return render_rotation * world_camera_to_opengl_camera_rotation().inv()


def _new_world_object_fields(
    new_world_objects: Sequence[BlenderNewWorldObject],
    existing_ids: set[str],
) -> list[dict[str, Any]]:
    used_ids = set(existing_ids)
    fields: list[dict[str, Any]] = []
    for item in new_world_objects:
        object_id = _next_blender_object_id(item.sim_name, used_ids)
        used_ids.add(object_id)
        world_object = {
            "id": object_id,
            "name": item.sim_name,
            "type": "mesh" if item.asset_ref else "cube",
            "position_xyz": list(item.position_xyz),
            "rotation_rpy_rad": list(_quat_wxyz_to_rpy(item.quat_wxyz)),
            "size_xyz": list(item.size_xyz),
            "color": _rgba_to_hex(item.rgba) if item.rgba else "#3b82f6",
            "simulation": {
                "fixed": True,
                "collision": True,
                "semantic_role": "blender_import",
            },
        }
        if item.asset_ref:
            world_object["asset_ref"] = item.asset_ref
        fields.append(world_object)
    return fields


def _next_blender_object_id(name: str, used_ids: set[str]) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip()).strip("._").lower()
    base = f"blender_{normalized or 'object'}"
    candidate = base
    suffix = 2
    while candidate in used_ids:
        candidate = f"{base}_{suffix}"
        suffix += 1
    return candidate


def _required_list(value: Any, label: str) -> Sequence[Any]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ValueError(f"{label} must be a list.")
    return value


def _required_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Blender change-set {label} must be a non-empty string.")
    return value.strip()


def _optional_asset_ref(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Blender change-set {label} must be a non-empty string.")
    try:
        return normalize_portable_world_asset_ref(value)
    except ValueError as exc:
        raise ValueError(
            f"Blender change-set {label} must be a portable relative asset reference."
        ) from exc


def _reject_unknown_fields(value: Mapping[str, Any], path: str, allowed_fields: set[str]) -> None:
    unknown_fields = sorted(str(field) for field in value.keys() if field not in allowed_fields)
    if unknown_fields:
        raise ValueError(
            f"Blender change-set {path} contains unsupported field(s): "
            f"{', '.join(unknown_fields)}."
        )


def _required_vector(value: Any, label: str, expected_length: int) -> tuple[float, ...]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, str)
        or len(value) != expected_length
    ):
        raise ValueError(f"Blender change-set {label} must be a {expected_length}-number list.")
    if not all(is_finite_number(item) for item in value):
        raise ValueError(f"Blender change-set {label} must contain only finite numbers.")
    numbers = tuple(float(item) for item in value)
    return numbers


def _required_vector3(value: Any, label: str) -> tuple[float, float, float]:
    numbers = _required_vector(value, label, 3)
    return (numbers[0], numbers[1], numbers[2])


def _required_positive_vector3(value: Any, label: str) -> tuple[float, float, float]:
    numbers = _required_vector3(value, label)
    if any(number <= 0.0 for number in numbers):
        raise ValueError(f"Blender change-set {label} must contain positive dimensions.")
    return numbers


def _optional_rgba(value: Any, label: str) -> tuple[float, float, float, float] | None:
    if value is None:
        return None
    numbers = _required_vector(value, label, 4)
    if any(number < 0.0 or number > 1.0 for number in numbers):
        raise ValueError(f"Blender change-set {label} must contain numbers between 0 and 1.")
    return (numbers[0], numbers[1], numbers[2], numbers[3])


def _optional_camera_fov_deg(value: Any, label: str) -> float | None:
    if value is None:
        return None
    if not is_finite_number(value):
        raise ValueError(f"Blender change-set {label} must be a finite number.")
    parsed = float(value)
    if not 1.0 <= parsed <= 179.0:
        raise ValueError(f"Blender change-set {label} must be between 1 and 179 degrees.")
    return parsed


def _required_quat_wxyz(value: Any, label: str) -> tuple[float, float, float, float]:
    numbers = _required_vector(value, label, 4)
    norm = math.sqrt(sum(number * number for number in numbers))
    if norm <= 0.0:
        raise ValueError(f"Blender change-set {label} must be a non-zero quaternion.")
    return (
        numbers[0] / norm,
        numbers[1] / norm,
        numbers[2] / norm,
        numbers[3] / norm,
    )


def _quat_wxyz_to_rpy(quat_wxyz: tuple[float, float, float, float]) -> tuple[float, float, float]:
    rotation = Rotation.from_quat((quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]))
    rpy = rotation.as_euler("xyz")
    return (float(rpy[0]), float(rpy[1]), float(rpy[2]))


def _rgba_to_hex(rgba: tuple[float, float, float, float]) -> str:
    red, green, blue, _alpha = rgba
    return "#{:02x}{:02x}{:02x}".format(
        round(red * 255.0),
        round(green * 255.0),
        round(blue * 255.0),
    )
