from __future__ import annotations

import sys

import pytest

from backend.scripts import ik_probe


def test_ik_probe_main_reports_expected_probe_errors(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "argv", ["ik_probe.py"])
    monkeypatch.setattr(
        ik_probe,
        "run_probe",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("sample is unavailable")),
    )

    assert ik_probe.main() == 1
    assert capsys.readouterr().err == "[ik_probe] failed: sample is unavailable\n"


def test_ik_probe_main_preserves_unexpected_probe_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["ik_probe.py"])
    monkeypatch.setattr(
        ik_probe,
        "run_probe",
        lambda *_args: (_ for _ in ()).throw(KeyError("unexpected probe failure")),
    )

    with pytest.raises(KeyError, match="unexpected probe failure"):
        ik_probe.main()
