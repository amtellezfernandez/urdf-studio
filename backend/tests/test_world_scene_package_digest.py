from __future__ import annotations

from datetime import datetime, timezone

from backend.models.world_scene_package import (
    WorldArtifactRef,
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.world_scene_package_digest import (
    canonical_world_snapshot_json,
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
    normalize_world_snapshot_artifact_digests,
    world_scene_package_json_payload,
)


TEST_WORLD_SNAPSHOT_DIGEST = "d8dbd551c2b41b1311022aa1e522c58ccc9062e6b9f729786f4427e84d7c8102"
TEST_NEUTRAL_JOINT_WORLD_SNAPSHOT_DIGEST = (
    "507d0be9228098918bc51f28af8cb0338ece94ad7507bc77a00ac30b8ef50ea1"
)


def test_computed_world_snapshot_digest_matches_frontend_builder_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["rgb", "proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={"joint_1": 0.5},
            cameras=[
                {
                    "id": "cam-1",
                    "name": "cam-1",
                    "parent_joint": "base_joint",
                    "pose": {
                        "xyz": [0, 0, 0],
                        "rpy": [0, 0, 0],
                    },
                    "intrinsics": {
                        "width": 640,
                        "height": 480,
                        "fov_deg": 60,
                    },
                }
            ],
            objects=[],
            scenario_time_ms=200,
            scenario_duration_ms=12000,
        ),
    )

    assert computed_world_snapshot_digest(manifest) == TEST_WORLD_SNAPSHOT_DIGEST


def test_normalize_world_snapshot_artifact_digests_repairs_stale_refs() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[
            WorldArtifactRef(
                kind="world_snapshot",
                digest_sha256="0" * 64,
                uri="inline://snapshot",
            ),
            WorldArtifactRef(
                kind="world_snapshot",
                digest_sha256="1" * 64,
                uri="inline://snapshot",
            ),
        ],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={"joint_1": 0.5},
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    normalized = normalize_world_snapshot_artifact_digests(manifest)

    assert declared_world_snapshot_digests(normalized) == (
        computed_world_snapshot_digest(normalized),
    )
    assert len(normalized.artifacts) == 1


def test_world_scene_package_json_payload_omits_schema_invalid_null_optionals() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[WorldRuntimeTarget(name="blender", mode="python")],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={},
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    payload = world_scene_package_json_payload(manifest)

    assert "description" not in payload
    assert payload["runtime_targets"] == [{"name": "blender", "mode": "python"}]
    assert payload["security"] == {
        "signature_ref": None,
        "attestation_refs": [],
        "sbom_ref": None,
    }


def test_computed_world_snapshot_digest_matches_browser_integer_joint_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml='<robot name="demo"/>',
            joint_positions={"joint_1": 0},
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    assert '"joint_1":0.0' not in canonical_world_snapshot_json(manifest)
    assert computed_world_snapshot_digest(manifest) == TEST_NEUTRAL_JOINT_WORLD_SNAPSHOT_DIGEST


def test_canonical_world_snapshot_json_matches_browser_number_and_string_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='café'/>",
            joint_positions={
                "large": 1e20,
                "micro": 1e-6,
                "tiny": 1e-7,
            },
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    assert canonical_world_snapshot_json(manifest) == (
        '{"cameras":[],"joint_positions":{"large":100000000000000000000,'
        '"micro":0.000001,"tiny":1e-7},"objects":[],"scenario_duration_ms":0,'
        '"scenario_time_ms":0,"urdf_xml":"<robot name=\'café\'/>"}'
    )


def test_canonical_world_snapshot_json_matches_browser_large_float_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={
                "positive": 7.823864961476316e17,
                "negative": -9.338720007556266e19,
            },
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    assert canonical_world_snapshot_json(manifest) == (
        '{"cameras":[],"joint_positions":{"negative":-93387200075562660000,'
        '"positive":782386496147631600},"objects":[],"scenario_duration_ms":0,'
        '"scenario_time_ms":0,"urdf_xml":"<robot name=\'demo\'/>"}'
    )


def test_canonical_world_snapshot_json_sorts_keys_like_browser_utf16_contract() -> None:
    manifest = WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[],
        interface=WorldInterfaceSpec(
            observation_modalities=["proprio"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={
                "a": 1,
                "z": 2,
                "é": 3,
                "𝌆": 4,
                "😀": 5,
                "\ue000": 6,
                "\uffff": 7,
            },
            cameras=[],
            objects=[],
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )

    assert canonical_world_snapshot_json(manifest) == (
        '{"cameras":[],"joint_positions":{"a":1,"z":2,"é":3,"𝌆":4,'
        '"😀":5,"\ue000":6,"\uffff":7},"objects":[],"scenario_duration_ms":0,'
        '"scenario_time_ms":0,"urdf_xml":"<robot name=\'demo\'/>"}'
    )
