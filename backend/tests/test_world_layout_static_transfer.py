from __future__ import annotations

import json
import os
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from backend.services.world_layout_static_transfer import (
    append_primitives_to_mujoco_mjcf,
    build_sim_primitives,
    build_static_transfer_report,
    check_genesis_transfer,
    check_mujoco_transfer,
    export_primitives_to_mujoco_mjcf,
    inverse_transform_position,
    inverse_transform_quat_wxyz,
    inverse_transform_size,
    parse_static_world_layout_payload,
    resolve_world_layout_asset_path,
    resolve_world_layout_frame_map,
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
                    "size_xyz": [0.18, 0.8, 0.18],
                    "color": "#22c55e",
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
        "environment": {
            "frame_map": "studio-y-up-to-z-up",
        },
    }


def test_parse_and_build_primitives_uses_static_layout_contract() -> None:
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ()
    assert [primitive.source_id for primitive in primitives] == [
        "table-cube",
        "target-sphere",
        "safety-cylinder",
    ]
    assert primitives[0].sim_type == "box"
    assert primitives[0].position_xyz == (0.0, 0.0, 0.05)
    assert primitives[0].size_xyz == (1.0, 0.6, 0.1)


def test_default_frame_map_is_identity_for_deterministic_launches() -> None:
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, warnings = build_sim_primitives(layout)

    assert warnings == ("Normalized non-uniform cylinder diameter for object: safety-cylinder",)
    assert resolve_world_layout_frame_map(layout) == "identity"
    assert primitives[0].position_xyz == (0.0, 0.05, 0.0)
    assert primitives[0].size_xyz == (1.0, 0.1, 0.6)


def test_auto_frame_map_preserves_ros_rep_103_world_package_axes() -> None:
    payload = {
        "package_id": "axis_probe",
        "version": "1.0.0",
        "title": "Axis Probe",
        "interface": {
            "observation_modalities": ["state"],
            "action_semantics": "joint_position",
            "timestep_ms": 10,
            "frame_convention": "ros-rep-103",
        },
        "world_snapshot": {
            "objects": [
                {
                    "id": "asymmetric-box",
                    "name": "Asymmetric box",
                    "type": "cube",
                    "position_xyz": [1.0, 2.0, 3.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.4, 0.8],
                    "color": "#22c55e",
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ()
    assert resolve_world_layout_frame_map(layout, "auto") == "identity"
    assert primitives[0].position_xyz == (1.0, 2.0, 3.0)
    assert primitives[0].size_xyz == (0.2, 0.4, 0.8)


def test_auto_frame_map_converts_studio_y_up_package_axes() -> None:
    payload = {
        "package_id": "studio_y_up_axis_probe",
        "version": "1.0.0",
        "title": "Studio Y-Up Axis Probe",
        "interface": {
            "observation_modalities": ["state"],
            "action_semantics": "joint_position",
            "timestep_ms": 10,
            "frame_convention": "studio-y-up",
        },
        "world_snapshot": {
            "objects": [
                {
                    "id": "asymmetric-box",
                    "name": "Asymmetric box",
                    "type": "cube",
                    "position_xyz": [1.0, 2.0, 3.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.4, 0.8],
                    "color": "#22c55e",
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ()
    assert resolve_world_layout_frame_map(layout, "auto") == "studio-y-up-to-z-up"
    assert primitives[0].position_xyz == (1.0, -3.0, 2.0)
    assert primitives[0].size_xyz == (0.2, 0.8, 0.4)


def test_inverse_frame_map_round_trips_studio_y_up_layout_values() -> None:
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ()
    assert inverse_transform_position(
        primitives[0].position_xyz,
        "studio-y-up-to-z-up",
    ) == pytest.approx((0.0, 0.05, 0.0))
    assert inverse_transform_size(
        primitives[0].size_xyz,
        "studio-y-up-to-z-up",
    ) == pytest.approx((1.0, 0.1, 0.6))
    assert inverse_transform_quat_wxyz(
        primitives[1].quat_wxyz,
        "studio-y-up-to-z-up",
    ) == pytest.approx((1.0, 0.0, 0.0, 0.0))


def test_build_primitives_preserves_object_simulation_metadata() -> None:
    payload = {
        "package_id": "dynamic_world",
        "version": "1.0.0",
        "interface": {
            "frame_convention": "ros-rep-103",
        },
        "world_snapshot": {
            "objects": [
                {
                    "id": "green-container",
                    "name": "Green container",
                    "type": "cube",
                    "position_xyz": [0.2, -0.1, 0.15],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.4, 0.2, 0.3],
                    "color": "#22c55e",
                    "simulation": {
                        "fixed": False,
                        "collision": True,
                        "mass_kg": 4.5,
                        "friction": 0.8,
                        "restitution": 0.1,
                        "semantic_role": "manipulation_target",
                    },
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ()
    assert len(primitives) == 1
    assert primitives[0].fixed is False
    assert primitives[0].collision is True
    assert primitives[0].mass_kg == 4.5
    assert primitives[0].friction == 0.8
    assert primitives[0].restitution == 0.1
    assert primitives[0].semantic_role == "manipulation_target"


def test_build_primitives_warns_for_duplicate_object_ids_and_names() -> None:
    payload = {
        "world_layout": {
            "name": "duplicate-objects",
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "cube",
                    "position_xyz": [0.0, 0.0, 0.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#22c55e",
                },
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "cube",
                    "position_xyz": [0.3, 0.0, 0.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#22c55e",
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, warnings = build_sim_primitives(layout)

    assert warnings == (
        "Duplicate world object id 'crate' appears 2 times; simulator transfer may be ambiguous.",
        "Duplicate world object name 'Crate' appears 2 times; simulator transfer may be ambiguous.",
    )
    assert [primitive.sim_name for primitive in primitives] == ["wl_crate", "wl_crate_2"]


def test_mesh_object_preserves_asset_metadata_and_uses_proxy_for_primitive_adapters(tmp_path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")
    payload = {
        "package_id": "mesh_world",
        "version": "1.0.0",
        "interface": {
            "frame_convention": "ros-rep-103",
        },
        "world_snapshot": {
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "mesh",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.3, 0.4],
                    "color": "#22c55e",
                    "mesh": {
                        "path": "assets/crate.obj",
                        "scale": [1.0, 1.2, 1.4],
                    },
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, warnings = build_sim_primitives(layout, frame_map="auto")

    assert warnings == ("Mesh object keeps asset_ref for mesh-capable adapters: crate",)
    assert primitives[0].source_type == "mesh"
    assert primitives[0].sim_type == "box"
    assert primitives[0].asset_ref == "assets/crate.obj"
    assert primitives[0].asset_scale_xyz == (1.0, 1.2, 1.4)
    assert resolve_world_layout_asset_path(primitives[0].asset_ref, (tmp_path,)) == mesh_path
    assert resolve_world_layout_asset_path("../crate.obj", (tmp_path,)) is None
    mjcf = export_primitives_to_mujoco_mjcf(primitives, asset_roots=(tmp_path,))
    root = ET.fromstring(mjcf)
    mesh = root.find("./asset/mesh[@name='wl_crate_mesh']")
    geom = root.find("./worldbody/geom[@name='wl_crate']")
    assert mesh is not None
    assert mesh.get("file") == str(mesh_path)
    assert mesh.get("scale") == "1 1.2 1.4"
    assert geom is not None
    assert geom.get("type") == "mesh"
    assert geom.get("mesh") == "wl_crate_mesh"


def test_mesh_object_requires_asset_ref_for_simulator_transfer() -> None:
    payload = {
        "world_layout": {
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "mesh",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.3, 0.4],
                    "color": "#22c55e",
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)

    with pytest.raises(ValueError, match="Mesh object requires asset_ref"):
        build_sim_primitives(layout)


def test_mujoco_mesh_object_requires_resolvable_asset(tmp_path: Path) -> None:
    payload = {
        "world_layout": {
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "mesh",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.3, 0.4],
                    "color": "#22c55e",
                    "asset_ref": "assets/missing.obj",
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, _warnings = build_sim_primitives(layout)

    with pytest.raises(ValueError, match="MuJoCo mesh object 'crate' asset_ref does not resolve"):
        export_primitives_to_mujoco_mjcf(primitives, asset_roots=(tmp_path,))


def test_mesh_asset_refs_are_normalized_to_portable_package_paths(tmp_path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")
    payload = {
        "world_layout": {
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "mesh",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.3, 0.4],
                    "color": "#22c55e",
                    "asset_ref": "./assets\\crate.obj",
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    layout = parse_static_world_layout_payload(payload)
    primitives, _warnings = build_sim_primitives(layout)

    assert primitives[0].asset_ref == "assets/crate.obj"
    assert resolve_world_layout_asset_path(primitives[0].asset_ref, (tmp_path,)) == mesh_path


@pytest.mark.parametrize(
    "asset_ref",
    [
        ".",
        "./",
        " assets/crate.obj",
        "assets/crate.obj ",
        "/tmp/crate.obj",
        "../crate.obj",
        "assets/../crate.obj",
        "assets/./crate.obj",
        "assets//crate.obj",
        "package://demo/crate.obj",
        "https://example.test/crate.obj",
        "C:\\tmp\\crate.obj",
    ],
)
def test_rejects_nonportable_mesh_asset_refs(asset_ref: str) -> None:
    payload = {
        "world_layout": {
            "objects": [
                {
                    "id": "crate",
                    "name": "Crate",
                    "type": "mesh",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.3, 0.4],
                    "color": "#22c55e",
                    "asset_ref": asset_ref,
                }
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }

    with pytest.raises(ValueError, match="portable relative asset reference"):
        parse_static_world_layout_payload(payload)

    assert resolve_world_layout_asset_path(asset_ref, (Path.cwd(),)) is None


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
    assert report["max_color_error"] <= 1e-6
    assert report["type_mismatch_source_ids"] == []
    assert report["collision_mismatch_source_ids"] == []
    assert report["color_mismatch_source_ids"] == []


def test_appends_world_primitives_to_robot_mjcf_for_mujoco() -> None:
    pytest.importorskip("mujoco")
    layout = parse_static_world_layout_payload(_layout_payload())
    primitives, _warnings = build_sim_primitives(layout)
    combined_mjcf = append_primitives_to_mujoco_mjcf(
        "<mujoco model=\"robot\"><worldbody><body name=\"base\"/></worldbody></mujoco>",
        primitives,
    )

    report = check_mujoco_transfer(primitives, mjcf_text=combined_mjcf)

    assert report["ok"] is True
    assert report["compiled_geom_count"] == 3


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
    assert report["max_color_error"] <= 1e-6


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
    assert report["backends"]["mujoco"]["max_color_error"] <= 1e-6
