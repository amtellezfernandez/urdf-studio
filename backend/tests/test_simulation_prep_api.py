from __future__ import annotations

from backend.tests.asgi_test_client import AsgiTestClient

from backend.app import create_app
from backend.models.simulation_prep import SimulationPrepValidationReport


TEST_LOOPBACK_CLIENT = ("127.0.0.1", 50000)


def test_validate_simulation_prep_uploads_urdf_and_meshes(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run_validation(urdf_content: str, mesh_files_by_name: dict[str, bytes]) -> SimulationPrepValidationReport:
        captured["urdf_content"] = urdf_content
        captured["mesh_files_by_name"] = mesh_files_by_name
        return SimulationPrepValidationReport(
            success=True,
            error=None,
            geometry_count=0,
            geometries=[],
            smoke_simulation=None,
            mujoco_available=False,
            warnings=[],
        )

    monkeypatch.setattr("backend.api.simulation_prep.run_simulation_prep_validation", fake_run_validation)

    client = AsgiTestClient(create_app(), client=TEST_LOOPBACK_CLIENT)
    response = client.post(
        "/simulation-prep/validate",
        files=[
            ("urdf_file", ("robot.urdf", b"<robot name='demo'/>", "text/xml")),
            ("mesh_files", ("wheel.stl", b"solid wheel", "model/stl")),
        ],
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert captured["urdf_content"] == "<robot name='demo'/>"
    assert captured["mesh_files_by_name"] == {"wheel.stl": b"solid wheel"}


def test_validate_simulation_prep_rejects_non_utf8_urdf() -> None:
    client = AsgiTestClient(create_app(), client=TEST_LOOPBACK_CLIENT)
    response = client.post(
        "/simulation-prep/validate",
        files={"urdf_file": ("robot.urdf", b"\xff", "text/xml")},
    )

    assert response.status_code == 422
    assert "not valid UTF-8" in response.json()["detail"]
