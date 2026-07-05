from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.models.ilu_gallery import IluGalleryPublishedRepo, IluGallerySource
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


def test_build_gallery_media_url_rejects_non_string_paths() -> None:
    assert ilu_gallery._build_gallery_media_url(None) is None
    assert ilu_gallery._build_gallery_media_url(" previews/demo.png ") is not None
    assert ilu_gallery._build_gallery_media_url([]) is None  # type: ignore[arg-type]


def test_normalize_text_list_ignores_non_string_entries() -> None:
    assert ilu_gallery._normalize_text_list([" one ", 2, None, "one", False, "two"]) == ["one", "two"]


def test_merge_text_lists_ignores_non_string_entries() -> None:
    assert ilu_gallery._merge_text_lists([" one ", 2, "two"], ["two", None, " three "]) == [
        "one",
        "two",
        "three",
    ]


def test_build_gallery_item_status_ignores_non_string_inspection_mode() -> None:
    status = ilu_gallery._build_gallery_item_status(
        {
            "inspectionMode": 123,
            "hasRenderableGeometry": True,
            "unresolvedMeshReferenceCount": 2,
        }
    )

    assert status == "renderable, 2 unresolved mesh refs"


def test_resolve_generate_asset_kinds_ignores_non_string_values() -> None:
    request = SimpleNamespace(asset_kinds=[" image ", 2, None, "video", "image"])

    assert ilu_gallery._resolve_generate_asset_kinds(request) == ["image", "video"]


def test_resolve_generate_asset_kinds_rejects_non_string_only_values() -> None:
    request = SimpleNamespace(asset_kinds=[1, None, False])

    with pytest.raises(RuntimeError, match="Select at least one asset kind"):
        ilu_gallery._resolve_generate_asset_kinds(request)


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


def test_catalog_from_payloads_ignores_non_string_repo_keys_and_file_bases() -> None:
    catalog = ilu_gallery._catalog_from_payloads(
        [
            {"repoKey": 123, "name": "bad"},
            {"repoKey": "acme/demo", "name": "good"},
        ],
        [
            {"repoKey": 123, "fileBase": "bad-base"},
            {"repoKey": "acme/demo", "fileBase": []},
            {"repoKey": "acme/demo", "fileBase": "demo-base"},
        ],
    )

    assert list(catalog.repo_entries) == ["acme/demo"]
    assert list(catalog.preview_entries) == ["acme/demo::demo-base"]


def test_github_helpers_ignore_non_string_response_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = iter(
        [
            {"default_branch": []},
            {"object": {"sha": 123}},
            {"tree": {"sha": object()}},
            {"sha": []},
            {"sha": 123},
            {"sha": None},
        ]
    )

    monkeypatch.setattr(ilu_gallery, "_github_api_request", lambda *_args, **_kwargs: next(responses))

    with pytest.raises(RuntimeError, match="does not expose a default branch"):
        ilu_gallery._github_get_repo_default_branch("acme/demo", "token")
    assert ilu_gallery._github_get_ref_sha("acme/demo", "heads/main", "token") is None
    with pytest.raises(RuntimeError, match="does not expose a tree SHA"):
        ilu_gallery._github_get_commit_tree_sha("acme/demo", "commit-sha", "token")
    with pytest.raises(RuntimeError, match="did not return a blob SHA"):
        ilu_gallery._github_create_blob("acme/demo", "token", "content", "utf-8")
    with pytest.raises(RuntimeError, match="did not return a tree SHA"):
        ilu_gallery._github_create_tree("acme/demo", "token", "base-tree", [])
    with pytest.raises(RuntimeError, match="did not return a commit SHA"):
        ilu_gallery._github_create_commit("acme/demo", "token", "message", "tree-sha", "parent-sha")


def test_publish_gallery_job_rejects_non_string_pull_request_url(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ilu_gallery, "get_gallery_job", lambda _job_id: SimpleNamespace(status="completed"))
    monkeypatch.setattr(ilu_gallery, "resolve_server_github_token", lambda: "token")
    monkeypatch.setattr(ilu_gallery, "_get_job_record", lambda _job_id: SimpleNamespace(output_root=str(tmp_path)))
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda _record, _output_root: SimpleNamespace(
            repo_slug="acme/demo",
            branch_name="gallery/update",
            title="Update gallery",
            body="body",
            files=[SimpleNamespace(path="robots/demo.urdf", content="{}", encoding="utf-8")],
        ),
    )
    monkeypatch.setattr(ilu_gallery, "_github_get_repo_default_branch", lambda _repo_slug, _token: "main")
    monkeypatch.setattr(
        ilu_gallery,
        "_github_get_ref_sha",
        lambda _repo_slug, ref, _token: None if ref == "heads/gallery/update" else "base-sha",
    )
    monkeypatch.setattr(ilu_gallery, "_github_get_commit_tree_sha", lambda _repo_slug, _sha, _token: "tree-base")
    monkeypatch.setattr(ilu_gallery, "_github_create_blob", lambda _repo_slug, _token, _content, _encoding: "blob-sha")
    monkeypatch.setattr(ilu_gallery, "_github_create_tree", lambda _repo_slug, _token, _base_tree_sha, _files: "tree-sha")
    monkeypatch.setattr(ilu_gallery, "_github_create_commit", lambda *_args, **_kwargs: "commit-sha")
    monkeypatch.setattr(ilu_gallery, "_github_upsert_ref", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(ilu_gallery, "_github_find_open_pull_request", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_pull_request",
        lambda *_args, **_kwargs: {"number": 42, "html_url": 123},
    )

    with pytest.raises(RuntimeError, match="did not return a valid pull request"):
        ilu_gallery.publish_gallery_job("job-1")


def test_build_gallery_manifest_from_catalog_ignores_non_string_candidate_path_and_file_base(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = IluGallerySource(owner="acme", repo="demo")
    selected_repo_entry = {
        "repoKey": "acme/demo",
        "robots": [
            {"file": "robots/demo.urdf", "fileBase": 123, "name": "Demo"},
        ],
    }
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={"acme/demo": [selected_repo_entry]},
        preview_entries={"acme/demo::demo-base": {"repoKey": "acme/demo", "fileBase": "demo-base"}},
    )

    monkeypatch.setattr(ilu_gallery, "_load_gallery_catalog_for_source", lambda _source: catalog)
    monkeypatch.setattr(ilu_gallery, "_select_repo_entry", lambda _source, _catalog: selected_repo_entry)
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_live_candidate_lookup",
        lambda _source: {"robots/demo.urdf": {"path": ["robots/demo.urdf"]}},
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_catalog_candidate",
        lambda _source, _repo_entry, _raw_robot, _lookup: {"path": ["robots/demo.urdf"]},
    )
    monkeypatch.setattr(ilu_gallery, "_catalog_snapshot_from_catalog", lambda _catalog: None)
    monkeypatch.setattr(ilu_gallery, "_write_manifest", lambda _output_root, _manifest: None)

    manifest = ilu_gallery._build_gallery_manifest_from_catalog(source, tmp_path)

    assert manifest is None


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


def test_resolve_gallery_repo_asset_paths_ignores_non_string_prefilled_values() -> None:
    source = IluGallerySource(owner="acme", repo="demo")

    resolved = ilu_gallery._resolve_gallery_repo_asset_paths(
        source,
        {
            "galleryRepoKey": 123,
            "galleryFileBase": False,
            "galleryPngPath": [],
            "galleryWebmPath": {},
            "fileBase": "demo-base",
        },
        "robots/demo.urdf",
    )

    assert resolved == {
        "repoKey": "acme/demo",
        "fileBase": "demo-base",
        "png": "thumbnails/acme/demo/demo-base.png",
        "webm": "previews/acme/demo/demo-base.webm",
    }


def test_merge_generated_gallery_manifest_ignores_non_string_generated_paths(
    tmp_path: Path,
) -> None:
    source = IluGallerySource(owner="acme", repo="demo")
    merged = ilu_gallery._merge_generated_manifest(
        source,
        tmp_path,
        {
            "items": [
                {
                    "candidatePath": "robots/demo.urdf",
                    "galleryRepoKey": "",
                    "galleryFileBase": "demo-base",
                    "galleryPngPath": "",
                    "galleryWebmPath": "",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoPath": "",
                    "videoUrl": "",
                    "status": "inspect ok",
                }
            ]
        },
        {
            "items": [
                {
                    "candidatePath": ["robots/demo.urdf"],
                    "thumbnailPath": 123,
                    "videoPath": {},
                }
            ]
        },
        [ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE],
    )

    merged_item = merged["items"][0]
    assert merged_item["thumbnailPath"] == ""
    assert merged_item["galleryPngPath"] == ""


def test_build_gallery_manifest_from_inspection_skips_non_string_candidate_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = IluGallerySource(owner="acme", repo="demo")

    monkeypatch.setattr(ilu_gallery, "_load_gallery_catalog_for_source", lambda _source: None)
    monkeypatch.setattr(ilu_gallery, "_catalog_snapshot_from_catalog", lambda _catalog: None)
    monkeypatch.setattr(ilu_gallery, "_build_candidate_lookup", lambda _raw_candidates: {})
    monkeypatch.setattr(ilu_gallery, "_write_manifest", lambda _output_root, _manifest: None)

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        source,
        tmp_path,
        {
            "candidates": [
                {"path": ["robots/ignored.urdf"], "inspectionMode": "urdf"},
                {"path": "robots/demo.urdf", "inspectionMode": "urdf"},
            ]
        },
    )

    assert [item["candidatePath"] for item in manifest["items"]] == ["robots/demo.urdf"]


def test_sanitize_generated_gallery_item_ignores_non_string_paths(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "demo.webm"
    video_path.write_bytes(b"webm")

    sanitized = ilu_gallery._sanitize_generated_gallery_item(
        {
            "thumbnailPath": ["demo.png"],
            "videoPath": str(video_path),
        },
        [ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE, ilu_gallery.GALLERY_GENERATE_ASSET_KIND_VIDEO],
    )

    assert sanitized["thumbnailPath"] == ""
    assert sanitized["videoPath"] == str(video_path)


def test_count_generated_gallery_item_assets_ignores_non_string_paths(
    tmp_path: Path,
) -> None:
    thumbnail_path = tmp_path / "demo.png"
    thumbnail_path.write_bytes(b"png")

    generated_count = ilu_gallery._count_generated_gallery_item_assets(
        {
            "thumbnailPath": str(thumbnail_path),
            "videoPath": {"path": "demo.webm"},
        },
        [ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE, ilu_gallery.GALLERY_GENERATE_ASSET_KIND_VIDEO],
    )

    assert generated_count == 1


def test_merge_generated_gallery_items_by_candidate_path_ignores_non_string_values() -> None:
    merged = ilu_gallery._merge_generated_gallery_items_by_candidate_path(
        [
            {
                "candidatePath": ["robots/demo.urdf"],
                "thumbnailPath": "/tmp/ignored.png",
            },
            {
                "candidatePath": "robots/demo.urdf",
                "thumbnailPath": {"path": "/tmp/ignored.png"},
                "videoPath": "/tmp/demo.webm",
                "status": [],
            },
            {
                "candidatePath": "robots/demo.urdf",
                "status": "ready",
            },
        ]
    )

    assert merged == [
        {
            "candidatePath": "robots/demo.urdf",
            "videoPath": "/tmp/demo.webm",
            "status": "ready",
        }
    ]


def test_get_gallery_repo_preview_ignores_non_string_preview_item_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = IluGallerySource(owner="acme", repo="demo")

    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog_for_source",
        lambda _source: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_build_gallery_published_repo",
        lambda _source, _catalog: IluGalleryPublishedRepo(repo="demo"),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_preview_candidates",
        lambda _source, _candidates=None: [{"path": 123}, {"path": "robots/demo.urdf"}],
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_preview_entry",
        lambda _catalog, _source, candidate_path: ({"repoKey": "acme/demo"}, None, None)
        if candidate_path == "robots/demo.urdf"
        else (None, None, None),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_build_gallery_manifest_item",
        lambda **_kwargs: {
            "status": [],
            "sourceFile": {},
            "thumbnailUrl": 123,
            "previewUrl": False,
            "videoUrl": [],
            "galleryRepoKey": 456,
            "galleryFileBase": object(),
            "macroTags": ["preview"],
            "tags": ["urdf"],
        },
    )

    response = ilu_gallery.get_gallery_repo_preview(source)

    assert len(response.items) == 1
    item = response.items[0]
    assert item.urdf_path == "robots/demo.urdf"
    assert item.summary is None
    assert item.source_file is None
    assert item.thumbnail_url is None
    assert item.preview_url is None
    assert item.video_url is None
    assert item.gallery_repo_key is None
    assert item.gallery_file_base is None


def test_read_gallery_job_asset_file_ignores_non_string_manifest_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    thumbnail_path = tmp_path / "demo.png"
    thumbnail_path.write_bytes(b"png")

    monkeypatch.setattr(
        ilu_gallery,
        "_get_job_record",
        lambda _job_id: SimpleNamespace(output_root=str(tmp_path)),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_read_job_manifest",
        lambda _output_root: {
            "items": [
                {
                    "candidatePath": ["robots/demo.urdf"],
                    "thumbnailPath": str(thumbnail_path),
                },
                {
                    "candidatePath": "robots/demo.urdf",
                    "thumbnailPath": {"path": str(thumbnail_path)},
                },
            ]
        },
    )

    with pytest.raises(FileNotFoundError):
        ilu_gallery.read_gallery_job_asset_file("job-1", "robots/demo.urdf", ilu_gallery.GALLERY_ASSET_KIND_THUMBNAIL)
