from __future__ import annotations

from datetime import datetime, timezone
from tempfile import TemporaryDirectory

from backend.models.world_scene_package import (
    WorldArtifactRef,
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldRuntimeTarget,
    WorldSecuritySpec,
    WorldSnapshot,
)
from backend.services.world_scene_package_params import (
    MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES,
    WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY,
)
from backend.services.world_registry import WorldRegistryService


TEST_WORLD_SCENARIO_DURATION_MS = 12_000
TEST_WORLD_SCENARIO_TIME_MS = 800
TEST_WORLD_JOINT_VALUE_RAD = 0.42
TEST_STATIC_SCENARIO_DURATION_MS = 0
TEST_INVALID_STATIC_SCENARIO_TIME_MS = 100


def build_manifest(package_id: str, version: str) -> WorldScenePackageManifest:
    return WorldScenePackageManifest(
        schema_version=WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
        package_id=package_id,
        version=version,
        title=f"{package_id}-{version}",
        description="test package",
        created_at=datetime.now(timezone.utc),
        runtime_targets=[WorldRuntimeTarget(name="worldd", mode="native", min_version="0.1.0")],
        interface=WorldInterfaceSpec(
            observation_modalities=["rgb", "proprio"],
            action_semantics="joint_position_rad",
            timestep_ms=33,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={"joint_1": TEST_WORLD_JOINT_VALUE_RAD},
            cameras=[],
            objects=[],
            scenario_time_ms=TEST_WORLD_SCENARIO_TIME_MS,
            scenario_duration_ms=TEST_WORLD_SCENARIO_DURATION_MS,
        ),
        provenance={},
        security={},
    )


def test_publish_list_and_get_version_roundtrip() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)

        publish_result = service.publish(build_manifest("demo-world", "1.0.0"))
        assert publish_result.created is True

        packages = service.list_packages()
        assert len(packages) == 1
        assert packages[0].package_id == "demo-world"
        assert packages[0].latest_version == "1.0.0"
        assert packages[0].trust_level == WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY
        assert packages[0].runtime_targets == ["worldd:native"]

        version = service.get_version("demo-world", "1.0.0")
        assert version.package_id == "demo-world"
        assert version.version == "1.0.0"
        assert version.manifest.world_snapshot.joint_positions["joint_1"] == TEST_WORLD_JOINT_VALUE_RAD


def test_duplicate_version_is_rejected() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)

        service.publish(build_manifest("demo-world", "1.0.0"))
        try:
            service.publish(build_manifest("demo-world", "1.0.0"))
        except FileExistsError as exc:
            assert "already exists" in str(exc)
            return

        raise AssertionError("Expected duplicate publish to raise FileExistsError")


def test_validate_accepts_previous_planning_hints_without_coupling_rules() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        payload = build_manifest("demo-world", "1.0.1").model_dump(mode="json")
        payload["interface"]["planning"] = {
            "representation_space": "latent",
            "planning_horizon_steps": 128,
            "latent_state_dim": 512,
            "termination_semantics": "terminated_truncated",
            "rollout_mode": "stochastic",
            "supports_gradient_planning": False,
        }
        manifest = WorldScenePackageManifest.model_validate(payload)

        validation = service.validate(manifest)

    assert validation.valid is True
    assert validation.errors == []


def test_validate_accepts_static_scene_snapshot() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.2")
        manifest.world_snapshot.scenario_duration_ms = TEST_STATIC_SCENARIO_DURATION_MS
        manifest.world_snapshot.scenario_time_ms = TEST_STATIC_SCENARIO_DURATION_MS

        validation = service.validate(manifest)

        assert validation.valid is True
        assert validation.errors == []


def test_validate_rejects_static_scene_snapshot_with_non_zero_time() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.3")
        manifest.world_snapshot.scenario_duration_ms = TEST_STATIC_SCENARIO_DURATION_MS
        manifest.world_snapshot.scenario_time_ms = TEST_INVALID_STATIC_SCENARIO_TIME_MS

        validation = service.validate(manifest)

        assert validation.valid is False
        assert validation.errors == [
            "scenario_time_ms must be 0 when scenario_duration_ms is 0."
        ]


def test_validate_rejects_mesh_object_without_asset_ref() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.4")
        manifest.world_snapshot.objects = [
            {
                "id": "crate",
                "name": "Crate",
                "type": "mesh",
                "position_xyz": [0.0, 0.0, 0.1],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
            }
        ]

        validation = service.validate(manifest)

        assert validation.valid is False
        assert validation.errors == [
            "world_snapshot.objects[0].mesh asset reference is required for mesh objects."
        ]


def test_validate_rejects_nonportable_mesh_asset_ref() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.5")
        manifest.world_snapshot.objects = [
            {
                "id": "crate",
                "name": "Crate",
                "type": "mesh",
                "position_xyz": [0.0, 0.0, 0.1],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
                "asset_ref": "/tmp/crate.obj",
            }
        ]

        validation = service.validate(manifest)

        assert validation.valid is False
        assert validation.errors == [
            "world_snapshot.objects[0].asset_ref must be a portable relative asset reference."
        ]


def test_validate_reports_nested_nonportable_mesh_asset_ref_field() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.6")
        manifest.world_snapshot.objects = [
            {
                "id": "crate",
                "name": "Crate",
                "type": "mesh",
                "position_xyz": [0.0, 0.0, 0.1],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
                "mesh": {"path": "assets/./crate.obj"},
            }
        ]

        validation = service.validate(manifest)

        assert validation.valid is False
        assert validation.errors == [
            "world_snapshot.objects[0].mesh.path must be a portable relative asset reference."
        ]


def test_validate_rejects_mismatched_world_snapshot_artifact_digest() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.4")
        manifest.artifacts = [
            WorldArtifactRef(
                kind="world_snapshot",
                digest_sha256="0" * 64,
                uri="urdf-studio://world-snapshot",
            )
        ]

        validation = service.validate(manifest)

        assert validation.valid is False
        assert validation.errors == [
            "artifacts[world_snapshot:0].digest_sha256 does not match world_snapshot."
        ]


def test_list_packages_marks_metadata_complete_trust_level() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("trusted-world", "1.0.0")
        manifest.security = WorldSecuritySpec(
            signature_ref="sigstore://trusted-world@1.0.0",
            attestation_refs=["intoto://trusted-world@1.0.0"],
            sbom_ref="spdx://trusted-world@1.0.0",
        )

        service.publish(manifest)
        packages = service.list_packages()

        assert packages[0].package_id == "trusted-world"
        assert packages[0].trust_level == WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE


def test_list_packages_handles_non_object_registry_payload() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        with open(registry_path, "w", encoding="utf-8") as registry_file:
            registry_file.write("[]")
        service = WorldRegistryService(registry_path)

        packages = service.list_packages()

        assert packages == []


def test_list_packages_filters_by_query_owner_and_tags() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)

        alpha = build_manifest("alpha-world", "1.0.0")
        alpha.title = "Alpha Pick and Place"
        alpha.provenance = {
            "owner": "alice",
            "tags": ["pick", "benchmark"],
        }
        beta = build_manifest("beta-world", "1.0.0")
        beta.title = "Beta Navigation"
        beta.provenance = {
            "owner": "bob",
            "tags": ["nav"],
        }

        service.publish(alpha)
        service.publish(beta)

        filtered = service.list_packages(query="pick", owner="alice", tags=["benchmark"])
        assert len(filtered) == 1
        assert filtered[0].package_id == "alpha-world"


def test_get_capabilities_is_available() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        capabilities = service.get_capabilities()

        assert capabilities.available is True
        assert capabilities.can_list is True
        assert capabilities.can_get_version is True
        assert capabilities.can_publish is True


def test_validate_rejects_oversized_manifest() -> None:
    with TemporaryDirectory() as temp_dir:
        registry_path = f"{temp_dir}/world-registry.json"
        service = WorldRegistryService(registry_path)
        manifest = build_manifest("demo-world", "1.0.4")
        manifest.provenance = {"notes": "x" * MAX_WORLD_SCENE_PACKAGE_MANIFEST_BYTES}

        validation = service.validate(manifest)

        assert validation.valid is False
        assert any(
            "manifest exceeds the allowed serialized size" in error
            for error in validation.errors
        )
