from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalStateFrame
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.world_model_dataset import (
    build_world_model_dataset_manifest,
    build_world_model_training_samples,
    validate_world_model_dataset_samples,
)


def _simple_trace():
    frame = PhysicalStateFrame(
        frame_id="dataset-smoke:0",
        t_ms=0,
        frame_convention="studio-y-up",
        entities=[
            PhysicalEntity(
                entity_id="robot-1",
                entity_type="robot",
                label="Robot 1",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
            ),
            PhysicalEntity(
                entity_id="box-1",
                entity_type="object",
                label="Box 1",
                geometry_type="box",
                position_xyz=[1.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
            ),
        ],
        metadata={"name": "dataset-smoke", "scenario_duration_ms": 0},
    )
    return rollout_action(
        frame,
        ActionToken(
            action_id="move-box",
            action_type="move_object",
            object_id="box-1",
            params={"delta_xyz": [0.2, 0.0, 0.0]},
        ),
        step_count=1,
    )


def test_world_model_dataset_manifest_contains_trainable_schema() -> None:
    samples = build_world_model_training_samples(_simple_trace())
    manifest = build_world_model_dataset_manifest(samples, dataset_id="dataset-smoke")
    report = validate_world_model_dataset_samples(samples, dataset_id=manifest.dataset_id)

    assert manifest.sample_schema_version == "wsp-world-model-sample-v1"
    assert manifest.feature_schema[0] == "position_x_m"
    assert len(manifest.feature_schema) == 18
    assert manifest.entity_type_vocab["robot"] == 1
    assert manifest.action_type_vocab["move_object"] == 6
    assert "contact_stability" in manifest.constraint_types
    assert report.ready is True
    assert report.feature_dim == 18
    assert report.errors == []


def test_world_model_dataset_readiness_rejects_feature_dim_drift() -> None:
    sample = build_world_model_training_samples(_simple_trace())[0].model_copy(deep=True)
    sample.state_tokens.continuous_features[0].append(999.0)

    report = validate_world_model_dataset_samples([sample])

    assert report.ready is False
    assert any("expected 18" in error for error in report.errors)
