from __future__ import annotations

import time
from typing import Any, Sequence

from backend.models.physical_state import PhysicalRolloutTrace, PhysicalStateFrame, WorldModelTrainingSample
from backend.services.simulator_export import (
    export_rollout_trace_to_genesis_scene,
    export_rollout_trace_to_mujoco_mjcf,
)


DEFAULT_REPLAY_TARGETS = ("mujoco", "genesis")


def normalize_replay_targets(raw_targets: Sequence[str] | str | None) -> list[str]:
    if raw_targets is None:
        return list(DEFAULT_REPLAY_TARGETS)
    values = [value.strip().lower() for value in raw_targets.split(",")] if isinstance(raw_targets, str) else [
        value.strip().lower() for value in raw_targets
    ]
    targets: list[str] = []
    for value in values:
        if not value:
            continue
        if value not in {"mujoco", "genesis"}:
            raise ValueError(f"Unsupported replay target: {value}")
        if value not in targets:
            targets.append(value)
    return targets or list(DEFAULT_REPLAY_TARGETS)


def transition_trace_from_sample(sample: WorldModelTrainingSample) -> PhysicalRolloutTrace:
    state_snapshot = sample.state_tokens.metadata.get("frame_snapshot")
    next_state_snapshot = sample.next_state_tokens.metadata.get("frame_snapshot")
    if not isinstance(state_snapshot, dict) or not isinstance(next_state_snapshot, dict):
        raise ValueError(f"{sample.sample_id} does not contain frame snapshots for replay labeling.")
    return PhysicalRolloutTrace(
        trace_id=f"{sample.trace_id}:sample:{sample.step_index}:replay",
        frames=[
            PhysicalStateFrame.model_validate(state_snapshot),
            PhysicalStateFrame.model_validate(next_state_snapshot),
        ],
        actions=[sample.action],
        metadata={
            "source_sample_id": sample.sample_id,
            "source_trace_id": sample.trace_id,
            "step_index": sample.step_index,
        },
    )


def _replay_target(trace: PhysicalRolloutTrace, target: str, *, smoke_load: bool) -> dict[str, Any]:
    started = time.perf_counter()
    if target == "mujoco":
        _payload, status = export_rollout_trace_to_mujoco_mjcf(trace, smoke_load=smoke_load)
    elif target == "genesis":
        _payload, status = export_rollout_trace_to_genesis_scene(trace, smoke_load=smoke_load)
    else:
        raise ValueError(f"Unsupported replay target: {target}")
    runtime_ms = (time.perf_counter() - started) * 1000.0
    return {
        "target": target,
        "label": "pass" if status.success else "fail",
        "success": status.success,
        "smoke_passed": status.smoke_passed,
        "error": status.error,
        "warnings": list(status.warnings),
        "runtime_ms": runtime_ms,
        "smoke_load_requested": smoke_load,
        "metrics": status.metrics,
    }


def replay_label_sample(
    sample: WorldModelTrainingSample,
    *,
    targets: Sequence[str] | str | None = None,
    smoke_load: bool = False,
) -> WorldModelTrainingSample:
    normalized_targets = normalize_replay_targets(targets)
    trace = transition_trace_from_sample(sample)
    target_results = {target: _replay_target(trace, target, smoke_load=smoke_load) for target in normalized_targets}
    pass_count = sum(1 for result in target_results.values() if result["label"] == "pass")
    fail_count = len(target_results) - pass_count
    replay_label = "pass" if fail_count == 0 else "fail"
    audit_label = "pass" if sample.executable else "fail"
    replay_metadata = {
        "targets": target_results,
        "label": replay_label,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "audit_label": audit_label,
        "audit_replay_agree": replay_label == audit_label,
        "smoke_load_requested": smoke_load,
        "runtime_ms": sum(result["runtime_ms"] for result in target_results.values()),
    }
    return sample.model_copy(
        deep=True,
        update={
            "simulator_exports": {
                **sample.simulator_exports,
                **{target: target_results[target] for target in normalized_targets},
            },
            "metadata": {
                **sample.metadata,
                "sim_replay_label": replay_label,
                "sim_replay": replay_metadata,
            },
        },
    )


def replay_label_samples(
    samples: Sequence[WorldModelTrainingSample],
    *,
    targets: Sequence[str] | str | None = None,
    smoke_load: bool = False,
) -> list[WorldModelTrainingSample]:
    normalized_targets = normalize_replay_targets(targets)
    return [replay_label_sample(sample, targets=normalized_targets, smoke_load=smoke_load) for sample in samples]


# Stepped-position agreement tolerance: generous enough for solver differences,
# tight enough to reject teleports, interpenetration pop-out, and frame flips
# (the corruption suite perturbs positions by decimeters or more).
STEPPING_POSITION_TOLERANCE_M = 0.15
_STEPPING_TIMESTEP_S = 0.002
_STEPPING_MIN_DT_S = 0.002


def replay_label_samples_with_stepping(
    samples: Sequence[WorldModelTrainingSample],
    *,
    targets: Sequence[str] | str | None = None,
    position_tolerance_m: float = STEPPING_POSITION_TOLERANCE_M,
) -> list[WorldModelTrainingSample]:
    """Label samples by actually stepping physics over the transition.

    For each state -> next_state transition: frame 0 entities are loaded into
    MuJoCo (movable entities as free bodies with their recorded velocities),
    physics steps for the transition's dt, and the stepped positions are
    compared against the claimed next_state positions. A transition whose
    claimed next state disagrees with stepped physics beyond
    ``position_tolerance_m`` (or that diverges to NaN) is labeled fail.
    """
    del targets  # stepping oracle currently runs on MuJoCo
    return [
        _stepping_label_sample(sample, position_tolerance_m=position_tolerance_m)
        for sample in samples
    ]


def _stepping_label_sample(
    sample: WorldModelTrainingSample,
    *,
    position_tolerance_m: float,
) -> WorldModelTrainingSample:
    started = time.perf_counter()
    try:
        trace = transition_trace_from_sample(sample)
        result = _step_transition_mujoco(trace, position_tolerance_m=position_tolerance_m)
    except (ValueError, RuntimeError) as exc:
        result = {
            "label": "fail",
            "error": str(exc),
            "max_position_error_m": None,
            "entities_compared": 0,
        }
    result["runtime_ms"] = (time.perf_counter() - started) * 1000.0
    replay_label = result["label"]
    audit_label = "pass" if sample.executable else "fail"
    replay_metadata = {
        "mode": "stepping",
        "targets": {"mujoco": result},
        "label": replay_label,
        "pass_count": 1 if replay_label == "pass" else 0,
        "fail_count": 0 if replay_label == "pass" else 1,
        "audit_label": audit_label,
        "audit_replay_agree": replay_label == audit_label,
        "position_tolerance_m": position_tolerance_m,
        "runtime_ms": result["runtime_ms"],
    }
    return sample.model_copy(
        deep=True,
        update={
            "metadata": {
                **sample.metadata,
                "sim_replay_label": replay_label,
                "sim_replay": replay_metadata,
            },
        },
    )


def _step_transition_mujoco(
    trace: PhysicalRolloutTrace,
    *,
    position_tolerance_m: float,
) -> dict[str, Any]:
    import math
    from xml.etree import ElementTree as ET

    import mujoco

    frame_before, frame_after = trace.frames[0], trace.frames[-1]
    dt_s = max((frame_after.t_ms - frame_before.t_ms) / 1000.0, _STEPPING_MIN_DT_S)

    root = ET.Element("mujoco", {"model": "wsp_stepping_replay"})
    ET.SubElement(root, "compiler", {"angle": "radian"})
    ET.SubElement(root, "option", {"timestep": str(_STEPPING_TIMESTEP_S), "gravity": "0 0 -9.81"})
    worldbody = ET.SubElement(root, "worldbody")
    ET.SubElement(
        worldbody,
        "geom",
        {"name": "floor", "type": "plane", "pos": "0 0 0", "size": "10 10 0.01"},
    )
    movable_ids: list[str] = []
    for entity in frame_before.entities:
        size = entity.size_xyz or [0.1, 0.1, 0.1]
        geom_attrs = {
            "name": f"{entity.entity_id}_geom",
            "type": "box",
            "size": " ".join(str(component / 2.0) for component in size),
        }
        if entity.mass_kg is not None:
            geom_attrs["mass"] = str(entity.mass_kg)
        if not entity.movable:
            geom_attrs.update(
                {
                    "pos": " ".join(str(v) for v in entity.position_xyz),
                    "quat": " ".join(str(v) for v in entity.quat_wxyz),
                }
            )
            ET.SubElement(worldbody, "geom", geom_attrs)
            continue
        body = ET.SubElement(
            worldbody,
            "body",
            {
                "name": f"{entity.entity_id}_body",
                "pos": " ".join(str(v) for v in entity.position_xyz),
                "quat": " ".join(str(v) for v in entity.quat_wxyz),
            },
        )
        ET.SubElement(body, "freejoint", {"name": f"{entity.entity_id}_freejoint"})
        ET.SubElement(body, "geom", geom_attrs)
        movable_ids.append(entity.entity_id)

    model = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding="unicode"))
    data = mujoco.MjData(model)
    for entity in frame_before.entities:
        if not entity.movable:
            continue
        joint_id = mujoco.mj_name2id(
            model, mujoco.mjtObj.mjOBJ_JOINT, f"{entity.entity_id}_freejoint"
        )
        velocity_address = model.jnt_dofadr[joint_id]
        data.qvel[velocity_address : velocity_address + 3] = entity.velocity_xyz
    mujoco.mj_forward(model, data)

    for _ in range(max(1, round(dt_s / _STEPPING_TIMESTEP_S))):
        mujoco.mj_step(model, data)

    claimed_positions = {
        entity.entity_id: entity.position_xyz for entity in frame_after.entities
    }
    max_error = 0.0
    compared = 0
    for entity_id in movable_ids:
        claimed = claimed_positions.get(entity_id)
        if claimed is None:
            continue
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, f"{entity_id}_body")
        stepped = data.xpos[body_id]
        if any(not math.isfinite(float(value)) for value in stepped):
            return {
                "label": "fail",
                "error": f"stepped state diverged (NaN) for {entity_id}",
                "max_position_error_m": None,
                "entities_compared": compared,
            }
        error = math.sqrt(sum((float(s) - float(c)) ** 2 for s, c in zip(stepped, claimed)))
        max_error = max(max_error, error)
        compared += 1

    return {
        "label": "pass" if max_error <= position_tolerance_m else "fail",
        "max_position_error_m": max_error,
        "entities_compared": compared,
        "stepped_dt_s": dt_s,
    }


def summarize_replay_labeled_samples(samples: Sequence[WorldModelTrainingSample]) -> dict[str, Any]:
    pass_count = sum(1 for sample in samples if sample.metadata.get("sim_replay_label") == "pass")
    fail_count = sum(1 for sample in samples if sample.metadata.get("sim_replay_label") == "fail")
    agreement_count = sum(1 for sample in samples if sample.metadata.get("sim_replay", {}).get("audit_replay_agree") is True)
    runtime_ms_values = [
        float(sample.metadata.get("sim_replay", {}).get("runtime_ms", 0.0))
        for sample in samples
        if isinstance(sample.metadata.get("sim_replay", {}).get("runtime_ms"), int | float)
    ]
    target_counts: dict[str, dict[str, int]] = {}
    for sample in samples:
        target_results = sample.metadata.get("sim_replay", {}).get("targets", {})
        if not isinstance(target_results, dict):
            continue
        for target, result in target_results.items():
            if not isinstance(result, dict):
                continue
            target_counts.setdefault(target, {"pass": 0, "fail": 0})
            label = "pass" if result.get("label") == "pass" else "fail"
            target_counts[target][label] += 1
    return {
        "sample_count": len(samples),
        "pass_count": pass_count,
        "fail_count": fail_count,
        "audit_replay_agreement_count": agreement_count,
        "audit_replay_agreement_rate": agreement_count / len(samples) if samples else 0.0,
        "mean_runtime_ms": sum(runtime_ms_values) / len(runtime_ms_values) if runtime_ms_values else 0.0,
        "target_counts": target_counts,
    }
