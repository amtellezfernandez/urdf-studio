from __future__ import annotations

import json
import os
from xml.etree import ElementTree as ET

import pytest

from backend.services.world_layout_static_transfer import (
    build_sim_primitives,
    build_static_transfer_report,
    check_genesis_transfer,
    check_mujoco_transfer,
    export_primitives_to_mujoco_mjcf,
    parse_static_world_layout_payload,
)


def _layout_payload() -> dict:
    return {
        "world_layout": {
            "name": "transfer-smoke",
            "objects": [
                {
                    "id": "table-cube",
                    "name": "Table cube",
                    "type": "cube",
                    "position_xyz": [0.0, 0.05, 0.0],
                    "rotation_rpy_rad": [0.0, 0.25, 0.0],
                    "size_xyz": [1.0, 0.1, 0.6],
                    "color": "#ef4444",
                },
                {
                    "id": "target-sphere",
                    "name": "Target sphere",
                    "type": "sphere",
                    "position_xyz": [0.35, 0.22, -0.15],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#3b82f6",
                },
                {
                    "id": "safety-cylinder",
                    "name": "Safety cylinder",
                    "type": "cylinder",
                    "position_xyz": [-0.35, 0.4, 0.25],
                    "size_xyz": [0.18, 0.18, 0.8],
                    "color": "#22c55e",
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        }
    }


def test_parse_and_build_primitives_uses_static_layout_contract() -> None:
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, warnings = build_sim_primitives(layout)

    assert warnings == ()
    assert [primitive.source_id for primitive in primitives] == [
        "table-cube",
        "target-sphere",
        "safety-cylinder",
    ]
    assert primitives[0].sim_type == "box"
    assert primitives[0].position_xyz == (0.0, 0.0, 0.05)
    assert primitives[0].size_xyz == (1.0, 0.6, 0.1)


def test_rejects_non_static_layouts() -> None:
    payload = _layout_payload()
    payload["world_layout"]["scenario_time_ms"] = 10
    payload["world_layout"]["scenario_duration_ms"] = 100

    with pytest.raises(ValueError, match="Only static world layouts"):
        parse_static_world_layout_payload(payload)


def test_exported_mjcf_loads_in_mujoco() -> None:
    pytest.importorskip("mujoco")
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, _warnings = build_sim_primitives(layout)
    mjcf = export_primitives_to_mujoco_mjcf(primitives)

    assert "<mujoco" in mjcf
    assert 'type="box"' in mjcf
    assert 'type="sphere"' in mjcf
    assert 'type="cylinder"' in mjcf

    report = check_mujoco_transfer(primitives, mjcf_text=mjcf)
    assert report["ok"] is True
    assert report["loaded_count"] == 3
    assert report["max_position_error_m"] <= 1e-6
    assert report["max_size_error_m"] <= 1e-6
    assert report["type_mismatch_source_ids"] == []
    assert report["collision_mismatch_source_ids"] == []


def test_mujoco_gate_fails_on_substantial_size_mismatch() -> None:
    pytest.importorskip("mujoco")
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, _warnings = build_sim_primitives(layout)
    root = ET.fromstring(export_primitives_to_mujoco_mjcf(primitives))
    table_geom = root.find(".//geom[@name='wl_table_cube']")
    assert table_geom is not None
    table_geom.set("size", "0.5015 0.3 0.05")
    mjcf = ET.tostring(root, encoding="unicode")

    report = check_mujoco_transfer(primitives, mjcf_text=mjcf)

    assert report["ok"] is False
    assert report["max_size_error_m"] > 1e-6
    assert report["objects"][0]["size_error_m"] > 1e-6


@pytest.mark.skipif(
    os.getenv("URDF_STUDIO_RUN_GENESIS_TESTS") != "1",
    reason="Set URDF_STUDIO_RUN_GENESIS_TESTS=1 to run Genesis headless scene build.",
)
def test_layout_builds_in_genesis_when_enabled() -> None:
    pytest.importorskip("genesis")
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, _warnings = build_sim_primitives(layout)

    report = check_genesis_transfer(primitives)
    assert report["ok"] is True
    assert report["loaded_count"] == 3
    assert report["max_position_error_m"] <= 1e-6
    assert report["max_size_error_m"] <= 1e-6


def test_end_to_end_report_can_skip_genesis_for_fast_checks() -> None:
    layout = parse_static_world_layout_payload(_layout_payload())
    report = build_static_transfer_report(layout, backends=("mujoco",))

    assert report["ok"] is True
    assert report["layout"]["active_object_count"] == 3
    assert report["backends"]["mujoco"]["ok"] is True


def test_varied_static_layout_primitives_and_rotations_load_in_mujoco() -> None:
    pytest.importorskip("mujoco")
    payload = {
        "world_layout": {
            "name": "varied-transfer",
            "objects": [
                {
                    "id": "rotated-box",
                    "name": "Rotated box",
                    "type": "cube",
                    "position_xyz": [0.25, 0.15, -0.2],
                    "rotation_rpy_rad": [0.25, -0.35, 0.45],
                    "size_xyz": [0.4, 0.2, 0.3],
                    "color": "#f97316",
                },
                {
                    "id": "rotated-cylinder",
                    "name": "Rotated cylinder",
                    "type": "cylinder",
                    "position_xyz": [-0.3, 0.35, 0.4],
                    "rotation_rpy_rad": [-0.2, 0.4, -0.3],
                    "size_xyz": [0.18, 0.18, 0.5],
                    "color": "#14b8a6",
                },
                {
                    "id": "marker-point",
                    "name": "Marker point",
                    "type": "point",
                    "position_xyz": [0.0, 0.6, 0.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.05, 0.05, 0.05],
                    "color": "#f472b6",
                },
                {
                    "id": "hidden-box",
                    "name": "Hidden box",
                    "type": "cube",
                    "position_xyz": [1.0, 1.0, 1.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.1, 0.1],
                    "color": "#111827",
                    "is_hidden": True,
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        }
    }
    layout = parse_static_world_layout_payload(payload)
    report = build_static_transfer_report(layout, backends=("mujoco",))

    assert report["ok"] is True
    assert report["layout"]["object_count"] == 4
    assert report["layout"]["active_object_count"] == 3
    assert report["warnings"] == [
        "Mapped point marker to non-colliding sphere: marker-point",
        "Skipped hidden object: hidden-box",
    ]
    assert report["backends"]["mujoco"]["loaded_count"] == 3
    assert report["backends"]["mujoco"]["max_position_error_m"] <= 1e-6
    assert report["backends"]["mujoco"]["max_size_error_m"] <= 1e-6
    assert report["backends"]["mujoco"]["max_quat_error"] <= 1e-6
