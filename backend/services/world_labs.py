from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

from backend.core.settings import settings
from backend.models.world_labs import (
    WorldLabsGenerateRequest,
    WorldLabsGenerateResponse,
    WorldLabsListWorldsRequest,
    WorldLabsListWorldsResponse,
    WorldLabsOperationStatusResponse,
    WorldLabsWorldImportResponse,
    WorldLabsWorldSummary,
)
from backend.models.world_scene_package import (
    WorldArtifactRef,
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSecuritySpec,
    WorldSnapshot,
)
from backend.services.world_scene_package_params import WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1


WORLD_LABS_DOCS_URL = "https://docs.worldlabs.ai/api/reference/worlds/generate"
WORLD_LABS_MARBLE_URL = "https://marble.worldlabs.ai"


class WorldLabsError(RuntimeError):
    pass


UrlOpen = Callable[..., Any]


def _slug(value: str, *, fallback: str = "world-labs-world") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:80] or fallback


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _read_json_response(response: Any) -> dict[str, Any]:
    data = response.read()
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _nested_record(value: dict[str, Any], *keys: str) -> dict[str, Any]:
    current: Any = value
    for key in keys:
        current = _as_record(current).get(key)
    return _as_record(current)


def _nested_value(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value
    for key in keys:
        current = _as_record(current).get(key)
    return current


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _world_from_response(raw: dict[str, Any]) -> dict[str, Any]:
    world = _as_record(raw.get("world"))
    if world:
        return world
    response = _as_record(raw.get("response"))
    if response:
        return response
    return raw


def _world_id_from_operation(raw: dict[str, Any], world: dict[str, Any]) -> str | None:
    for candidate in (
        world.get("world_id"),
        raw.get("world_id"),
        _nested_value(raw, "metadata", "world_id"),
        _nested_value(raw, "metadata", "world", "world_id"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _world_id_from_world(world: dict[str, Any], *, fallback: str | None = None) -> str | None:
    for candidate in (world.get("world_id"), world.get("id"), fallback):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _world_permission_is_public(world: dict[str, Any]) -> bool | None:
    permission = _as_record(world.get("permission"))
    public = permission.get("public")
    return public if isinstance(public, bool) else None


def _string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _number_value(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _world_assets(world: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    assets = _as_record(world.get("assets"))
    semantics = _nested_record(assets, "splats", "semantics_metadata")
    mesh = _nested_record(assets, "mesh")
    return assets, semantics, mesh


def _world_summary(world: dict[str, Any]) -> WorldLabsWorldSummary | None:
    world_id = _world_id_from_world(world)
    if not world_id:
        return None
    assets, _, _ = _world_assets(world)
    return WorldLabsWorldSummary(
        world_id=world_id,
        display_name=_string_value(world.get("display_name")),
        world_marble_url=_string_value(world.get("world_marble_url")),
        thumbnail_url=_string_value(assets.get("thumbnail_url")),
        created_at=_string_value(world.get("created_at")),
        updated_at=_string_value(world.get("updated_at")),
        public=_world_permission_is_public(world),
        raw_world=world,
    )


class WorldLabsService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_base_url: str | None = None,
        timeout_seconds: int | None = None,
        urlopen: UrlOpen | None = None,
    ) -> None:
        self._api_key = api_key if api_key is not None else settings.world_labs_api_key
        self._api_base_url = (api_base_url or settings.world_labs_api_base_url).rstrip("/")
        self._timeout_seconds = timeout_seconds or settings.world_labs_timeout_seconds
        self._urlopen = urlopen or urllib.request.urlopen

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    @property
    def generate_endpoint(self) -> str:
        return f"{self._api_base_url}/worlds:generate"

    def _request_json(
        self,
        path: str,
        *,
        method: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self._api_key:
            raise WorldLabsError("WORLD_LABS_API_KEY is not configured.")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self._api_base_url}{path}",
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "WLT-Api-Key": self._api_key,
                **({"Content-Type": "application/json"} if payload is not None else {}),
            },
        )
        try:
            with self._urlopen(request, timeout=self._timeout_seconds) as response:
                return _read_json_response(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")
            raise WorldLabsError(f"World Labs API returned HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise WorldLabsError(f"World Labs API unavailable: {exc.reason}") from exc

    def start_generation(self, request: WorldLabsGenerateRequest) -> WorldLabsGenerateResponse:
        payload: dict[str, Any] = {
            "world_prompt": {
                "type": "text",
                "text_prompt": request.prompt,
                "disable_recaption": request.disable_recaption,
            },
            "display_name": request.display_name,
            "model": request.model,
            "permission": {
                "allow_id_access": request.allow_id_access,
                "allowed_readers": [],
                "allowed_writers": [],
                "public": request.public,
            },
            "tags": request.tags,
        }
        if request.seed is not None:
            payload["seed"] = request.seed
        raw = self._request_json("/worlds:generate", method="POST", payload=payload)
        operation_id = raw.get("operation_id")
        if not isinstance(operation_id, str) or not operation_id.strip():
            raise WorldLabsError("World Labs generation response did not include operation_id.")
        return WorldLabsGenerateResponse(
            operation_id=operation_id,
            created_at=raw.get("created_at") if isinstance(raw.get("created_at"), str) else None,
            updated_at=raw.get("updated_at") if isinstance(raw.get("updated_at"), str) else None,
            expires_at=raw.get("expires_at") if isinstance(raw.get("expires_at"), str) else None,
            status_url=f"/worlds/world-labs/operations/{operation_id}",
            raw_response=raw,
        )

    def get_operation(self, operation_id: str) -> WorldLabsOperationStatusResponse:
        raw = self._request_json(f"/operations/{operation_id}", method="GET")
        world = _as_record(raw.get("response"))
        assets, semantics, mesh = _world_assets(world)
        thumbnail_url = assets.get("thumbnail_url")
        world_id = _world_id_from_operation(raw, world)
        metric_scale_factor = semantics.get("metric_scale_factor")
        ground_plane_offset = semantics.get("ground_plane_offset")
        world_package = (
            self.build_world_scene_package(world, operation_id=operation_id, world_id=world_id)
            if raw.get("done") is True and world
            else None
        )
        return WorldLabsOperationStatusResponse(
            operation_id=str(raw.get("operation_id") or operation_id),
            done=raw.get("done") is True,
            error=_as_record(raw.get("error")) or None,
            metadata=_as_record(raw.get("metadata")),
            world_id=world_id,
            world_marble_url=world.get("world_marble_url") if isinstance(world.get("world_marble_url"), str) else None,
            thumbnail_url=thumbnail_url if isinstance(thumbnail_url, str) else None,
            collider_mesh_url=(
                mesh.get("collider_mesh_url") if isinstance(mesh.get("collider_mesh_url"), str) else None
            ),
            metric_scale_factor=(
                float(metric_scale_factor) if isinstance(metric_scale_factor, int | float) else None
            ),
            ground_plane_offset=(
                float(ground_plane_offset) if isinstance(ground_plane_offset, int | float) else None
            ),
            world_package=world_package,
            raw_response=raw,
        )

    def list_worlds(self, request: WorldLabsListWorldsRequest) -> WorldLabsListWorldsResponse:
        payload = request.model_dump(mode="json", exclude_none=True)
        raw = self._request_json("/worlds:list", method="POST", payload=payload)
        raw_worlds = (
            _as_list(raw.get("worlds"))
            or _as_list(raw.get("items"))
            or _as_list(raw.get("results"))
        )
        worlds = [
            summary
            for summary in (_world_summary(_as_record(raw_world)) for raw_world in raw_worlds)
            if summary is not None
        ]
        next_page_token = raw.get("next_page_token") or raw.get("nextPageToken")
        return WorldLabsListWorldsResponse(
            worlds=worlds,
            next_page_token=next_page_token if isinstance(next_page_token, str) else None,
            raw_response=raw,
        )

    def import_world(self, world_id: str) -> WorldLabsWorldImportResponse:
        resolved_world_id = world_id.strip()
        if not resolved_world_id:
            raise WorldLabsError("World Labs world_id is required.")
        raw = self._request_json(f"/worlds/{resolved_world_id}", method="GET")
        world = _world_from_response(raw)
        actual_world_id = _world_id_from_world(world, fallback=resolved_world_id)
        if not actual_world_id:
            raise WorldLabsError("World Labs world response did not include world_id.")
        assets, semantics, mesh = _world_assets(world)
        thumbnail_url = _string_value(assets.get("thumbnail_url"))
        collider_mesh_url = _string_value(mesh.get("collider_mesh_url"))
        world_package = self.build_world_scene_package(
            world,
            operation_id=_string_value(world.get("operation_id")),
            world_id=actual_world_id,
        )
        return WorldLabsWorldImportResponse(
            world_id=actual_world_id,
            world_marble_url=_string_value(world.get("world_marble_url")),
            thumbnail_url=thumbnail_url,
            collider_mesh_url=collider_mesh_url,
            metric_scale_factor=_number_value(semantics.get("metric_scale_factor")),
            ground_plane_offset=_number_value(semantics.get("ground_plane_offset")),
            world_package=world_package,
            raw_world=world,
        )

    def build_world_scene_package(
        self,
        world: dict[str, Any],
        *,
        operation_id: str | None,
        world_id: str | None = None,
    ) -> WorldScenePackageManifest:
        resolved_world_id = world_id or str(world.get("world_id") or operation_id)
        display_name = (
            world.get("display_name")
            if isinstance(world.get("display_name"), str) and world.get("display_name")
            else f"World Labs {resolved_world_id}"
        )
        package_id = f"world-labs-{_slug(resolved_world_id)}"
        assets = _as_record(world.get("assets"))
        mesh = _nested_record(assets, "mesh")
        pano = _nested_record(assets, "pano")
        splats = _nested_record(assets, "splats")
        semantics = _nested_record(splats, "semantics_metadata")
        thumbnail_url = assets.get("thumbnail_url")
        collider_mesh_url = mesh.get("collider_mesh_url")
        pano_url = pano.get("pano_url")
        world_marble_url = world.get("world_marble_url")
        artifact_urls = [
            ("world_labs_marble", world_marble_url),
            ("world_labs_thumbnail", thumbnail_url),
            ("world_labs_collider_mesh", collider_mesh_url),
            ("world_labs_panorama", pano_url),
        ]
        spz_urls = splats.get("spz_urls")
        if isinstance(spz_urls, dict):
            for key, uri in sorted(spz_urls.items()):
                artifact_urls.append((f"world_labs_splat_{key}", uri))
        artifacts = [
            WorldArtifactRef(
                kind=kind,
                digest_sha256=_sha256_text(str(uri)),
                uri=str(uri),
            )
            for kind, uri in artifact_urls
            if isinstance(uri, str) and uri.strip()
        ]
        metric_scale_factor = semantics.get("metric_scale_factor")
        ground_plane_offset = semantics.get("ground_plane_offset")
        now = datetime.now(timezone.utc)
        return WorldScenePackageManifest(
            schema_version=WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
            package_id=package_id,
            version="0.1.0",
            title=str(display_name),
            description=(
                "Generated with World Labs Marble and imported as a WSP package. "
                "Use WSP audit/replay before treating generated geometry as robot-executable."
            ),
            created_at=now,
            runtime_targets=[
                WorldRuntimeTarget(name="mujoco", mode="python"),
                WorldRuntimeTarget(name="genesis", mode="python"),
                WorldRuntimeTarget(name="wsp", mode="native"),
            ],
            interface=WorldInterfaceSpec(
                observation_modalities=["rgb", "mesh", "splat", "collider"],
                action_semantics="world_scene_static_layout",
                timestep_ms=33,
                frame_convention="world-labs-generated-metric-scale",
            ),
            artifacts=artifacts,
            world_snapshot=WorldSnapshot(
                urdf_xml="<robot name='world_labs_generated_world'/>",
                joint_positions={},
                cameras=[],
                objects=[
                    {
                        "id": "world-labs-ground-reference",
                        "name": "World Labs ground reference",
                        "type": "cube",
                        "position_xyz": [0.0, -0.025, 0.0],
                        "rotation_rpy_rad": [0.0, 0.0, 0.0],
                        "size_xyz": [6.0, 0.05, 6.0],
                        "color": "#4c8f6a",
                        "source": "world-scenario",
                        "is_ik_target": False,
                    },
                    {
                        "id": "world-labs-collider-proxy",
                        "name": "Generated collider proxy",
                        "type": "cube",
                        "position_xyz": [0.0, 0.5, 0.0],
                        "rotation_rpy_rad": [0.0, 0.0, 0.0],
                        "size_xyz": [2.0, 1.0, 2.0],
                        "color": "#3b82f6",
                        "source": "world-scenario",
                        "is_hidden": True,
                        "is_ik_target": False,
                    },
                ],
                scenario_time_ms=0,
                scenario_duration_ms=0,
            ),
            provenance={
                "source": "world_labs",
                "provider": "World Labs",
                "source_registry": "world-labs-marble",
                "preview_image_url": thumbnail_url,
                "tags": ["world-labs", "marble", "generated", "wsp"],
                "operation_id": operation_id,
                "world_id": resolved_world_id,
                "world_marble_url": world_marble_url,
                "thumbnail_url": thumbnail_url,
                "collider_mesh_url": collider_mesh_url,
                "metric_scale_factor": metric_scale_factor,
                "ground_plane_offset": ground_plane_offset,
                "share": {
                    "provider": "World Labs Marble",
                    "world_id": resolved_world_id,
                    "operation_id": operation_id,
                    "world_marble_url": world_marble_url,
                    "thumbnail_url": thumbnail_url,
                },
                "raw_world": world,
                "notes": [
                    "Generated geometry is a candidate world asset, not a certified robot-executable scene.",
                    "Run WSP audit/replay after metric scale and collision checks.",
                ],
            },
            security=WorldSecuritySpec(),
        )


world_labs_service = WorldLabsService()
