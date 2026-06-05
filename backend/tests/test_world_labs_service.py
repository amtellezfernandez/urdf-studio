from __future__ import annotations

import json
from io import BytesIO
from urllib.request import Request

from backend.models.world_labs import WorldLabsGenerateRequest, WorldLabsListWorldsRequest
from backend.services.world_labs import WorldLabsService


class FakeHttpResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return BytesIO(self._body).read()


def test_world_labs_generation_uses_backend_key_header_and_request_shape() -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(request: Request, timeout: int):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads((request.data or b"{}").decode("utf-8"))
        return FakeHttpResponse({"operation_id": "op_123", "created_at": "2026-06-06T00:00:00Z"})

    service = WorldLabsService(
        api_key="test-key",
        api_base_url="https://api.example.test/marble/v1",
        timeout_seconds=7,
        urlopen=fake_urlopen,
    )
    response = service.start_generation(
        WorldLabsGenerateRequest(
            prompt="Generate a warehouse loading bay with pallets and robot lanes.",
            display_name="Warehouse loading bay",
            tags=["wsp", "hk"],
            seed=42,
        )
    )

    assert response.operation_id == "op_123"
    assert captured["url"] == "https://api.example.test/marble/v1/worlds:generate"
    assert captured["timeout"] == 7
    assert captured["headers"]["Wlt-api-key"] == "test-key"
    body = captured["body"]
    assert body["world_prompt"]["type"] == "text"
    assert body["world_prompt"]["text_prompt"].startswith("Generate a warehouse")
    assert body["permission"]["allow_id_access"] is True
    assert body["permission"]["public"] is False
    assert body["model"] == "marble-1.0"


def test_world_labs_operation_maps_completed_world_to_wsp_package() -> None:
    def fake_urlopen(request: Request, timeout: int):
        return FakeHttpResponse(
            {
                "operation_id": "op_123",
                "done": True,
                "metadata": {"world_id": "world_abc"},
                "response": {
                    "world_id": "world_abc",
                    "display_name": "Warehouse loading bay",
                    "world_marble_url": "https://marble.worldlabs.ai/world/world_abc",
                    "assets": {
                        "thumbnail_url": "https://cdn.example.test/thumb.jpg",
                        "pano": {"pano_url": "https://cdn.example.test/pano.jpg"},
                        "mesh": {"collider_mesh_url": "https://cdn.example.test/collider.glb"},
                        "splats": {
                            "semantics_metadata": {
                                "metric_scale_factor": 0.42,
                                "ground_plane_offset": -0.1,
                            },
                            "spz_urls": {"main": "https://cdn.example.test/world.spz"},
                        },
                    },
                },
            }
        )

    service = WorldLabsService(
        api_key="test-key",
        api_base_url="https://api.example.test/marble/v1",
        urlopen=fake_urlopen,
    )
    status = service.get_operation("op_123")

    assert status.done is True
    assert status.world_id == "world_abc"
    assert status.metric_scale_factor == 0.42
    assert status.collider_mesh_url == "https://cdn.example.test/collider.glb"
    assert status.world_package is not None
    assert status.world_package.package_id == "world-labs-world-abc"
    assert status.world_package.provenance["source"] == "world_labs"
    assert status.world_package.provenance["source_registry"] == "world-labs-marble"
    assert status.world_package.provenance["preview_image_url"] == "https://cdn.example.test/thumb.jpg"
    assert status.world_package.provenance["tags"] == ["world-labs", "marble", "generated", "wsp"]
    assert status.world_package.provenance["world_marble_url"] == "https://marble.worldlabs.ai/world/world_abc"
    assert status.world_package.provenance["share"]["world_id"] == "world_abc"
    assert any(artifact.kind == "world_labs_collider_mesh" for artifact in status.world_package.artifacts)


def test_world_labs_lists_persistent_worlds() -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(request: Request, timeout: int):
        captured["url"] = request.full_url
        captured["body"] = json.loads((request.data or b"{}").decode("utf-8"))
        return FakeHttpResponse(
            {
                "worlds": [
                    {
                        "world_id": "world_abc",
                        "display_name": "Warehouse loading bay",
                        "world_marble_url": "https://marble.worldlabs.ai/world/world_abc",
                        "permission": {"public": False},
                        "assets": {"thumbnail_url": "https://cdn.example.test/thumb.jpg"},
                    }
                ],
                "next_page_token": "next-1",
            }
        )

    service = WorldLabsService(
        api_key="test-key",
        api_base_url="https://api.example.test/marble/v1",
        urlopen=fake_urlopen,
    )
    worlds = service.list_worlds(WorldLabsListWorldsRequest(page_size=10, tags=["wsp"]))

    assert captured["url"] == "https://api.example.test/marble/v1/worlds:list"
    assert captured["body"] == {"page_size": 10, "tags": ["wsp"]}
    assert worlds.next_page_token == "next-1"
    assert len(worlds.worlds) == 1
    assert worlds.worlds[0].world_id == "world_abc"
    assert worlds.worlds[0].public is False
    assert worlds.worlds[0].thumbnail_url == "https://cdn.example.test/thumb.jpg"


def test_world_labs_imports_existing_world_as_wsp_fork() -> None:
    def fake_urlopen(request: Request, timeout: int):
        assert request.full_url == "https://api.example.test/marble/v1/worlds/world_abc"
        return FakeHttpResponse(
            {
                "world": {
                    "world_id": "world_abc",
                    "display_name": "Warehouse loading bay",
                    "world_marble_url": "https://marble.worldlabs.ai/world/world_abc",
                    "assets": {
                        "thumbnail_url": "https://cdn.example.test/thumb.jpg",
                        "mesh": {"collider_mesh_url": "https://cdn.example.test/collider.glb"},
                        "splats": {
                            "semantics_metadata": {
                                "metric_scale_factor": 0.5,
                                "ground_plane_offset": 0.02,
                            }
                        },
                    },
                }
            }
        )

    service = WorldLabsService(
        api_key="test-key",
        api_base_url="https://api.example.test/marble/v1",
        urlopen=fake_urlopen,
    )
    imported = service.import_world("world_abc")

    assert imported.world_id == "world_abc"
    assert imported.metric_scale_factor == 0.5
    assert imported.world_package.package_id == "world-labs-world-abc"
    assert imported.world_package.provenance["operation_id"] is None
    assert imported.world_package.provenance["share"]["world_marble_url"] == (
        "https://marble.worldlabs.ai/world/world_abc"
    )
