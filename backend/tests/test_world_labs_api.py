from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.api.world_labs as world_labs_api
from backend.app import create_app
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
from backend.models.world_labs import (
    WorldLabsGenerateResponse,
    WorldLabsListWorldsResponse,
    WorldLabsOperationStatusResponse,
    WorldLabsWorldImportResponse,
    WorldLabsWorldSummary,
)
from backend.services.world_labs import WorldLabsService

TEST_SIMULATOR_TOKEN = "world-labs-test-token"


def _operator_headers() -> dict[str, str]:
    return {SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN}


def _patch_security_settings():
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=TEST_SIMULATOR_TOKEN, cam_to_sim_proxy_token=None),
    )


class FakeWorldLabsService:
    configured = True
    generate_endpoint = "https://api.example.test/marble/v1/worlds:generate"

    def start_generation(self, request):
        assert request.prompt.startswith("Generate")
        return WorldLabsGenerateResponse(
            operation_id="op_test",
            status_url="/worlds/world-labs/operations/op_test",
            raw_response={"operation_id": "op_test"},
        )

    def get_operation(self, operation_id: str):
        return WorldLabsOperationStatusResponse(
            operation_id=operation_id,
            done=False,
            metadata={"progress": 0.25},
            raw_response={"operation_id": operation_id, "done": False},
        )

    def list_worlds(self, request):
        assert request.page_size == 5
        return WorldLabsListWorldsResponse(
            worlds=[
                WorldLabsWorldSummary(
                    world_id="world_abc",
                    display_name="Robot warehouse",
                    world_marble_url="https://marble.worldlabs.ai/world/world_abc",
                    thumbnail_url="https://cdn.example.test/thumb.jpg",
                    public=False,
                )
            ],
            next_page_token=None,
            raw_response={"worlds": [{"world_id": "world_abc"}]},
        )

    def import_world(self, world_id: str):
        service = WorldLabsService(api_key="test-key", api_base_url="https://api.example.test/marble/v1")
        manifest = service.build_world_scene_package(
            {
                "world_id": world_id,
                "display_name": "Robot warehouse",
                "world_marble_url": f"https://marble.worldlabs.ai/world/{world_id}",
                "assets": {"thumbnail_url": "https://cdn.example.test/thumb.jpg"},
            },
            operation_id=None,
            world_id=world_id,
        )
        return WorldLabsWorldImportResponse(
            world_id=world_id,
            world_marble_url=f"https://marble.worldlabs.ai/world/{world_id}",
            thumbnail_url="https://cdn.example.test/thumb.jpg",
            world_package=manifest,
            raw_world={"world_id": world_id},
        )


def test_world_labs_capabilities_does_not_expose_api_key(monkeypatch) -> None:
    monkeypatch.setattr(world_labs_api, "world_labs_service", FakeWorldLabsService())
    client = TestClient(create_app())

    with _patch_security_settings():
        response = client.get("/worlds/world-labs/capabilities", headers=_operator_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert "api_key" not in str(payload).lower()
    assert payload["marble_url"] == "https://marble.worldlabs.ai"
    assert payload["default_model"] == "marble-1.0"
    assert "marble-1.1-plus" in payload["models"]


def test_world_labs_generate_and_operation_routes(monkeypatch) -> None:
    monkeypatch.setattr(world_labs_api, "world_labs_service", FakeWorldLabsService())
    client = TestClient(create_app())

    with _patch_security_settings():
        generate = client.post(
            "/worlds/world-labs/generate",
            headers=_operator_headers(),
            json={
                "prompt": "Generate a robot warehouse test scene with dock doors.",
                "display_name": "Robot warehouse",
                "tags": ["wsp", "world-labs"],
            },
        )
        operation = client.get(
            "/worlds/world-labs/operations/op_test",
            headers=_operator_headers(),
        )

    assert generate.status_code == 200
    assert generate.json()["operation_id"] == "op_test"
    assert operation.status_code == 200
    assert operation.json()["done"] is False


def test_world_labs_library_routes(monkeypatch) -> None:
    monkeypatch.setattr(world_labs_api, "world_labs_service", FakeWorldLabsService())
    client = TestClient(create_app())

    with _patch_security_settings():
        listed = client.post(
            "/worlds/world-labs/worlds:list",
            headers=_operator_headers(),
            json={"page_size": 5},
        )
        imported = client.get(
            "/worlds/world-labs/worlds/world_abc",
            headers=_operator_headers(),
        )

    assert listed.status_code == 200
    assert listed.json()["worlds"][0]["world_id"] == "world_abc"
    assert listed.json()["worlds"][0]["public"] is False
    assert imported.status_code == 200
    assert imported.json()["world_package"]["package_id"] == "world-labs-world-abc"
    assert "api_key" not in str(imported.json()).lower()
