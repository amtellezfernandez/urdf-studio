"""World <-> OpenUSD interchange (usd-core)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("pxr")

from backend.services.world_scene_package_compat import read_world_scene_registry_envelope
from backend.services.world_usd_interchange import (
    WorldUsdInterchangeError,
    export_world_to_usda,
    import_usd_to_world,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CARTON_WORLD = REPO_ROOT / "scenarios" / "carton_sorting_0001" / "carton-sorting.world-package.json"


def _carton_payload() -> dict:
    return json.loads(CARTON_WORLD.read_text(encoding="utf-8"))


def test_export_import_round_trip_preserves_objects(tmp_path: Path) -> None:
    usda_path = export_world_to_usda(_carton_payload(), tmp_path / "carton.usda")

    imported = import_usd_to_world(usda_path)
    envelope = read_world_scene_registry_envelope(imported)  # full world validation

    source_objects = {
        obj["id"]: obj for obj in _carton_payload()["world"]["objects"]
    }
    imported_objects = {obj["id"]: obj for obj in imported["world"]["objects"]}
    assert set(imported_objects) == set(source_objects)
    for object_id, source in source_objects.items():
        result = imported_objects[object_id]
        assert result["type"] == source["type"]
        assert result["position_xyz"] == pytest.approx(source["position_xyz"], abs=1e-6)
        assert result["size_xyz"] == pytest.approx(source["size_xyz"], abs=1e-6)
        assert result["physics"]["fixed"] == source["physics"]["fixed"]
        assert result["physics"]["collision"] == source["physics"]["collision"]
        assert result["color"].lower() == source["color"].lower()
    carton = imported_objects["carton_1"]
    assert carton["physics"]["mass_kg"] == pytest.approx(0.15)
    assert carton["physics"]["friction"] == pytest.approx(0.8)
    assert envelope.world.environment == {"frame_convention": "ros-rep-103"}
    assert imported["provenance"]["source"] == "usd-import"
    assert len(imported["provenance"]["source_usd_digest_sha256"]) == 64


def test_import_scales_units_and_flags_y_up(tmp_path: Path) -> None:
    usda = tmp_path / "y_up_cm.usda"
    usda.write_text(
        """#usda 1.0
(
    upAxis = "Y"
    metersPerUnit = 0.01
)
def Xform "World" {
    def Cube "crate" {
        double size = 10
        double3 xformOp:translate = (100, 50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
""",
        encoding="utf-8",
    )

    imported = import_usd_to_world(usda)

    crate = imported["world"]["objects"][0]
    assert crate["position_xyz"] == pytest.approx([1.0, 0.5, 0.0])
    assert crate["size_xyz"] == pytest.approx([0.1, 0.1, 0.1])
    assert imported["world"]["environment"]["frame_convention"] == "y-up"
    assert imported["provenance"]["meters_per_unit"] == pytest.approx(0.01)


def test_import_skips_unsupported_gprims_with_provenance(tmp_path: Path) -> None:
    usda = tmp_path / "meshy.usda"
    usda.write_text(
        """#usda 1.0
(
    upAxis = "Z"
)
def Xform "World" {
    def Cube "keeper" {
        double size = 0.2
    }
    def Mesh "fancy_mesh" {
    }
}
""",
        encoding="utf-8",
    )

    imported = import_usd_to_world(usda)

    assert [obj["id"] for obj in imported["world"]["objects"]] == ["keeper"]
    assert any("fancy_mesh" in entry for entry in imported["provenance"]["skipped_prims"])


def test_import_rejects_stage_without_rigid_gprims(tmp_path: Path) -> None:
    usda = tmp_path / "empty.usda"
    usda.write_text('#usda 1.0\ndef Xform "World" {\n}\n', encoding="utf-8")

    with pytest.raises(WorldUsdInterchangeError, match="No importable rigid gprims"):
        import_usd_to_world(usda)


def test_asset_backed_objects_round_trip_reference_metadata(tmp_path: Path) -> None:
    payload = _carton_payload()
    payload["world"]["objects"].append(
        {
            "id": "scanned_prop",
            "name": "Scanned prop",
            "type": "mesh",
            "position_xyz": [0.1, 0.2, 0.9],
            "rotation_rpy_rad": [0.0, 0.0, 0.4],
            "size_xyz": [0.2, 0.2, 0.3],
            "color": "#0ea5e9",
            "asset_ref": "assets/prop.glb",
            "asset_scale_xyz": [1.0, 1.0, 2.0],
            "physics": {"fixed": False, "collision": True, "mass_kg": 0.4},
        }
    )

    usda_path = export_world_to_usda(payload, tmp_path / "with_mesh.usda")
    imported = import_usd_to_world(usda_path)

    prop = next(obj for obj in imported["world"]["objects"] if obj["id"] == "scanned_prop")
    assert prop["type"] == "mesh"                      # declared type survives customData
    assert prop["asset_ref"] == "assets/prop.glb"
    assert prop["asset_scale_xyz"] == pytest.approx([1.0, 1.0, 2.0])
    assert prop["size_xyz"] == pytest.approx([0.2, 0.2, 0.3], abs=1e-6)


def test_cli_round_trip(tmp_path: Path) -> None:
    from backend.scripts.world_usd_convert import main as convert_main

    usda_path = tmp_path / "carton.usda"
    json_path = tmp_path / "carton.world-package.json"
    assert convert_main(["export", str(CARTON_WORLD), str(usda_path)]) == 0
    assert convert_main(["import", str(usda_path), str(json_path)]) == 0

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    envelope = read_world_scene_registry_envelope(payload)
    assert envelope.package_id == "carton-sorting"
    assert len(envelope.world.objects) == 4
