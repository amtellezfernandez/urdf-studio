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


def test_normalize_optional_text_rejects_non_string_values() -> None:
    assert ilu_gallery._normalize_optional_text(123) == ""
    assert ilu_gallery._normalize_optional_text(False) == ""


def test_catalog_from_snapshot_ignores_non_string_repo_keys_and_file_bases() -> None:
    catalog = ilu_gallery._catalog_from_snapshot(
        {
            "repoEntries": [
                {"repoKey": 123, "name": "bad"},
                {"repoKey": "acme/demo", "name": "good"},
            ],
            "previewEntries": [
                {"repoKey": 123, "fileBase": "bad-base"},
                {"repoKey": "acme/demo", "fileBase": 456},
                {"repoKey": "acme/demo", "fileBase": "demo-base"},
            ],
        }
    )

    assert list(catalog.repo_entries) == ["acme/demo"]
    assert list(catalog.preview_entries) == ["acme/demo::demo-base"]
