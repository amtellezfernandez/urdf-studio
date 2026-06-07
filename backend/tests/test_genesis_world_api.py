from __future__ import annotations

import backend.api.genesis_world as genesis_world_api
from backend.models.genesis_world import (
    GenesisWorldOpenRequest,
    GenesisWorldOpenResponse,
)


def test_open_genesis_world_endpoint_launches_default_scene(monkeypatch) -> None:
    launched_modes: list[str] = []

    def fake_launch_default_genesis_world(*, dynamic_container_mode):
        launched_modes.append(dynamic_container_mode)
        return GenesisWorldOpenResponse(
            started=True,
            pid=1234,
            command=["python", "-m", "backend.scripts.genesis_world_open"],
            dynamic_container_mode=dynamic_container_mode,
        )

    monkeypatch.setattr(
        genesis_world_api,
        "launch_default_genesis_world",
        fake_launch_default_genesis_world,
    )
    response = genesis_world_api.open_genesis_world(
        GenesisWorldOpenRequest(dynamic_container_mode="mesh"),
        _access=None,
    )

    assert response.pid == 1234
    assert response.dynamic_container_mode == "mesh"
    assert launched_modes == ["mesh"]
