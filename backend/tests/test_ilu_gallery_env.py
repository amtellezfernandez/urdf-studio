from __future__ import annotations

import pytest

from backend.models.ilu_gallery import IluGallerySource
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


def test_build_repo_robot_index_ignores_non_string_core_fields() -> None:
    index = ilu_gallery._build_repo_robot_index(
        {
            "robots": [
                {"fileBase": 123, "file": "robots/bad.urdf", "name": "bad"},
                {"fileBase": "demo-base", "file": ["robots", "demo.urdf"], "name": "bad"},
                {"fileBase": "demo-base", "file": "robots/demo.urdf", "name": 456},
            ]
        }
    )

    assert set(index) == {"robots/demo.urdf", "demo.urdf", "demo"}
    assert index["robots/demo.urdf"]["name"] == ""


def test_resolve_gallery_preview_entry_ignores_non_string_file_base() -> None:
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={
            "acme/demo": [
                {
                    "repoKey": "acme/demo",
                    "robots": [
                        {"fileBase": 123, "file": "robots/demo.urdf", "name": "bad"},
                    ],
                }
            ]
        },
        preview_entries={"acme/demo::123": {"repoKey": "acme/demo", "fileBase": "123"}},
    )
    source = IluGallerySource(owner="acme", repo="demo")

    repo_entry, preview_entry, robot_entry = ilu_gallery._resolve_gallery_preview_entry(
        catalog,
        source,
        "robots/demo.urdf",
    )

    assert isinstance(repo_entry, dict)
    assert preview_entry is None
    assert robot_entry is None


def test_build_gallery_manifest_item_ignores_non_string_preview_metadata() -> None:
    item = ilu_gallery._build_gallery_manifest_item(
        source=IluGallerySource(owner="acme", repo="demo"),
        candidate_path="robots/demo.urdf",
        candidate={
            "inspectionMode": 123,
            "displayName": "Demo Robot",
            "sourceFile": "robots/demo.urdf",
            "fileBase": "demo-base",
        },
        repo_entry=None,
        preview_entry={
            "repoKey": 123,
            "fileBase": False,
            "png": [],
            "webm": {},
        },
        robot_entry={"name": 456, "file": None},
        repo_file_bytes_by_path=None,
        resolve_robot_traits=False,
    )

    assert item["galleryRepoKey"] == ""
    assert item["galleryFileBase"] == ""
    assert item["galleryPngPath"] == ""
    assert item["galleryWebmPath"] == ""
    assert item["galleryRobotName"] == ""
    assert item["sourceFile"] == "robots/demo.urdf"


def test_rehydrate_gallery_manifest_item_ignores_non_string_preview_and_robot_fields() -> None:
    source = IluGallerySource(owner="acme", repo="demo")
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={
            "acme/demo": [
                {
                    "repoKey": "acme/demo",
                    "robots": [{"fileBase": "demo-base", "file": 123, "name": False}],
                }
            ]
        },
        preview_entries={"acme/demo::demo-base": {"repoKey": 123, "fileBase": []}},
    )

    rehydrated = ilu_gallery._rehydrate_gallery_item_from_catalog_snapshot(
        source,
        {
            "candidatePath": "robots/demo.urdf",
            "galleryRepoKey": "",
            "galleryFileBase": "",
            "galleryRobotName": "",
            "sourceFile": "",
            "tags": [],
            "macroTags": [],
        },
        catalog,
    )

    assert rehydrated["galleryRobotName"] == ""
    assert rehydrated["sourceFile"] == ""
    assert rehydrated["galleryRepoKey"] == ""
    assert rehydrated["galleryFileBase"] == ""


def test_resolve_candidate_file_base_rejects_non_string_values() -> None:
    with pytest.raises(RuntimeError, match="Gallery file base is missing"):
        ilu_gallery._resolve_candidate_file_base(
            "robots/demo.urdf",
            {"galleryFileBase": 123, "fileBase": False},
        )


def test_resolve_candidate_file_base_accepts_string_values() -> None:
    assert (
        ilu_gallery._resolve_candidate_file_base(
            "robots/demo.urdf",
            {"galleryFileBase": " demo-base "},
        )
        == "demo-base"
    )
