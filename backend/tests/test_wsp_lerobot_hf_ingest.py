from __future__ import annotations

import importlib
import math
import sys
from types import SimpleNamespace

import pytest

from backend.services.wsp_lerobot_hf_ingest import (
    SO101_DATASET_JOINT_NAMES,
    _ENTRY_CACHE,
    _load_hf_dataset_loader,
    _ROBOT_CONFIGS,
    _RobotConfig,
    fk_ee_from_degrees,
    get_robot_urdf_entry,
    joint_dict_from_degrees,
)

# First frame of episode 0 from lerobot/svla_so101_pickplace (hardcoded for offline tests).
_FRAME0_DEG = [1.9560878, -98.74372, 98.92424, 74.81983, -51.45299, 1.40939]
_FRAME0_RAD_SHOULDER_PAN = math.radians(1.9560878)


def test_joint_dict_from_degrees_maps_all_names() -> None:
    q = joint_dict_from_degrees(_FRAME0_DEG)
    assert set(q.keys()) == set(SO101_DATASET_JOINT_NAMES)
    assert math.isclose(q["shoulder_pan"], _FRAME0_RAD_SHOULDER_PAN, rel_tol=1e-5)


def test_joint_dict_from_degrees_converts_units() -> None:
    q = joint_dict_from_degrees([180.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    assert math.isclose(q["shoulder_pan"], math.pi, rel_tol=1e-5)


def test_fk_ee_from_degrees_returns_finite_xyz() -> None:
    pos = fk_ee_from_degrees(_FRAME0_DEG)
    assert len(pos) == 3
    assert all(math.isfinite(v) for v in pos), "FK must return finite coordinates"


def test_fk_ee_from_degrees_is_in_plausible_workspace() -> None:
    # SO-101 reach is ~20 cm; EE should be within 0.5 m of base in all axes
    pos = fk_ee_from_degrees(_FRAME0_DEG)
    for i, axis in enumerate("xyz"):
        assert abs(pos[i]) < 0.5, f"{axis} = {pos[i]:.4f} m is outside plausible workspace"


def test_fk_ee_pan_sweeps_y_axis() -> None:
    # SO-101 faces +X at pan=0; shoulder_pan sweeps the Y axis.
    pos_neg = fk_ee_from_degrees([-60.0] + _FRAME0_DEG[1:])
    pos_pos = fk_ee_from_degrees([60.0] + _FRAME0_DEG[1:])
    assert pos_neg[1] > 0, "negative pan should move EE toward +Y"
    assert pos_pos[1] < 0, "positive pan should move EE toward -Y"
    assert pos_neg[1] > pos_pos[1], "pan sweep must be monotone in Y"


def test_get_robot_urdf_entry_rejects_invalid_urdf_encoding(tmp_path) -> None:
    urdf_path = tmp_path / "bad.urdf"
    urdf_path.write_bytes(b"\xff\xfe\x00")
    _ENTRY_CACHE.pop("test-bad", None)
    _ROBOT_CONFIGS["test-bad"] = _RobotConfig(
        urdf_path=urdf_path,
        ee_link="tool0",
        entity_id="test-bad",
    )

    try:
        with pytest.raises(ValueError, match=r"Failed to read LeRobot URDF:"):
            get_robot_urdf_entry("test-bad")
    finally:
        _ENTRY_CACHE.pop("test-bad", None)
        _ROBOT_CONFIGS.pop("test-bad", None)


def _hf_integration_available() -> bool:
    try:
        _load_hf_dataset_loader()
    except ImportError:
        return False
    try:
        import requests
    except ImportError:
        return False
    try:
        return requests.head("https://huggingface.co", timeout=3).ok
    except requests.RequestException:
        return False


def test_hf_integration_available_returns_false_without_datasets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda _name: (_ for _ in ()).throw(ImportError("datasets")),
    )

    assert _hf_integration_available() is False


def test_hf_integration_available_returns_false_on_expected_request_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: SimpleNamespace(load_dataset=lambda *_args, **_kwargs: None) if name == "datasets" else None,
    )
    requests_module = SimpleNamespace(
        RequestException=RuntimeError,
        head=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("network unavailable")),
    )
    monkeypatch.setitem(sys.modules, "requests", requests_module)

    assert _hf_integration_available() is False


def test_hf_integration_available_preserves_unexpected_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: SimpleNamespace(load_dataset=lambda *_args, **_kwargs: None) if name == "datasets" else None,
    )
    requests_module = SimpleNamespace(
        RequestException=RuntimeError,
        head=lambda *_args, **_kwargs: (_ for _ in ()).throw(KeyError("unexpected requests failure")),
    )
    monkeypatch.setitem(sys.modules, "requests", requests_module)

    with pytest.raises(KeyError, match="unexpected requests failure"):
        _hf_integration_available()


def test_hf_integration_available_returns_false_for_incomplete_datasets_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: SimpleNamespace(load_dataset=None) if name == "datasets" else None,
    )

    assert _hf_integration_available() is False


def test_load_hf_dataset_loader_rejects_incomplete_datasets_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_import_module(name: str) -> object:
        if name == "datasets":
            return SimpleNamespace(load_dataset=None)
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    with pytest.raises(ImportError, match="pip install datasets"):
        _load_hf_dataset_loader()


@pytest.mark.skipif(
    not _hf_integration_available(),
    reason="HuggingFace integration requires network access and the optional datasets package",
)
def test_load_lerobot_hf_episode_compiles_real_trace() -> None:
    from backend.services.wsp_lerobot_hf_ingest import load_lerobot_hf_episode
    from backend.services.world_model_dataset import validate_world_model_dataset_samples
    from backend.services.wsp_lerobot_hf_ingest import build_so101_hf_benchmark

    trace = load_lerobot_hf_episode(
        "lerobot/svla_so101_pickplace",
        episode_index=0,
        max_frames=10,
    )

    assert trace.trace_id.startswith("lerobot-hf-svla_so101_pickplace-ep0000")
    assert len(trace.frames) == 10
    assert len(trace.actions) == 9
    assert trace.metadata["source_kind"] == "lerobot_hf"
    assert trace.metadata["robot"] == "so101"

    # All frames should have robot + table entities
    for frame in trace.frames:
        ids = {e.entity_id for e in frame.entities}
        assert "so101" in ids
        assert "work_surface" in ids
        # EE position must be in plausible workspace
        robot = next(e for e in frame.entities if e.entity_id == "so101")
        assert all(abs(v) < 0.5 for v in robot.position_xyz), (
            f"EE out of workspace: {robot.position_xyz}"
        )

    samples = build_so101_hf_benchmark(
        episode_indices=[0],
        max_frames_per_episode=10,
    )
    assert len(samples) == 9
    readiness = validate_world_model_dataset_samples(samples)
    assert readiness.ready is True
