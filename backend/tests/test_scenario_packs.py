"""Content-addressed scenario packs: deterministic publish, verified pull."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from backend.services.scenario_library import (
    SCENARIO_LIBRARY_ENV_VAR,
    USER_SCENARIO_LIBRARY_ENV_VAR,
    scenario_directory,
)
from backend.services.scenario_packs import (
    SCENARIO_PACKS_ENV_VAR,
    ScenarioPackError,
    ScenarioPackService,
    build_deterministic_archive,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_SCENARIO = REPO_ROOT / "scenarios" / "carton_sorting_0001"


@pytest.fixture()
def packs_env(tmp_path, monkeypatch):
    # Shipped library = the repo scenarios/ (has carton_sorting_0001);
    # user library + packs root are isolated per test.
    monkeypatch.setenv(USER_SCENARIO_LIBRARY_ENV_VAR, str(tmp_path / "user-scenarios"))
    monkeypatch.setenv(SCENARIO_PACKS_ENV_VAR, str(tmp_path / "packs"))
    monkeypatch.setenv(SCENARIO_LIBRARY_ENV_VAR, str(DEMO_SCENARIO.parent))
    return tmp_path


def _service() -> ScenarioPackService:
    # Read the env-configured root at construction time (per test).
    from backend.services.scenario_packs import scenario_packs_root

    return ScenarioPackService(packs_root=scenario_packs_root())


def test_archive_is_deterministic() -> None:
    a = build_deterministic_archive(DEMO_SCENARIO)
    b = build_deterministic_archive(DEMO_SCENARIO)
    assert a == b
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest()


def test_publish_list_pull_round_trip(packs_env) -> None:
    service = _service()

    published = service.publish("carton_sorting_0001", "1.0.0")
    assert published.package_id == "carton_sorting_0001"
    assert len(published.digest_sha256) == 64
    assert "carton_1" in published.instruction

    packs = service.list_packs()
    assert [(p.package_id, p.version) for p in packs] == [("carton_sorting_0001", "1.0.0")]

    # Pull installs into the (isolated) user library under a fresh id.
    pulled = service.pull("carton_sorting_0001", "1.0.0")
    assert pulled.digest_sha256 == published.digest_sha256
    installed_dir = scenario_directory("carton_sorting_0001")
    # user library shadows repo; the pulled copy is the user one
    assert str(installed_dir).endswith(str(Path("user-scenarios") / "carton_sorting_0001"))
    assert (installed_dir / "scenario.yaml").is_file()
    assert (installed_dir / "waypoints.json").is_file()


def test_publish_rejects_duplicate_version(packs_env) -> None:
    service = _service()
    service.publish("carton_sorting_0001", "1.0.0")
    with pytest.raises(ScenarioPackError, match="already exists"):
        service.publish("carton_sorting_0001", "1.0.0")


def test_publish_rejects_bad_version(packs_env) -> None:
    service = _service()
    with pytest.raises(ScenarioPackError, match="Invalid version"):
        service.publish("carton_sorting_0001", "../etc")


def test_pull_detects_digest_tampering(packs_env) -> None:
    service = _service()
    published = service.publish("carton_sorting_0001", "1.0.0")
    archive_path = packs_env / "packs" / "carton_sorting_0001" / "1.0.0.zip"
    archive_path.write_bytes(archive_path.read_bytes() + b"tampered")

    with pytest.raises(ScenarioPackError, match="digest mismatch"):
        service.pull(published.package_id, published.version)


def test_pull_unknown_pack(packs_env) -> None:
    service = _service()
    with pytest.raises(ScenarioPackError, match="was not found"):
        service.pull("nope", "1.0.0")


def test_pulled_pack_appears_in_library_and_is_loadable(packs_env) -> None:
    service = _service()
    service.publish("carton_sorting_0001", "2.0.0")
    # Simulate a fresh machine: wipe the user lib, then pull.
    service.pull("carton_sorting_0001", "2.0.0")

    from backend.services.scenario_loader import load_scenario

    scenario = load_scenario(scenario_directory("carton_sorting_0001"))
    assert scenario.scenario_id == "carton_sorting_0001"


def test_pack_api_publish_list_pull(packs_env, monkeypatch) -> None:
    from backend.app import create_app
    from backend.services import scenario_packs
    from backend.tests.asgi_test_client import AsgiTestClient

    # Point the module singleton at the isolated packs root for this test.
    monkeypatch.setattr(
        scenario_packs.scenario_pack_service, "_root", packs_env / "packs"
    )
    client = AsgiTestClient(create_app(), client=("127.0.0.1", 50000))

    published = client.post("/scenarios/carton_sorting_0001/packs", json={"version": "1.0.0"})
    assert published.status_code == 201
    digest = published.json()["digest_sha256"]

    listed = client.get("/scenarios/packs").json()["packs"]
    assert any(p["package_id"] == "carton_sorting_0001" and p["version"] == "1.0.0" for p in listed)

    pulled = client.post("/scenarios/packs/carton_sorting_0001/1.0.0/pull")
    assert pulled.status_code == 200
    assert pulled.json()["digest_sha256"] == digest

    # The pulled pack now shows up in the scenario library listing.
    scenarios = client.get("/scenarios").json()["scenarios"]
    assert any(entry["scenario_id"] == "carton_sorting_0001" for entry in scenarios)
