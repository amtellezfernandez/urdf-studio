from __future__ import annotations

import json
import sys

import pytest

from backend.scripts import ik_benchmark_suite


def _patch_minimal_benchmark_inputs(
    monkeypatch: pytest.MonkeyPatch,
    output_path,
    *,
    solve_policy,
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "ik_benchmark_suite.py",
            "--samples",
            "demo",
            "--targets",
            "1",
            "--target-sets",
            "nominal",
            "--policies",
            "amik-direct",
            "--output",
            str(output_path),
        ],
    )
    monkeypatch.setattr(ik_benchmark_suite, "load_sample_urdf", lambda _sample_id: "<robot name='demo'/>")
    monkeypatch.setattr(ik_benchmark_suite, "find_leaf_link", lambda _urdf_xml: "tool")
    monkeypatch.setattr(
        ik_benchmark_suite,
        "generate_target_set",
        lambda *_args: ([(0.0, 0.0, 0.0)], [(1.0, 0.0, 0.0, 0.0)]),
    )
    monkeypatch.setattr(ik_benchmark_suite, "solve_policy", solve_policy)


def test_ik_benchmark_records_expected_solver_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    output_path = tmp_path / "benchmark.jsonl"

    def _raise_solver_error(*_args):
        raise RuntimeError("solver failed")

    _patch_minimal_benchmark_inputs(
        monkeypatch,
        output_path,
        solve_policy=_raise_solver_error,
    )

    ik_benchmark_suite.main()

    rows = [
        json.loads(line)
        for line in output_path.read_text(encoding="utf-8").splitlines()
    ]
    assert len(rows) == 1
    assert rows[0]["success"] is False
    assert rows[0]["solver_policy"] == "amik-direct"
    assert rows[0]["escalation_blocked_reason"] == "exception"


def test_ik_benchmark_preserves_unexpected_solver_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    output_path = tmp_path / "benchmark.jsonl"

    def _raise_unexpected_error(*_args):
        raise KeyError("unexpected benchmark failure")

    _patch_minimal_benchmark_inputs(
        monkeypatch,
        output_path,
        solve_policy=_raise_unexpected_error,
    )

    with pytest.raises(KeyError, match="unexpected benchmark failure"):
        ik_benchmark_suite.main()
