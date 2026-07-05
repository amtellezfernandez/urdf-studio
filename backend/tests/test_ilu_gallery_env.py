from __future__ import annotations

import pytest

from backend.services import ilu_gallery


def test_read_env_str_returns_default_for_non_string_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ilu_gallery.os,
        "getenv",
        lambda name, default=None: object() if name == "URDF_TEST_GALLERY_TEXT" else default,
    )

    assert ilu_gallery._read_env_str("URDF_TEST_GALLERY_TEXT", "fallback") == "fallback"


def test_read_env_str_returns_default_for_blank_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("URDF_TEST_GALLERY_TEXT", "   ")

    assert ilu_gallery._read_env_str("URDF_TEST_GALLERY_TEXT", "fallback") == "fallback"
