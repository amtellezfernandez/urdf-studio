from __future__ import annotations

import pytest

from backend.services import robot_rollout_generator as rollout_generator


def test_load_urdf_entry_rejects_missing_yourdfpy_loader(monkeypatch: pytest.MonkeyPatch) -> None:
    class _LoaderlessUrdf:
        pass

    monkeypatch.setattr(rollout_generator.yourdfpy, "URDF", _LoaderlessUrdf)

    with pytest.raises(ValueError, match="yourdfpy.URDF.load is unavailable"):
        rollout_generator.load_urdf_entry("<robot name='demo'/>")
