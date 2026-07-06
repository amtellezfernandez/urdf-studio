from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone

from pydantic import ValidationError

from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldSecuritySpec,
    WorldSnapshot,
)
from backend.services.world_scene_package_params import WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1

_DEFAULT_CREATED_AT = datetime(1970, 1, 1, tzinfo=timezone.utc)
_DEFAULT_FRAME_CONVENTION = "ros-rep-103"
_DEFAULT_ACTION_SEMANTICS = "joint_position_rad"
_DEFAULT_TIMESTEP_MS = 33


def _is_record(value: object) -> bool:
    return isinstance(value, dict)


def _read_optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _read_environment(
    payload: Mapping[str, object],
    world: Mapping[str, object],
) -> dict[str, object] | None:
    environment = payload.get("environment")
    if not _is_record(environment):
        environment = world.get("environment")
    if not _is_record(environment):
        return None
    return {str(key): value for key, value in environment.items()}


def _read_frame_convention(
    payload: Mapping[str, object],
    world: Mapping[str, object],
) -> str:
    environment = _read_environment(payload, world)
    frame_convention = (
        _read_optional_string(environment.get("frame_convention"))
        if environment is not None
        else None
    )
    return frame_convention or _DEFAULT_FRAME_CONVENTION


def _read_created_at(payload: Mapping[str, object], provenance: Mapping[str, object]) -> datetime:
    for candidate in (payload.get("created_at"), provenance.get("created_at")):
        if not isinstance(candidate, str):
            continue
        try:
            return datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        except ValueError:
            continue
    return _DEFAULT_CREATED_AT


def _normalize_provenance(
    payload: Mapping[str, object],
    environment: Mapping[str, object] | None,
) -> dict[str, object]:
    provenance = payload.get("provenance")
    normalized: dict[str, object] = (
        {str(key): value for key, value in provenance.items()} if _is_record(provenance) else {}
    )
    if environment is None:
        return normalized
    current_environment = normalized.get("environment")
    merged_environment = (
        {str(key): value for key, value in current_environment.items()}
        if _is_record(current_environment)
        else {}
    )
    merged_environment.update(environment)
    normalized["environment"] = merged_environment
    return normalized


def _world_snapshot_from_world_payload(world: Mapping[str, object]) -> WorldSnapshot:
    return WorldSnapshot.model_validate(
        {
            "urdf_xml": world.get("urdf_xml", "<robot name='world'/>"),
            "joint_positions": world.get("joint_positions", {}),
            "cameras": world.get("cameras", []),
            "objects": world.get("objects", []),
            "scenario_time_ms": world.get("scenario_time_ms"),
            "scenario_duration_ms": world.get("scenario_duration_ms"),
        }
    )


def is_world_scene_registry_envelope_payload(payload: object) -> bool:
    return (
        _is_record(payload)
        and "package_id" in payload
        and "version" in payload
        and _is_record(payload.get("world"))
    )


def manifest_from_world_scene_registry_envelope(payload: object) -> WorldScenePackageManifest:
    if not _is_record(payload):
        raise ValueError("World scene registry envelope must be a JSON object.")
    world = payload.get("world")
    if not _is_record(world):
        raise ValueError("World scene registry envelope must contain a world object.")

    environment = _read_environment(payload, world)
    provenance = _normalize_provenance(payload, environment)
    created_at = _read_created_at(payload, provenance)
    frame_convention = _read_frame_convention(payload, world)
    snapshot = _world_snapshot_from_world_payload(world)
    observation_modalities = ["rgb", "proprio"] if snapshot.cameras else ["proprio"]
    normalized_payload: dict[str, object] = {
        "schema_version": WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1,
        "package_id": payload.get("package_id"),
        "version": payload.get("version"),
        "title": (
            _read_optional_string(world.get("name"))
            or _read_optional_string(payload.get("title"))
            or payload.get("package_id")
        ),
        "created_at": created_at,
        "runtime_targets": [],
        "interface": WorldInterfaceSpec(
            observation_modalities=observation_modalities,
            action_semantics=_DEFAULT_ACTION_SEMANTICS,
            timestep_ms=_DEFAULT_TIMESTEP_MS,
            frame_convention=frame_convention,
        ),
        "artifacts": payload.get("artifacts", []),
        "world_snapshot": snapshot,
        "provenance": provenance,
        "security": WorldSecuritySpec(
            signature_ref=None,
            attestation_refs=[],
            sbom_ref=None,
        ),
    }
    description = _read_optional_string(payload.get("description"))
    if description is not None:
        normalized_payload["description"] = description

    try:
        return WorldScenePackageManifest.model_validate(normalized_payload)
    except ValidationError as exc:
        raise ValueError(f"Invalid world scene registry envelope: {exc}") from exc


def read_world_scene_package_manifest(payload: object) -> WorldScenePackageManifest:
    if isinstance(payload, WorldScenePackageManifest):
        return payload
    if is_world_scene_registry_envelope_payload(payload):
        return manifest_from_world_scene_registry_envelope(payload)
    return WorldScenePackageManifest.model_validate(payload)
