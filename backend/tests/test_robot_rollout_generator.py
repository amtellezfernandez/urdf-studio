from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest

from backend.services import robot_rollout_generator as rollout_generator


def test_load_urdf_entry_rejects_missing_yourdfpy_loader(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_import_module(name: str) -> object:
        if name == "yourdfpy":
            return SimpleNamespace(URDF=SimpleNamespace(load=None))
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    with pytest.raises(ValueError, match="yourdfpy.URDF.load is unavailable"):
        rollout_generator.load_urdf_entry("<robot name='demo'/>")


def test_load_urdf_entry_rejects_missing_yourdfpy_module(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_import_module(name: str) -> object:
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    with pytest.raises(ValueError, match="yourdfpy is not installed"):
        rollout_generator.load_urdf_entry("<robot name='demo'/>")
