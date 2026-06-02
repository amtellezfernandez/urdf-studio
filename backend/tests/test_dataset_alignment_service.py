from __future__ import annotations

from datetime import datetime, timezone
from tempfile import TemporaryDirectory

from backend.models.dataset_alignment import (
    DatasetAlignmentInput,
    DatasetRepresentationValidationRequest,
    EmbodimentResolveRequest,
    MappingEndpointRef,
    MappingJointRule,
    MappingListQuery,
    MappingSpec,
)
from backend.services.dataset_alignment import DatasetAlignmentService
from backend.services.dataset_alignment_params import (
    DEFAULT_INDEXED_REPRESENTATION_ID,
    DEFAULT_SEMANTIC_REPRESENTATION_ID,
    NAMING_STATUS_NAMED,
    NAMING_STATUS_UNNAMED,
)
from backend.services.embodiment_fingerprint import compute_kinematic_fingerprint

URDF_SIMPLE = """
<robot name='demo'>
  <link name='base'/>
  <link name='arm'/>
  <joint name='j1' type='revolute'>
    <parent link='base'/>
    <child link='arm'/>
    <axis xyz='0 0 1'/>
    <origin xyz='0 0 0.1' rpy='0 0 0'/>
    <limit lower='-1.57' upper='1.57'/>
  </joint>
</robot>
""".strip()

URDF_RENAMED = """
<robot name='demo-renamed'>
  <link name='foundation'/>
  <link name='tool'/>
  <joint name='axis_joint' type='revolute'>
    <parent link='foundation'/>
    <child link='tool'/>
    <axis xyz='0 0 1'/>
    <origin xyz='0 0 0.1' rpy='0 0 0'/>
    <limit lower='-1.57' upper='1.57'/>
  </joint>
</robot>
""".strip()

URDF_AXIS_MUTATION = """
<robot name='demo-mutated'>
  <link name='base'/>
  <link name='arm'/>
  <joint name='j1' type='revolute'>
    <parent link='base'/>
    <child link='arm'/>
    <axis xyz='1 0 0'/>
    <origin xyz='0 0 0.1' rpy='0 0 0'/>
    <limit lower='-1.57' upper='1.57'/>
  </joint>
</robot>
""".strip()


def _service(tmp_dir: str) -> DatasetAlignmentService:
    return DatasetAlignmentService(f"{tmp_dir}/alignment-registry.json")


def test_resolve_embodiment_reuses_matching_fingerprint() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        first = service.resolve_embodiment(
            EmbodimentResolveRequest(
                urdf_xml=URDF_SIMPLE,
                robot_type="demo",
                base_frame="base",
                ee_frame="arm",
            )
        )
        second = service.resolve_embodiment(
            EmbodimentResolveRequest(
                urdf_xml=URDF_SIMPLE,
                robot_type="demo-variant",
            )
        )

        assert first.matched_existing is False
        assert second.matched_existing is True
        assert first.embodiment.embodiment_id == second.embodiment.embodiment_id
        assert first.embodiment.kinematic_fingerprint is not None


def test_fingerprint_ignores_joint_and_link_names() -> None:
    canonical = compute_kinematic_fingerprint(URDF_SIMPLE)
    renamed = compute_kinematic_fingerprint(URDF_RENAMED)

    assert canonical.strict == renamed.strict


def test_fingerprint_changes_when_axis_changes() -> None:
    canonical = compute_kinematic_fingerprint(URDF_SIMPLE)
    mutated = compute_kinematic_fingerprint(URDF_AXIS_MUTATION)

    assert canonical.strict != mutated.strict


def test_resolve_embodiment_without_urdf_uses_unknown_prefix() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        result = service.resolve_embodiment(
            EmbodimentResolveRequest(robot_type="custom-bot", base_frame="base_link")
        )

        assert result.embodiment.embodiment_id.startswith("unknown:")
        assert result.embodiment.kinematic_fingerprint is None


def test_resolve_embodiment_handles_malformed_urdf() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        result = service.resolve_embodiment(
            EmbodimentResolveRequest(urdf_xml="<robot><joint></robot>", robot_type="bad")
        )

        assert result.embodiment.embodiment_id.startswith("unknown:")
        assert result.embodiment.kinematic_fingerprint is None


def test_upsert_and_filter_mappings_roundtrip() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        mapping = MappingSpec(
            source=MappingEndpointRef(
                embodiment_id="unknown:abc",
                representation_id=DEFAULT_INDEXED_REPRESENTATION_ID,
            ),
            target=MappingEndpointRef(
                embodiment_id="franka:panda:v1",
                representation_id=DEFAULT_SEMANTIC_REPRESENTATION_ID,
            ),
            joint_rules=[
                MappingJointRule(
                    source_joint="motor_0",
                    target_joint="arm.shoulder_pan",
                )
            ],
            created_by="test",
            created_at=datetime.now(timezone.utc),
        )

        saved = service.upsert_mapping(mapping)
        assert saved.mapping_id is not None

        all_mappings = service.list_mappings()
        assert len(all_mappings) == 1

        filtered = service.list_mappings(
            MappingListQuery(
                source_representation_id=DEFAULT_INDEXED_REPRESENTATION_ID,
                target_representation_id=DEFAULT_SEMANTIC_REPRESENTATION_ID,
            )
        )
        assert len(filtered) == 1
        assert filtered[0].mapping_id == saved.mapping_id


def test_validate_requires_mapping_for_representation_mismatch() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        validation = service.validate_dataset_representations(
            DatasetRepresentationValidationRequest(
                datasets=[
                    DatasetAlignmentInput(
                        dataset_id="hf:demo/train",
                        embodiment_id="unknown:abc",
                        representation_id=DEFAULT_INDEXED_REPRESENTATION_ID,
                        naming_status=NAMING_STATUS_NAMED,
                    )
                ],
                required_representation_id=DEFAULT_SEMANTIC_REPRESENTATION_ID,
            )
        )

        assert validation.valid is False
        assert any("no MappingSpec" in message for message in validation.errors)


def test_validate_rejects_unnamed_datasets() -> None:
    with TemporaryDirectory() as tmp_dir:
        service = _service(tmp_dir)

        validation = service.validate_dataset_representations(
            DatasetRepresentationValidationRequest(
                datasets=[
                    DatasetAlignmentInput(
                        dataset_id="hf:demo/train",
                        embodiment_id="unknown:abc",
                        representation_id=DEFAULT_SEMANTIC_REPRESENTATION_ID,
                        naming_status=NAMING_STATUS_UNNAMED,
                    )
                ],
                required_representation_id=DEFAULT_SEMANTIC_REPRESENTATION_ID,
            )
        )

        assert validation.valid is False
        assert any("unnamed joints" in message for message in validation.errors)
