"""Scenario library + run API (in-app cross-simulator runs)."""

from __future__ import annotations

import time

import pytest

pytest.importorskip("mujoco")

from backend.app import create_app
from backend.tests.asgi_test_client import AsgiTestClient

TEST_LOOPBACK_CLIENT = ("127.0.0.1", 50000)


def _client() -> AsgiTestClient:
    return AsgiTestClient(create_app(), client=TEST_LOOPBACK_CLIENT)


def test_list_scenarios_includes_carton_demo() -> None:
    response = _client().get("/scenarios")

    assert response.status_code == 200
    scenarios = {s["scenario_id"]: s for s in response.json()["scenarios"]}
    assert "carton_sorting_0001" in scenarios
    carton = scenarios["carton_sorting_0001"]
    assert carton["task_family"] == "pick_place"
    assert carton["instruction"] == "Pick up the carton_1 and place it into bin_a"
    assert "mujoco" in carton["default_sims"]


def test_create_run_rejects_unsupported_sim() -> None:
    response = _client().post(
        "/scenarios/carton_sorting_0001/runs", json={"sims": ["holodeck"]}
    )

    assert response.status_code == 400
    assert "Unsupported simulator" in response.json()["detail"]


def test_create_run_rejects_unknown_scenario() -> None:
    response = _client().post("/scenarios/does_not_exist/runs", json={"sims": ["mujoco"]})

    assert response.status_code == 400
    assert "not be found" in response.json()["detail"] or "not found" in response.json()["detail"]


def test_run_lifecycle_produces_comparison_and_report() -> None:
    client = _client()

    created = client.post("/scenarios/carton_sorting_0001/runs", json={"sims": ["mujoco"]})
    assert created.status_code == 202
    run_id = created.json()["run_id"]
    assert created.json()["status"] in ("queued", "running")

    detail = _await_terminal(client, run_id)
    assert detail["status"] == "completed", detail.get("error")
    assert detail["comparison"]["summary"]["mujoco"]["success_count"] == 1
    assert detail["has_report"] is True

    listed = client.get("/scenarios/runs").json()["runs"]
    assert any(run["run_id"] == run_id for run in listed)

    report = client.get(f"/scenarios/runs/{run_id}/report")
    assert report.status_code == 200
    assert "<canvas" in report.text
    assert "report-data" in report.text


def _await_terminal(client: AsgiTestClient, run_id: str, timeout_s: float = 120.0) -> dict:
    deadline = time.monotonic() + timeout_s
    detail = client.get(f"/scenarios/runs/{run_id}").json()
    while detail["status"] in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.5)
        detail = client.get(f"/scenarios/runs/{run_id}").json()
    return detail
