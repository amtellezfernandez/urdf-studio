from __future__ import annotations

from backend.app import create_app
from backend.models.xacro import XacroExpandRequest
from backend.tests.asgi_test_client import AsgiTestClient


LOOPBACK_TEST_CLIENT = ("127.0.0.1", 50000)


def _client() -> AsgiTestClient:
    return AsgiTestClient(create_app(), client=LOOPBACK_TEST_CLIENT)


def test_clean_backend_exposes_only_release_routes() -> None:
    client = _client()

    assert client.get("/health").status_code == 200
    assert client.get("/simulators").status_code == 200
    assert client.get("/workspace-transfer/targets").status_code == 200

    assert client.get("/robot-gateway/manifest").status_code == 404
    assert client.get("/datasets").status_code == 404
    assert client.get("/teleop/mjlab/runtime").status_code == 404


def test_simulator_list_is_first_release_target_set() -> None:
    response = _client().get("/simulators")

    assert response.status_code == 200
    payload = response.json()
    assert [entry["simulatorId"] for entry in payload["simulators"]] == [
        "genesis",
        "mujoco",
        "mjx",
        "pybullet",
        "isaac-sim",
        "isaac-lab",
        "isaac-gym",
        "sapien",
        "coppeliasim",
        "blender",
    ]
    planned = {
        entry["simulatorId"]
        for entry in payload["simulators"]
        if entry["transferPolicy"]["transferStrategy"] == "planned"
    }
    assert planned == {
        "isaac-sim",
        "isaac-lab",
        "isaac-gym",
    }


def test_xacro_expand_uses_uploaded_file_contract(monkeypatch) -> None:
    seen_request: XacroExpandRequest | None = None

    def fake_expand_xacro(request: XacroExpandRequest) -> tuple[str, str | None]:
        nonlocal seen_request
        seen_request = request
        return "<robot name=\"expanded\" />", "warning"

    monkeypatch.setattr("backend.api.ilu_urdf.expand_xacro", fake_expand_xacro)

    response = _client().post(
        "/ilu/expand",
        json={
            "target_path": "robot.urdf.xacro",
            "files": [
                {
                    "path": "robot.urdf.xacro",
                    "content_base64": "PHJvYm90IG5hbWU9IngiIC8+",
                }
            ],
            "args": {"prefix": "demo"},
            "use_inorder": True,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"urdf": "<robot name=\"expanded\" />", "stderr": "warning"}
    assert seen_request is not None
    assert seen_request.target_path == "robot.urdf.xacro"
    assert seen_request.files[0].path == "robot.urdf.xacro"
