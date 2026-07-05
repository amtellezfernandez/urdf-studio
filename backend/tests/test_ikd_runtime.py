from __future__ import annotations

import pytest

from backend.services import ikd_runtime


def test_config_flags_coerce_string_config_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ikd_runtime,
        "read_app_config",
        lambda: {
            "ikd": {
                "enabled": "false",
                "useForDrag": "yes",
                "controlHz": "750",
                "telemetryHz": "120",
                "staleTargetMs": "400",
            }
        },
    )

    manager = ikd_runtime.IkdRuntimeManager()

    assert manager._config_flags() == (False, True, 750, 120, 400)


def test_config_flags_ignore_invalid_config_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ikd_runtime,
        "read_app_config",
        lambda: {
            "ikd": {
                "enabled": 7,
                "useForDrag": [],
                "controlHz": True,
                "telemetryHz": "bad",
                "staleTargetMs": "",
            }
        },
    )

    manager = ikd_runtime.IkdRuntimeManager()

    assert manager._config_flags() == (False, False, 500, 60, 250)
