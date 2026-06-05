from __future__ import annotations

import json

from backend.models.physical_state import ActionToken
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.physical_state_compiler import compile_physical_state_payload
from backend.services.world_model_baseline import (
    BASELINE_SCHEMA_VERSION,
    train_world_model_transition_baseline,
    write_world_model_baseline_artifacts,
)
from backend.services.world_model_dataset import (
    build_world_model_training_samples,
    write_world_model_dataset_jsonl,
)


def _single_object_move_samples():
    compiled = compile_physical_state_payload(
        {
            "world_layout": {
                "name": "baseline-smoke",
                "objects": [
                    {
                        "id": "box-1",
                        "name": "Box 1",
                        "type": "cube",
                        "position_xyz": [1.0, 0.0, 0.1],
                        "size_xyz": [0.2, 0.2, 0.2],
                    },
                ],
                "scenario_time_ms": 0,
                "scenario_duration_ms": 0,
            }
        }
    )
    trace = rollout_action(
        compiled.frame,
        ActionToken(
            action_id="move-box",
            action_type="move_object",
            object_id="box-1",
            params={"delta_xyz": [0.3, 0.0, 0.0]},
        ),
        step_count=3,
    )
    return build_world_model_training_samples(trace)


def test_world_model_baseline_trains_on_wsp_jsonl_samples() -> None:
    samples = _single_object_move_samples()

    report, model = train_world_model_transition_baseline(
        samples,
        dataset_id="baseline-smoke",
        min_samples=2,
        max_position_mean_absolute_error_m=1e-12,
    )

    assert report.success is True
    assert report.sample_count == 3
    assert report.train_sample_count == 2
    assert report.eval_sample_count == 1
    assert report.feature_dim == 18
    assert report.matched_entity_count == 1
    assert report.action_type_count == 1
    assert report.position_mean_absolute_error_m == 0.0
    assert model["schema_version"] == BASELINE_SCHEMA_VERSION
    assert model["feature_schema"][0] == "position_x_m"
    assert "move_object" in model["action_deltas"]


def test_world_model_baseline_artifacts_roundtrip(tmp_path) -> None:
    samples = _single_object_move_samples()
    dataset_path = tmp_path / "samples.jsonl"
    report_path = tmp_path / "baseline-report.json"
    model_path = tmp_path / "baseline-model.json"
    write_world_model_dataset_jsonl(
        samples,
        output_path=dataset_path,
        dataset_id="baseline-smoke",
    )
    report, model = train_world_model_transition_baseline(samples, dataset_id="baseline-smoke")

    write_world_model_baseline_artifacts(report, model, report_path=report_path, model_path=model_path)

    assert report_path.exists()
    assert model_path.exists()
    assert json.loads(report_path.read_text(encoding="utf-8"))["success"] is True
    assert json.loads(model_path.read_text(encoding="utf-8"))["schema_version"] == BASELINE_SCHEMA_VERSION
