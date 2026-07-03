from __future__ import annotations

import json
import pathlib
import zipfile
from contextlib import contextmanager
from io import BytesIO
from subprocess import CompletedProcess
from urllib.error import HTTPError

import pytest

from backend.models.ilu_gallery import (
    IluGalleryJobCreateRequest,
    IluGalleryJobGenerateRequest,
    IluGalleryPrDraftFile,
)
from backend.services import ilu_gallery


REAL_GALLERY_OWNER = "google-deepmind"
REAL_GALLERY_REPO = "mujoco_menagerie"
REAL_GALLERY_REPO_KEY = f"{REAL_GALLERY_OWNER}/{REAL_GALLERY_REPO}"
REAL_GALLERY_REPO_URL = f"https://github.com/{REAL_GALLERY_REPO_KEY}"
REAL_BARKOUR_PATH = "google_barkour_v0/barkour_v0.urdf"
REAL_BARKOUR_FILE = "barkour_v0.urdf"
REAL_BARKOUR_FILE_BASE = "barkour_v0"
REAL_BARKOUR_PNG_PATH = (
    f"thumbnails/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.png"
)
REAL_BARKOUR_WEBP_PATH = (
    f"previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webp"
)
REAL_BARKOUR_WEBM_PATH = (
    f"previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webm"
)
REAL_BARKOUR_VB_PATH = "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf"
REAL_BARKOUR_VB_FILE = "barkour_vb_rev_1_0_head_straight.urdf"
REAL_BARKOUR_VB_FILE_BASE = "barkour_vb_rev_1_0_head_straight"
REAL_XACRO_OWNER = "ros-planning"
REAL_XACRO_REPO = "moveit_resources"
REAL_XACRO_BRANCH = "ros2"
REAL_XACRO_PATH = "panda_description/urdf/panda.urdf.xacro"
REAL_XACRO_FILE = "panda.urdf.xacro"
REAL_XACRO_FILE_BASE = "panda"
REAL_OTHER_REPO_KEY = "robotis-git/turtlebot3"
REAL_OTHER_REPO_URL = "https://github.com/ROBOTIS-GIT/turtlebot3"
REAL_OTHER_FILE_BASE = "turtlebot3-burger"
REAL_OTHER_PNG_PATH = f"thumbnails/{REAL_OTHER_REPO_KEY}/{REAL_OTHER_FILE_BASE}.png"


@pytest.fixture(autouse=True)
def _reset_gallery_job_state(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    monkeypatch.setattr(ilu_gallery, "GALLERY_JOB_ROOT", tmp_path / "gallery-jobs")
    monkeypatch.setattr(ilu_gallery, "_gallery_jobs", {})
    monkeypatch.setattr(ilu_gallery, "_gallery_job_order", [])
    monkeypatch.setattr(ilu_gallery, "_gallery_inspect_cache_by_source", {})
    monkeypatch.setattr(ilu_gallery, "_gallery_inspect_cache_order", [])
    monkeypatch.setattr(ilu_gallery, "_gallery_active_inspect_job_id_by_source", {})
    monkeypatch.setattr(
        ilu_gallery,
        "_gallery_generation_semaphore",
        ilu_gallery.threading.BoundedSemaphore(1),
    )


def test_load_gallery_catalog_for_source_prefers_repo_shards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shard_source = ilu_gallery.IluGallerySource(
        owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
    )
    shard_repo_url = (
        f"{ilu_gallery.GALLERY_REPO_SHARDS_BASE_URL}/{REAL_GALLERY_REPO_KEY}.json"
    )
    shard_preview_url = (
        f"{ilu_gallery.GALLERY_PREVIEW_SHARDS_BASE_URL}/{REAL_GALLERY_REPO_KEY}.json"
    )
    requested_urls: list[str] = []

    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_cache_by_scope", {})
    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_miss_cache_by_scope", {})

    def _fake_read_remote_json(url: str, *, headers=None, timeout_seconds=0):
        del headers, timeout_seconds
        requested_urls.append(url)
        if url == shard_repo_url:
            return [
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "repo": REAL_GALLERY_REPO_URL,
                    "robots": [
                        {
                            "name": "Barkour V0",
                            "file": REAL_BARKOUR_FILE,
                            "fileBase": REAL_BARKOUR_FILE_BASE,
                        }
                    ],
                }
            ]
        if url == shard_preview_url:
            return {
                "previews": [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "fileBase": REAL_BARKOUR_FILE_BASE,
                        "png": REAL_BARKOUR_PNG_PATH,
                    }
                ]
            }
        pytest.fail(f"unexpected manifest fetch: {url}")

    monkeypatch.setattr(ilu_gallery, "_read_remote_json", _fake_read_remote_json)

    catalog = ilu_gallery._load_gallery_catalog_for_source(shard_source)

    assert requested_urls == [shard_repo_url, shard_preview_url]
    assert list(catalog.repo_entries) == [REAL_GALLERY_REPO_KEY]
    assert (
        catalog.repo_entries[REAL_GALLERY_REPO_KEY][0]["repo"] == REAL_GALLERY_REPO_URL
    )
    assert (
        catalog.preview_entries[f"{REAL_GALLERY_REPO_KEY}::{REAL_BARKOUR_FILE_BASE}"][
            "png"
        ]
        == REAL_BARKOUR_PNG_PATH
    )


def test_load_gallery_catalog_for_source_falls_back_to_full_manifests_on_missing_shards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shard_source = ilu_gallery.IluGallerySource(
        owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
    )
    shard_repo_url = (
        f"{ilu_gallery.GALLERY_REPO_SHARDS_BASE_URL}/{REAL_GALLERY_REPO_KEY}.json"
    )
    requested_urls: list[str] = []

    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_cache_by_scope", {})
    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_miss_cache_by_scope", {})

    def _fake_read_remote_json(url: str, *, headers=None, timeout_seconds=0):
        del headers, timeout_seconds
        requested_urls.append(url)
        if url == shard_repo_url:
            raise HTTPError(url, 404, "missing", hdrs=None, fp=None)
        if url == ilu_gallery.GALLERY_ROBOTS_MANIFEST_URL:
            return [
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "repo": REAL_GALLERY_REPO_URL,
                    "robots": [
                        {
                            "name": "Barkour V0",
                            "file": REAL_BARKOUR_FILE,
                            "fileBase": REAL_BARKOUR_FILE_BASE,
                        }
                    ],
                }
            ]
        if url == ilu_gallery.GALLERY_PREVIEWS_MANIFEST_URL:
            return {
                "previews": [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "fileBase": REAL_BARKOUR_FILE_BASE,
                        "png": REAL_BARKOUR_PNG_PATH,
                    }
                ]
            }
        pytest.fail(f"unexpected manifest fetch: {url}")

    monkeypatch.setattr(ilu_gallery, "_read_remote_json", _fake_read_remote_json)

    catalog = ilu_gallery._load_gallery_catalog_for_source(shard_source)

    assert requested_urls == [
        shard_repo_url,
        ilu_gallery.GALLERY_ROBOTS_MANIFEST_URL,
        ilu_gallery.GALLERY_PREVIEWS_MANIFEST_URL,
    ]
    assert list(catalog.repo_entries) == [REAL_GALLERY_REPO_KEY]
    assert (
        catalog.preview_entries[f"{REAL_GALLERY_REPO_KEY}::{REAL_BARKOUR_FILE_BASE}"][
            "png"
        ]
        == REAL_BARKOUR_PNG_PATH
    )


def test_load_gallery_catalog_for_source_caches_missing_shards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shard_source = ilu_gallery.IluGallerySource(
        owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
    )
    shard_repo_url = (
        f"{ilu_gallery.GALLERY_REPO_SHARDS_BASE_URL}/{REAL_GALLERY_REPO_KEY}.json"
    )
    requested_urls: list[str] = []

    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_cache_by_scope", {})
    monkeypatch.setattr(ilu_gallery, "_gallery_catalog_miss_cache_by_scope", {})

    def _fake_read_remote_json(url: str, *, headers=None, timeout_seconds=0):
        del headers, timeout_seconds
        requested_urls.append(url)
        if url == shard_repo_url:
            raise HTTPError(url, 404, "missing", hdrs=None, fp=None)
        if url == ilu_gallery.GALLERY_ROBOTS_MANIFEST_URL:
            return [
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "repo": REAL_GALLERY_REPO_URL,
                    "robots": [
                        {
                            "name": "Barkour V0",
                            "file": REAL_BARKOUR_FILE,
                            "fileBase": REAL_BARKOUR_FILE_BASE,
                        }
                    ],
                }
            ]
        if url == ilu_gallery.GALLERY_PREVIEWS_MANIFEST_URL:
            return {
                "previews": [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "fileBase": REAL_BARKOUR_FILE_BASE,
                        "png": REAL_BARKOUR_PNG_PATH,
                    }
                ]
            }
        pytest.fail(f"unexpected manifest fetch: {url}")

    monkeypatch.setattr(ilu_gallery, "_read_remote_json", _fake_read_remote_json)

    first_catalog = ilu_gallery._load_gallery_catalog_for_source(shard_source)
    second_catalog = ilu_gallery._load_gallery_catalog_for_source(shard_source)

    assert first_catalog == second_catalog


def test_get_gallery_repo_preview_returns_published_candidate_rows_with_optional_media(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = "google-deepmind"
    repo = "mujoco_menagerie"
    repo_key = f"{owner}/{repo}"
    primary_path = "google_barkour_v0/barkour_v0.urdf"
    primary_file = "barkour_v0.urdf"
    primary_file_base = "google-barkour-v0"
    secondary_path = "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf"
    secondary_file = "barkour_vb_rev_1_0_head_straight.urdf"
    secondary_file_base = "google-barkour-vb"
    source = ilu_gallery.IluGallerySource(owner=owner, repo=repo)
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={
            repo_key: [
                {
                    "repoKey": repo_key,
                    "repo": f"https://github.com/{repo_key}",
                    "org": "Google DeepMind",
                    "robots": [
                        {
                            "name": "Barkour V0",
                            "file": primary_path,
                            "fileBase": primary_file_base,
                        }
                    ],
                }
            ]
        },
        preview_entries={
            f"{repo_key}::{primary_file_base}": {
                "repoKey": repo_key,
                "fileBase": primary_file_base,
                "png": f"thumbnails/{repo_key}/{primary_file_base}.png",
                "webp": f"previews/{repo_key}/{primary_file_base}.webp",
            }
        },
    )

    monkeypatch.setattr(
        ilu_gallery, "_load_gallery_catalog_for_source", lambda _source: catalog
    )
    monkeypatch.setattr(
        ilu_gallery,
        "list_repo_candidates",
        lambda **kwargs: pytest.fail(
            "get_gallery_repo_preview should reuse the provided candidates"
        ),
    )

    preview = ilu_gallery.get_gallery_repo_preview(
        source,
        [
            {
                "path": primary_path,
                "name": primary_file,
                "displayName": "Barkour V0",
                "fileBase": primary_file_base,
                "sourceFile": primary_file,
                "hasMeshesFolder": True,
                "isXacro": False,
            },
            {
                "path": secondary_path,
                "name": secondary_file,
                "displayName": "Barkour VB",
                "fileBase": secondary_file_base,
                "sourceFile": secondary_file,
                "hasMeshesFolder": True,
                "isXacro": False,
            },
        ],
    )

    assert preview.published_repo is not None
    assert preview.published_repo.repo_key == repo_key
    assert [item.urdf_path for item in preview.items] == [
        primary_path,
        secondary_path,
    ]
    assert preview.items[0].thumbnail_url == (
        f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/thumbnails/{repo_key}/{primary_file_base}.png"
    )
    assert preview.items[0].preview_url == (
        f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/{repo_key}/{primary_file_base}.webp"
    )
    assert preview.items[1].thumbnail_url is None
    assert preview.items[1].preview_url is None


def test_create_gallery_job_generates_preview_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_generate",
        lambda source, output_root: {
            "outputRoot": str(output_root),
            "repoMetadata": {
                "org": "Google DeepMind",
                "summary": "Barkour quadruped models",
                "demo": REAL_GALLERY_REPO_URL,
                "tags": ["quadruped"],
                "license": "Apache-2.0",
                "authorWebsite": "https://deepmind.google",
                "authorX": "",
                "authorLinkedin": "",
                "authorGithub": REAL_GALLERY_OWNER,
                "contact": "",
                "extra": "",
            },
            "catalogSnapshot": {
                "repoEntries": [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "repo": REAL_GALLERY_REPO_URL,
                        "org": "Google DeepMind",
                        "summary": "Barkour quadruped models",
                        "authorGithub": REAL_GALLERY_OWNER,
                        "license": "Apache-2.0",
                        "robots": [
                            {
                                "name": "Barkour V0",
                                "file": REAL_BARKOUR_FILE,
                                "fileBase": REAL_BARKOUR_FILE_BASE,
                            }
                        ],
                    }
                ],
                "previewEntries": [],
            },
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "generated",
                    "macroTags": ["Arm"],
                    "meshCount": 13,
                    "linkCount": 7,
                    "jointCount": 6,
                    "armCount": 1,
                    "legCount": 0,
                    "wheelCount": 0,
                    "robotTraits": {
                        "primaryFamily": "manipulator",
                        "families": ["manipulator"],
                        "linkCount": 7,
                        "jointCount": 6,
                        "controllableJointCount": 6,
                        "dofCount": 6,
                        "armCount": 1,
                        "legCount": 0,
                        "wheelCount": 0,
                    },
                    "thumbnailPath": "",
                },
                {
                    "candidatePath": REAL_BARKOUR_VB_PATH,
                    "displayName": "Barkour VB",
                    "fileBase": REAL_BARKOUR_VB_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_VB_FILE,
                    "status": "generated-with-fixes",
                    "thumbnailPath": "",
                },
            ],
        },
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={
                "owner": REAL_GALLERY_OWNER,
                "repo": REAL_GALLERY_REPO,
                "path": "google_barkour_v0",
                "branch": "main",
            }
        )
    )
    resolved = ilu_gallery.get_gallery_job(response.job_id)

    assert resolved.status == "completed"
    assert resolved.phase == "inspect"
    assert resolved.repo_metadata.org == "Google DeepMind"
    assert resolved.repo_metadata.author_github == REAL_GALLERY_OWNER
    assert resolved.published_repo is not None
    assert resolved.published_repo.repo_key == REAL_GALLERY_REPO_KEY
    assert resolved.published_repo.robots[0].file == REAL_BARKOUR_FILE
    assert [item.urdf_path for item in resolved.items] == [
        REAL_BARKOUR_PATH,
        REAL_BARKOUR_VB_PATH,
    ]
    assert resolved.items[0].thumbnail_url is None
    assert resolved.items[0].preview_url is None
    assert resolved.items[0].macro_tags == ["Arm"]
    assert resolved.items[0].mesh_count == 13
    assert resolved.items[0].link_count == 7
    assert resolved.items[0].arm_count == 1
    assert resolved.items[0].tags == ["urdf"]
    assert resolved.items[0].robot_traits is not None
    assert resolved.items[0].robot_traits.primary_family == "manipulator"
    assert resolved.items[0].robot_traits.dof_count == 6
    assert resolved.items[1].tags == ["urdf"]
    assert resolved.items[1].robot_traits is None


def test_create_gallery_job_reuses_running_inspect_job_for_same_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started_threads: list[str] = []

    def _fake_start(thread: object) -> None:
        started_threads.append(getattr(thread, "name", ""))

    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", _fake_start)

    first = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={
                "owner": REAL_GALLERY_OWNER,
                "repo": REAL_GALLERY_REPO,
                "branch": "main",
            }
        )
    )
    second = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={
                "owner": REAL_GALLERY_OWNER,
                "repo": REAL_GALLERY_REPO,
                "branch": "main",
            }
        )
    )

    assert len(started_threads) == 1
    assert second.job_id == first.job_id
    assert second.status == "queued"


def test_create_gallery_job_reuses_cached_inspect_manifest_for_same_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generate_call_count = 0

    def _fake_gallery_generate(source, output_root):
        nonlocal generate_call_count
        generate_call_count += 1
        return {
            "outputRoot": str(output_root),
            "repoMetadata": {
                "org": "Google DeepMind",
                "summary": "Barkour quadruped models",
            },
            "catalogSnapshot": {
                "repoEntries": [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "repo": REAL_GALLERY_REPO_URL,
                        "org": "Google DeepMind",
                        "summary": "Barkour quadruped models",
                        "robots": [
                            {
                                "name": "Barkour V0",
                                "file": REAL_BARKOUR_FILE,
                                "fileBase": REAL_BARKOUR_FILE_BASE,
                            }
                        ],
                    }
                ],
                "previewEntries": [],
            },
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "generated",
                    "thumbnailPath": "",
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    first = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={
                "owner": REAL_GALLERY_OWNER,
                "repo": REAL_GALLERY_REPO,
                "branch": "main",
            }
        )
    )
    second = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={
                "owner": REAL_GALLERY_OWNER,
                "repo": REAL_GALLERY_REPO,
                "branch": "main",
            }
        )
    )
    first_record = ilu_gallery._get_job_record(first.job_id)
    second_record = ilu_gallery._get_job_record(second.job_id)

    assert generate_call_count == 1
    assert second.job_id != first.job_id
    assert second.status == "completed"
    assert second_record.items[0].urdf_path == REAL_BARKOUR_PATH
    assert second_record.output_root != first_record.output_root


def test_run_ilu_gallery_generate_rejects_catalog_only_repo_without_live_candidates(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
) -> None:
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={
            REAL_GALLERY_REPO_KEY: [
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "repo": REAL_GALLERY_REPO_URL,
                    "robots": [
                        {
                            "name": "Barkour V0",
                            "file": REAL_BARKOUR_FILE,
                            "fileBase": REAL_BARKOUR_FILE_BASE,
                        }
                    ],
                }
            ]
        },
        preview_entries={
            f"{REAL_GALLERY_REPO_KEY}::{REAL_BARKOUR_FILE_BASE}": {
                "repoKey": REAL_GALLERY_REPO_KEY,
                "fileBase": REAL_BARKOUR_FILE_BASE,
                "png": REAL_BARKOUR_PNG_PATH,
            }
        },
    )

    monkeypatch.setattr(
        ilu_gallery, "_load_gallery_catalog_for_source", lambda source: catalog
    )
    monkeypatch.setattr(
        ilu_gallery,
        "list_repo_candidates",
        lambda owner, repo, path="", branch=None: {
            "ref": branch or "main",
            "candidates": [],
        },
    )
    monkeypatch.setattr(
        ilu_gallery.subprocess,
        "run",
        lambda *args, **kwargs: CompletedProcess(
            args=args,
            returncode=0,
            stdout=json.dumps({"repoMetadata": {}, "candidates": []}),
            stderr="",
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="No renderable \\.urdf or \\.xacro file found in the repository\\.",
    ):
        ilu_gallery._run_ilu_gallery_generate(
            ilu_gallery.IluGallerySource(
                owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
            ),
            tmp_path / "gallery-job",
        )


def test_run_ilu_gallery_generate_uses_repo_candidate_summary_before_inspect_cli(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "list_repo_candidates",
        lambda owner, repo, path="", branch=None: {
            "ref": branch or "main",
            "candidates": [
                {
                    "path": REAL_BARKOUR_PATH,
                    "name": REAL_BARKOUR_FILE,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "hasMeshesFolder": True,
                    "meshesFolderPath": "google_barkour_v0/assets",
                    "isXacro": False,
                }
            ],
        },
    )
    monkeypatch.setattr(
        ilu_gallery.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail(
            "inspect CLI should not run when repo candidate summary succeeds"
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog_for_source",
        lambda source: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )

    manifest = ilu_gallery._run_ilu_gallery_generate(
        ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER,
            repo=REAL_GALLERY_REPO,
            path="google_barkour_v0",
            branch="main",
        ),
        tmp_path / "gallery-job",
    )

    assert [item["candidatePath"] for item in manifest["items"]] == [REAL_BARKOUR_PATH]
    assert (
        manifest["items"][0]["status"]
        == "repo not in gallery catalog | candidate discovered"
    )


def test_run_ilu_gallery_generate_reconciles_catalog_robot_paths_with_live_repo_candidates(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
) -> None:
    catalog = ilu_gallery._GalleryCatalog(
        repo_entries={
            "google-deepmind/mujoco_menagerie": [
                {
                    "repoKey": "google-deepmind/mujoco_menagerie",
                    "repo": "https://github.com/google-deepmind/mujoco_menagerie",
                    "path": "google_barkour_v0",
                    "robots": [
                        {
                            "name": "barkour_v0",
                            "file": "barkour_v0.urdf",
                            "fileBase": "barkour_v0--1b1ih7q",
                        },
                        {
                            "name": "barkour_vb_rev_1_0_head_straight",
                            "file": "barkour_vb_rev_1_0_head_straight.urdf",
                            "fileBase": "barkour_vb_rev_1_0_head_straight--1wgqhct",
                        },
                    ],
                }
            ]
        },
        preview_entries={
            "google-deepmind/mujoco_menagerie::barkour_v0--1b1ih7q": {
                "repoKey": "google-deepmind/mujoco_menagerie",
                "fileBase": "barkour_v0--1b1ih7q",
                "png": "thumbnails/google-deepmind/mujoco_menagerie/barkour_v0--1b1ih7q.png",
            },
            "google-deepmind/mujoco_menagerie::barkour_vb_rev_1_0_head_straight--1wgqhct": {
                "repoKey": "google-deepmind/mujoco_menagerie",
                "fileBase": "barkour_vb_rev_1_0_head_straight--1wgqhct",
                "png": "thumbnails/google-deepmind/mujoco_menagerie/barkour_vb_rev_1_0_head_straight--1wgqhct.png",
            },
        },
    )

    monkeypatch.setattr(
        ilu_gallery, "_load_gallery_catalog_for_source", lambda source: catalog
    )
    monkeypatch.setattr(
        ilu_gallery,
        "list_repo_candidates",
        lambda owner, repo, path="", branch=None: {
            "ref": branch or "main",
            "candidates": [
                {
                    "path": "google_barkour_v0/barkour_v0.urdf",
                    "name": "barkour_v0.urdf",
                    "displayName": "barkour_v0",
                    "fileBase": "barkour_v0--j4dbqd",
                    "sourceFile": "barkour_v0.urdf",
                    "isXacro": False,
                },
                {
                    "path": "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf",
                    "name": "barkour_vb_rev_1_0_head_straight.urdf",
                    "displayName": "barkour_vb_rev_1_0_head_straight",
                    "fileBase": "barkour_vb_rev_1_0_head_straight--5k5k5o",
                    "sourceFile": "barkour_vb_rev_1_0_head_straight.urdf",
                    "isXacro": False,
                },
            ],
        },
    )
    monkeypatch.setattr(
        ilu_gallery.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail(
            "inspect CLI should not run for published gallery repos"
        ),
    )

    manifest = ilu_gallery._run_ilu_gallery_generate(
        ilu_gallery.IluGallerySource(owner="google-deepmind", repo="mujoco_menagerie"),
        tmp_path / "gallery-job",
    )

    assert [item["candidatePath"] for item in manifest["items"]] == [
        "google_barkour_v0/barkour_v0.urdf",
        "google_barkour_vb/barkour_vb_rev_1_0_head_straight.urdf",
    ]
    assert manifest["items"][1]["thumbnailUrl"].endswith(
        "/thumbnails/google-deepmind/mujoco_menagerie/barkour_vb_rev_1_0_head_straight--1wgqhct.png"
    )


def test_run_ilu_gallery_publish_build_adds_repo_shards_to_pr_draft(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    fake_cli_path = tmp_path / "cli.js"
    fake_cli_path.write_text("// test cli", encoding="utf-8")
    record = ilu_gallery._GalleryJobRecord(
        job_id="job-123",
        status="completed",
        phase="generate",
        source=ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
        ),
        repo_metadata=ilu_gallery.IluGalleryRepoMetadata(),
        published_repo=None,
        items=[],
        error=None,
        output_root=str(tmp_path),
        created_at=ilu_gallery._utc_now(),
        updated_at=ilu_gallery._utc_now(),
    )

    monkeypatch.setattr(ilu_gallery, "_resolve_ilu_cli_path", lambda: fake_cli_path)
    monkeypatch.setattr(
        ilu_gallery.subprocess,
        "run",
        lambda *args, **kwargs: CompletedProcess(
            args=args,
            returncode=0,
            stdout=json.dumps(
                {
                    "title": f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
                    "body": "Generated via ILU gallery publish draft",
                    "branchName": "gallery-import/test",
                    "repoSlug": "urdf-studio/urdf-robot-gallery",
                    "files": [
                        {
                            "path": "docs/robots.json",
                            "content": json.dumps(
                                [
                                    {
                                        "repoKey": REAL_GALLERY_REPO_KEY,
                                        "repo": REAL_GALLERY_REPO_URL,
                                    },
                                    {
                                        "repoKey": REAL_OTHER_REPO_KEY,
                                        "repo": REAL_OTHER_REPO_URL,
                                    },
                                ]
                            ),
                        },
                        {
                            "path": "docs/previews.json",
                            "content": json.dumps(
                                {
                                    "previews": [
                                        {
                                            "repoKey": REAL_OTHER_REPO_KEY,
                                            "fileBase": REAL_OTHER_FILE_BASE,
                                            "png": REAL_OTHER_PNG_PATH,
                                        },
                                        {
                                            "repoKey": REAL_GALLERY_REPO_KEY,
                                            "fileBase": REAL_BARKOUR_FILE_BASE,
                                            "png": REAL_BARKOUR_PNG_PATH,
                                        },
                                    ]
                                }
                            ),
                        },
                        {
                            "path": f"docs/{REAL_BARKOUR_PNG_PATH}",
                            "content": "cG5nLWJ5dGVz",
                            "encoding": "base64",
                            "mediaType": "image/png",
                        },
                    ],
                }
            ),
            stderr="",
        ),
    )

    draft = ilu_gallery._run_ilu_gallery_publish_build(record, tmp_path)

    assert [draft_file.path for draft_file in draft.files] == [
        "docs/robots.json",
        "docs/previews.json",
        f"docs/{REAL_BARKOUR_PNG_PATH}",
        f"docs/repos/{REAL_GALLERY_REPO_KEY}.json",
        f"docs/previews-by-repo/{REAL_GALLERY_REPO_KEY}.json",
    ]
    assert json.loads(draft.files[3].content) == [
        {"repoKey": REAL_GALLERY_REPO_KEY, "repo": REAL_GALLERY_REPO_URL}
    ]
    assert json.loads(draft.files[4].content) == {
        "previews": [
            {
                "repoKey": REAL_GALLERY_REPO_KEY,
                "fileBase": REAL_BARKOUR_FILE_BASE,
                "png": REAL_BARKOUR_PNG_PATH,
            }
        ]
    }


def test_build_gallery_job_bundle_and_pr_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        thumbnail_path = output_root / "robots" / "robot" / "thumbnail.png"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"png-bytes")
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": "robot.urdf",
                    "displayName": "robot",
                    "fileBase": "robot--9tgkfi",
                    "sourceFile": "robot.urdf",
                    "status": "generated",
                    "thumbnailPath": str(thumbnail_path),
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda record, output_root: ilu_gallery.IluGalleryPrDraftResponse(
            title=f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
            body="Generated via ILU gallery publish draft",
            branchName="gallery-import/test",
            repoSlug="urdf-studio/urdf-robot-gallery",
            files=[
                IluGalleryPrDraftFile(
                    path=f"imports/{REAL_GALLERY_REPO_KEY}/{record.job_id}.json",
                    content="{}",
                )
            ],
        ),
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    bundle_bytes, file_name = ilu_gallery.build_gallery_job_bundle(response.job_id)
    draft = ilu_gallery.build_gallery_job_pr_draft(response.job_id)

    assert file_name == f"ilu-gallery-{response.job_id}.zip"
    with zipfile.ZipFile(BytesIO(bundle_bytes)) as archive:
        payload = json.loads(archive.read("gallery-job.json").decode("utf-8"))
        assert archive.read("robots/robot/thumbnail.png") == b"png-bytes"
    assert payload["status"] == "completed"
    assert draft.repo_slug == "urdf-studio/urdf-robot-gallery"
    assert (
        draft.files[0].path == f"imports/{REAL_GALLERY_REPO_KEY}/{response.job_id}.json"
    )
    thumb_bytes, media_type = ilu_gallery.read_gallery_thumbnail_file(
        response.job_id, "robot.urdf"
    )
    assert thumb_bytes == b"png-bytes"
    assert media_type == "image/png"


def test_resolve_gallery_robot_traits_uses_archive_snapshot_for_urdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = ilu_gallery.IluGallerySource(
        owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO, branch="main"
    )
    monkeypatch.setattr(
        ilu_gallery,
        "analyze_robot_morphology",
        lambda urdf_xml: type(
            "Morphology",
            (),
            {
                "primary_family": "object-like",
                "families": ("object-like",),
                "link_count": 1,
                "joint_count": 0,
                "controllable_joint_count": 0,
                "dof_count": 0,
                "arm_count": 0,
                "leg_count": 0,
                "wheel_count": 0,
            },
        )(),
    )

    traits = ilu_gallery._resolve_gallery_robot_traits(
        source,
        REAL_BARKOUR_PATH,
        "urdf",
        {
            REAL_BARKOUR_PATH: b"<robot name='barkour_v0'><link name='base_link'/></robot>"
        },
    )

    assert traits is not None
    assert traits.primary_family == "object-like"
    assert traits.link_count == 1


def test_resolve_gallery_robot_traits_expands_xacro_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = ilu_gallery.IluGallerySource(
        owner=REAL_XACRO_OWNER, repo=REAL_XACRO_REPO, branch=REAL_XACRO_BRANCH
    )

    monkeypatch.setattr(
        ilu_gallery,
        "expand_github_xacro",
        lambda request: (
            "<robot name='mobile'><link name='base_link'/><link name='wheel_link'/><joint name='wheel_joint' type='continuous'><parent link='base_link'/><child link='wheel_link'/></joint></robot>",
            None,
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "analyze_robot_morphology",
        lambda urdf_xml: type(
            "Morphology",
            (),
            {
                "primary_family": "wheeled",
                "families": ("wheeled",),
                "link_count": 2,
                "joint_count": 1,
                "controllable_joint_count": 1,
                "dof_count": 1,
                "arm_count": 0,
                "leg_count": 0,
                "wheel_count": 1,
            },
        )(),
    )

    traits = ilu_gallery._resolve_gallery_robot_traits(
        source,
        REAL_XACRO_PATH,
        "xacro-source",
        None,
    )

    assert traits is not None
    assert traits.primary_family == "wheeled"
    assert traits.wheel_count == 1
    assert traits.dof_count == 1


def test_build_gallery_manifest_from_inspection_skips_archive_snapshot_for_xacro_only_repos(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_repo_file_bytes_by_path",
        lambda source: pytest.fail(
            "archive snapshot should not load for xacro-only repos"
        ),
    )

    trait_resolution_attempts: list[tuple[str, str]] = []
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_robot_traits",
        lambda source, candidate_path, inspection_mode, repo_file_bytes_by_path=None: (
            trait_resolution_attempts.append((candidate_path, inspection_mode)) or None
        ),
    )
    output_root = tmp_path / "output"
    output_root.mkdir(parents=True, exist_ok=True)

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        ilu_gallery.IluGallerySource(
            owner=REAL_XACRO_OWNER, repo=REAL_XACRO_REPO, branch=REAL_XACRO_BRANCH
        ),
        output_root,
        {
            "repoMetadata": {},
            "candidates": [
                {
                    "path": REAL_XACRO_PATH,
                    "displayName": "Panda",
                    "fileBase": REAL_XACRO_FILE_BASE,
                    "sourceFile": REAL_XACRO_FILE,
                    "inspectionMode": "xacro-source",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                }
            ],
        },
    )

    assert trait_resolution_attempts == []
    assert manifest["items"][0]["attentionNotes"] == ["repo not in gallery catalog"]


def test_build_gallery_manifest_from_inspection_skips_robot_trait_enrichment_by_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_repo_file_bytes_by_path",
        lambda source: pytest.fail(
            "gallery inspect should not preload repo archives when traits are disabled"
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_robot_traits",
        lambda source, candidate_path, inspection_mode, repo_file_bytes_by_path=None: (
            pytest.fail(
                "gallery inspect should not resolve robot traits when traits are disabled"
            )
        ),
    )

    output_root = tmp_path / "output"
    output_root.mkdir(parents=True, exist_ok=True)

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        ilu_gallery.IluGallerySource(
            owner="ROBOTIS-GIT", repo="turtlebot3", branch="main"
        ),
        output_root,
        {
            "repoMetadata": {},
            "candidates": [
                {
                    "path": "turtlebot3_description/urdf/turtlebot3_burger.urdf",
                    "displayName": "turtlebot3_burger",
                    "fileBase": "turtlebot3-burger",
                    "sourceFile": "turtlebot3_burger.urdf",
                    "inspectionMode": "urdf",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                },
                {
                    "path": "turtlebot3_description/urdf/turtlebot3_waffle.urdf.xacro",
                    "displayName": "turtlebot3_waffle",
                    "fileBase": "turtlebot3-waffle",
                    "sourceFile": "turtlebot3_waffle.urdf.xacro",
                    "inspectionMode": "xacro-source",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                },
            ],
        },
    )

    assert [item["candidatePath"] for item in manifest["items"]] == [
        "turtlebot3_description/urdf/turtlebot3_burger.urdf",
        "turtlebot3_description/urdf/turtlebot3_waffle.urdf.xacro",
    ]
    assert [item["robotTraits"] for item in manifest["items"]] == [None, None]


def test_publish_gallery_job_creates_or_reuses_pull_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    output_root = tmp_path / "gallery-output"
    output_root.mkdir(parents=True, exist_ok=True)
    record = ilu_gallery._GalleryJobRecord(
        job_id="job-123",
        status="completed",
        phase="generate",
        source=ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER,
            repo=REAL_GALLERY_REPO,
            path="google_barkour_v0",
            branch="main",
        ),
        repo_metadata=ilu_gallery.IluGalleryRepoMetadata(org="Google DeepMind"),
        published_repo=None,
        items=[
            ilu_gallery.IluGalleryEntry(
                id=REAL_BARKOUR_PATH,
                title="Barkour V0",
                summary="generated",
                owner=REAL_GALLERY_OWNER,
                repo=REAL_GALLERY_REPO,
                path="google_barkour_v0",
                branch="main",
                urdf_path=REAL_BARKOUR_PATH,
            )
        ],
        error=None,
        output_root=str(output_root),
        created_at=ilu_gallery._utc_now(),
        updated_at=ilu_gallery._utc_now(),
    )
    monkeypatch.setitem(ilu_gallery._gallery_jobs, "job-123", record)
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda _record, _output_root: ilu_gallery.IluGalleryPrDraftResponse(
            title=f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
            body="Generated via ILU gallery publish draft",
            branch_name="gallery-import/test",
            repo_slug="urdf-studio/urdf-robot-gallery",
            files=[
                {"path": "docs/robots.json", "content": "{}\n"},
                {
                    "path": "media/demo.png",
                    "content": "cG5n",
                    "encoding": "base64",
                    "mediaType": "image/png",
                },
            ],
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "resolve_server_github_token",
        lambda explicit_token=None: "gho_test",
    )
    monkeypatch.setattr(
        ilu_gallery, "_github_get_repo_default_branch", lambda repo_slug, token: "main"
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_get_ref_sha",
        lambda repo_slug, ref, token: (
            None if ref == "heads/gallery-import/test" else "base-sha"
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_get_commit_tree_sha",
        lambda repo_slug, commit_sha, token: "tree-sha",
    )

    created_blobs: list[tuple[str, str]] = []
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_blob",
        lambda repo_slug, token, content, encoding: (
            created_blobs.append((content, encoding)) or f"blob-{len(created_blobs)}"
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_tree",
        lambda repo_slug, token, base_tree_sha, files: "new-tree-sha",
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_commit",
        lambda repo_slug, token, message, tree_sha, parent_sha: "commit-sha",
    )
    updated_refs: list[tuple[str, str]] = []
    monkeypatch.setattr(
        ilu_gallery,
        "_github_upsert_ref",
        lambda repo_slug, token, branch_name, commit_sha: updated_refs.append(
            (branch_name, commit_sha)
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_find_open_pull_request",
        lambda repo_slug, token, branch_name: None,
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_pull_request",
        lambda repo_slug, token, title, body, branch_name, base_branch: {
            "number": 42,
            "html_url": "https://github.com/urdf-studio/urdf-robot-gallery/pull/42",
        },
    )

    published = ilu_gallery.publish_gallery_job("job-123")

    assert published.pull_request_number == 42
    assert (
        published.pull_request_url
        == "https://github.com/urdf-studio/urdf-robot-gallery/pull/42"
    )
    assert published.files_changed == 2
    assert published.reused_existing_pull_request is False
    assert created_blobs == [("{}\n", "utf-8"), ("cG5n", "base64")]
    assert updated_refs == [("gallery-import/test", "commit-sha")]


def test_publish_gallery_job_reuses_existing_pull_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    output_root = tmp_path / "gallery-output"
    output_root.mkdir(parents=True, exist_ok=True)
    record = ilu_gallery._GalleryJobRecord(
        job_id="job-456",
        status="completed",
        phase="generate",
        source=ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
        ),
        repo_metadata=ilu_gallery.IluGalleryRepoMetadata(),
        published_repo=None,
        items=[],
        error=None,
        output_root=str(output_root),
        created_at=ilu_gallery._utc_now(),
        updated_at=ilu_gallery._utc_now(),
    )
    monkeypatch.setitem(ilu_gallery._gallery_jobs, "job-456", record)
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda _record, _output_root: ilu_gallery.IluGalleryPrDraftResponse(
            title=f"Refresh gallery metadata for {REAL_GALLERY_REPO_KEY}",
            body="Update metadata",
            branch_name="gallery-import/test",
            repo_slug="urdf-studio/urdf-robot-gallery",
            files=[{"path": "docs/robots.json", "content": "{}\n"}],
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "resolve_server_github_token",
        lambda explicit_token=None: "gho_test",
    )
    monkeypatch.setattr(
        ilu_gallery, "_github_get_repo_default_branch", lambda repo_slug, token: "main"
    )
    monkeypatch.setattr(
        ilu_gallery, "_github_get_ref_sha", lambda repo_slug, ref, token: "branch-sha"
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_get_commit_tree_sha",
        lambda repo_slug, commit_sha, token: "tree-sha",
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_blob",
        lambda repo_slug, token, content, encoding: "blob-1",
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_tree",
        lambda repo_slug, token, base_tree_sha, files: "new-tree-sha",
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_create_commit",
        lambda repo_slug, token, message, tree_sha, parent_sha: "commit-sha",
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_upsert_ref",
        lambda repo_slug, token, branch_name, commit_sha: None,
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_github_find_open_pull_request",
        lambda repo_slug, token, branch_name: {
            "number": 17,
            "html_url": "https://github.com/urdf-studio/urdf-robot-gallery/pull/17",
        },
    )

    published = ilu_gallery.publish_gallery_job("job-456")

    assert published.pull_request_number == 17
    assert published.reused_existing_pull_request is True


def test_generate_gallery_job_builds_binary_pr_payload(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    expected_file_base = REAL_BARKOUR_FILE_BASE

    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": expected_file_base,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    captured_asset_kinds: list[str] = []

    def _fake_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        nonlocal captured_asset_kinds
        captured_asset_kinds = list(asset_kinds)
        thumbnail_path = output_root / "generated" / f"{expected_file_base}.png"
        video_path = output_root / "generated" / f"{expected_file_base}.webm"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"png-bytes")
        video_path.write_bytes(b"webm-bytes")
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": str(thumbnail_path),
                    "videoPath": str(video_path),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_asset_generation
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda record, output_root: ilu_gallery.IluGalleryPrDraftResponse(
            title=f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
            body="Generated via ILU gallery publish draft",
            branchName="gallery-import/test",
            repoSlug="urdf-studio/urdf-robot-gallery",
            files=[
                IluGalleryPrDraftFile(path="docs/robots.json", content="[]"),
                IluGalleryPrDraftFile(path="docs/previews.json", content="{}"),
                IluGalleryPrDraftFile(
                    path=f"docs/thumbnails/{REAL_GALLERY_REPO_KEY}/{expected_file_base}.png",
                    content="cG5nLWJ5dGVz",
                    encoding="base64",
                    mediaType="image/png",
                ),
                IluGalleryPrDraftFile(
                    path=f"docs/previews/{REAL_GALLERY_REPO_KEY}/{expected_file_base}.webm",
                    content="d2VibS1ieXRlcw==",
                    encoding="base64",
                    mediaType="video/webm",
                ),
            ],
        ),
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="selected", itemIds=[REAL_BARKOUR_PATH]),
    )
    draft = ilu_gallery.build_gallery_job_pr_draft(response.job_id)
    video_bytes, video_media_type = ilu_gallery.read_gallery_job_asset_file(
        response.job_id,
        REAL_BARKOUR_PATH,
        ilu_gallery.GALLERY_ASSET_KIND_VIDEO,
    )

    assert generated.phase == "generate"
    assert generated.status == "completed"
    assert captured_asset_kinds == ["image", "video"]
    assert generated.items[0].thumbnail_url == (
        f"/ilu/gallery/jobs/{response.job_id}/asset?item_id=google_barkour_v0%2Fbarkour_v0.urdf&kind=thumbnail"
    )
    assert generated.items[0].video_url == (
        f"/ilu/gallery/jobs/{response.job_id}/asset?item_id=google_barkour_v0%2Fbarkour_v0.urdf&kind=video"
    )
    assert [file.path for file in draft.files] == [
        "docs/robots.json",
        "docs/previews.json",
        f"docs/thumbnails/{REAL_GALLERY_REPO_KEY}/{expected_file_base}.png",
        f"docs/previews/{REAL_GALLERY_REPO_KEY}/{expected_file_base}.webm",
    ]
    assert draft.files[2].encoding == "base64"
    assert video_bytes == b"webm-bytes"
    assert video_media_type == "video/webm"


def test_run_gallery_generation_job_uses_global_generation_semaphore(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    class _FakeGenerationSemaphore:
        def __enter__(self):
            events.append("enter")
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            events.append("exit")
            return False

    def _fake_execute(job_id: str, request: IluGalleryJobGenerateRequest) -> None:
        events.append(f"execute:{job_id}:{request.mode}")

    monkeypatch.setattr(ilu_gallery, "_gallery_generation_semaphore", _FakeGenerationSemaphore())
    monkeypatch.setattr(ilu_gallery, "_execute_gallery_generation_job", _fake_execute)

    ilu_gallery._run_gallery_generation_job(
        "job-throttle",
        IluGalleryJobGenerateRequest(mode="selected", itemIds=[REAL_BARKOUR_PATH]),
    )

    assert events == ["enter", "execute:job-throttle:selected", "exit"]


def test_generate_gallery_job_reports_generation_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate_paths = [REAL_BARKOUR_PATH, REAL_BARKOUR_VB_PATH]
    generated_asset_kinds = [
        ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE,
        ilu_gallery.GALLERY_GENERATE_ASSET_KIND_VIDEO,
    ]
    expected_progress_total = len(candidate_paths) * len(generated_asset_kinds)
    progress_snapshots: list[tuple[int, int, int, str | None, int | None]] = []
    response_job_id = ""

    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_path,
                    "displayName": candidate_path.rsplit("/", 1)[-1],
                    "fileBase": candidate_path.rsplit("/", 1)[-1].removesuffix(".urdf"),
                    "sourceFile": candidate_path.rsplit("/", 1)[-1],
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
                for candidate_path in candidate_paths
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    def _fake_asset_generation(
        source,
        output_root: pathlib.Path,
        selected_candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        assert asset_kinds == generated_asset_kinds
        generated_items = []
        progress = ilu_gallery.get_gallery_job(response_job_id).progress
        assert progress is not None
        progress_snapshots.append(
            (
                progress.completed,
                progress.total,
                progress.percent,
                progress.current_stage,
                progress.current_step,
            )
        )
        for candidate_path in selected_candidate_paths:
            file_base = candidate_path.rsplit("/", 1)[-1].removesuffix(".urdf")
            thumbnail_path = output_root / "generated" / f"{file_base}.png"
            video_path = output_root / "generated" / f"{file_base}.webm"
            thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
            thumbnail_path.write_bytes(b"png-bytes")
            video_path.write_bytes(b"webm-bytes")
            generated_items.append(
                {
                    "candidatePath": candidate_path,
                    "thumbnailPath": str(thumbnail_path),
                    "videoPath": str(video_path),
                }
            )
            for asset_kind in asset_kinds:
                if on_render_step_started is not None:
                    on_render_step_started([candidate_path], [asset_kind])
                    progress = ilu_gallery.get_gallery_job(response_job_id).progress
                    assert progress is not None
                    progress_snapshots.append(
                        (
                            progress.completed,
                            progress.total,
                            progress.percent,
                            progress.current_stage,
                            progress.current_step,
                        )
                    )
                if on_candidate_generated is not None:
                    on_candidate_generated(
                        candidate_path, ilu_gallery.GALLERY_PROGRESS_FIRST_STEP
                    )
                progress = ilu_gallery.get_gallery_job(response_job_id).progress
                assert progress is not None
                progress_snapshots.append(
                    (
                        progress.completed,
                        progress.total,
                        progress.percent,
                        progress.current_stage,
                        progress.current_step,
                    )
                )
        return {
            "outputRoot": str(output_root),
            "items": generated_items,
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    response_job_id = response.job_id
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert progress_snapshots == [
        (
            0,
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_STARTED_PERCENT,
            ilu_gallery.GALLERY_PROGRESS_STAGE_PREPARING,
            None,
        ),
        (
            0,
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_STARTED_PERCENT,
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
        ),
        (
            ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
        ),
        (
            ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            len(generated_asset_kinds),
        ),
        (
            len(generated_asset_kinds),
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // len(candidate_paths),
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            len(generated_asset_kinds),
        ),
        (
            len(generated_asset_kinds),
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // len(candidate_paths),
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            len(generated_asset_kinds) + ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
        ),
        (
            len(generated_asset_kinds) + ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
            expected_progress_total,
            (ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // len(candidate_paths))
            + (
                ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // expected_progress_total
            ),
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            len(generated_asset_kinds) + ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
        ),
        (
            len(generated_asset_kinds) + ilu_gallery.GALLERY_PROGRESS_FIRST_STEP,
            expected_progress_total,
            (ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // len(candidate_paths))
            + (
                ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT // expected_progress_total
            ),
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            expected_progress_total,
        ),
        (
            expected_progress_total,
            expected_progress_total,
            ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT,
            ilu_gallery.GALLERY_PROGRESS_STAGE_RENDERING,
            expected_progress_total,
        ),
    ]
    assert generated.progress is not None
    assert generated.progress.completed == expected_progress_total
    assert generated.progress.total == expected_progress_total
    assert generated.progress.percent == ilu_gallery.GALLERY_PROGRESS_COMPLETE_PERCENT


def test_merge_generated_manifest_preserves_existing_assets_when_regeneration_is_empty(
    tmp_path: pathlib.Path,
) -> None:
    source = ilu_gallery.IluGallerySource(
        owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
    )
    current_manifest = {
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "fileBase": REAL_BARKOUR_FILE_BASE,
                "thumbnailPath": "",
                "thumbnailUrl": "https://gallery.example/demo.png",
                "previewUrl": "https://gallery.example/demo.webp",
                "videoPath": "",
                "videoUrl": "https://gallery.example/demo.webm",
                "galleryPngPath": REAL_BARKOUR_PNG_PATH,
                "galleryWebmPath": REAL_BARKOUR_WEBM_PATH,
            },
        ],
    }
    generated_manifest = {
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "thumbnailPath": "",
                "videoPath": "",
            },
        ],
    }

    merged = ilu_gallery._merge_generated_manifest(
        source,
        tmp_path,
        current_manifest,
        generated_manifest,
        [
            ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE,
            ilu_gallery.GALLERY_GENERATE_ASSET_KIND_VIDEO,
        ],
    )

    merged_item = merged["items"][0]
    assert merged_item["thumbnailUrl"] == "https://gallery.example/demo.png"
    assert merged_item["previewUrl"] == "https://gallery.example/demo.webp"
    assert merged_item["videoUrl"] == "https://gallery.example/demo.webm"
    assert merged_item["galleryPngPath"] == REAL_BARKOUR_PNG_PATH
    assert merged_item["galleryWebmPath"] == REAL_BARKOUR_WEBM_PATH


def test_generate_gallery_job_fails_when_renderer_outputs_no_assets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    def _fake_empty_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        if on_candidate_generated is not None:
            on_candidate_generated(candidate_paths[0], 0)
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": str(output_root / "missing-thumbnail.png"),
                    "videoPath": str(output_root / "missing-video.webm"),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_empty_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert generated.status == "failed"
    assert generated.error == (
        "Gallery generation did not produce any new local assets. Existing gallery assets were preserved."
    )
    assert generated.progress is not None
    assert generated.progress.completed == 0
    assert generated.progress.total == len(
        [
            ilu_gallery.GALLERY_GENERATE_ASSET_KIND_IMAGE,
            ilu_gallery.GALLERY_GENERATE_ASSET_KIND_VIDEO,
        ]
    )


def test_generate_gallery_job_can_retry_after_generation_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    asset_generation_attempts = 0

    def _flaky_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        nonlocal asset_generation_attempts
        asset_generation_attempts += 1
        if asset_generation_attempts == 1:
            return {
                "outputRoot": str(output_root),
                "items": [
                    {
                        "candidatePath": candidate_paths[0],
                        "thumbnailPath": str(output_root / "missing-thumbnail.png"),
                        "videoPath": str(output_root / "missing-video.webm"),
                    }
                ],
            }

        thumbnail_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.png"
        video_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.webm"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"png-bytes")
        video_path.write_bytes(b"webm-bytes")
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": str(thumbnail_path),
                    "videoPath": str(video_path),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _flaky_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    failed = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )
    retried = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert failed.status == "failed"
    assert retried.status == "completed"
    assert asset_generation_attempts == 2
    assert retried.items[0].thumbnail_url == (
        f"/ilu/gallery/jobs/{response.job_id}/asset?item_id=google_barkour_v0%2Fbarkour_v0.urdf&kind=thumbnail"
    )


def test_generate_gallery_job_can_refresh_only_video(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "image ready, video ready | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/thumbnails/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.png",
                    "previewUrl": f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webp",
                    "videoUrl": f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webm",
                    "galleryRepoKey": REAL_GALLERY_REPO_KEY,
                    "galleryFileBase": REAL_BARKOUR_FILE_BASE,
                    "galleryPngPath": f"thumbnails/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.png",
                    "galleryWebmPath": f"previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webm",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    captured_asset_kinds: list[str] = []

    def _fake_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        nonlocal captured_asset_kinds
        captured_asset_kinds = list(asset_kinds)
        video_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.webm"
        video_path.parent.mkdir(parents=True, exist_ok=True)
        video_path.write_bytes(b"new-webm-bytes")
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": "",
                    "videoPath": str(video_path),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_asset_generation
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_publish_build",
        lambda record, output_root: ilu_gallery.IluGalleryPrDraftResponse(
            title=f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
            body="Generated via ILU gallery publish draft",
            branchName="gallery-import/test",
            repoSlug="urdf-studio/urdf-robot-gallery",
            files=[
                IluGalleryPrDraftFile(path="docs/robots.json", content="[]"),
                IluGalleryPrDraftFile(path="docs/previews.json", content="{}"),
                IluGalleryPrDraftFile(
                    path=f"docs/previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webm",
                    content="bmV3LXdlYm0tYnl0ZXM=",
                    encoding="base64",
                    mediaType="video/webm",
                ),
            ],
        ),
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(
            mode="selected", itemIds=[REAL_BARKOUR_PATH], assetKinds=["video"]
        ),
    )
    draft = ilu_gallery.build_gallery_job_pr_draft(response.job_id)

    assert captured_asset_kinds == ["video"]
    assert generated.items[0].thumbnail_url == (
        f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/thumbnails/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.png"
    )
    assert generated.items[0].video_url == (
        f"/ilu/gallery/jobs/{response.job_id}/asset?item_id=google_barkour_v0%2Fbarkour_v0.urdf&kind=video"
    )
    assert [file.path for file in draft.files] == [
        "docs/robots.json",
        "docs/previews.json",
        f"docs/previews/{REAL_GALLERY_REPO_KEY}/{REAL_BARKOUR_FILE_BASE}.webm",
    ]


def test_generate_gallery_job_retries_after_missing_github_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inspect_call_count = 0
    asset_call_count = 0

    def _fake_gallery_generate(source, output_root: pathlib.Path):
        nonlocal inspect_call_count
        inspect_call_count += 1
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    def _fake_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        nonlocal asset_call_count
        asset_call_count += 1
        if asset_call_count == 1:
            raise RuntimeError(
                "page.waitForFunction: Error: Unable to find the requested URDF target in the GitHub repository."
            )
        thumbnail_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.png"
        video_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.webm"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"png-bytes")
        video_path.write_bytes(b"webm-bytes")
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": str(thumbnail_path),
                    "videoPath": str(video_path),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert inspect_call_count == 3
    assert asset_call_count == 2
    assert generated.status == "completed"
    assert generated.phase == "generate"
    assert generated.items[0].thumbnail_url == (
        f"/ilu/gallery/jobs/{response.job_id}/asset?item_id=google_barkour_v0%2Fbarkour_v0.urdf&kind=thumbnail"
    )


def test_generate_gallery_job_surfaces_sane_error_after_live_repo_refresh_misses_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_gallery_generate(source, output_root: pathlib.Path):
        output_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "thumbnailPath": "",
                    "thumbnailUrl": "",
                    "previewUrl": "",
                    "videoUrl": "",
                }
            ],
        }
        (output_root / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return manifest

    def _always_fail_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        raise RuntimeError(
            "page.waitForFunction: Error: Unable to find the requested URDF target in the GitHub repository."
        )

    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_ilu_gallery_generate_from_repo", _fake_gallery_generate
    )
    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _always_fail_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert generated.status == "failed"
    assert generated.error == (
        f"The live GitHub source {REAL_GALLERY_REPO_URL} "
        "does not expose a loadable URDF/Xacro target for gallery rendering. "
        "This source may only contain MuJoCo MJCF/XML assets or other non-URDF files."
    )


def test_generate_gallery_job_refreshes_from_live_repo_before_render(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale_manifest = {
        "outputRoot": "/tmp/gallery-job",
        "items": [
            {
                "candidatePath": REAL_BARKOUR_VB_PATH,
                "displayName": "Barkour VB",
                "fileBase": REAL_BARKOUR_VB_FILE_BASE,
                "sourceFile": REAL_BARKOUR_VB_FILE,
                "status": "image missing, video missing | urdf, renderable",
                "thumbnailPath": "",
                "thumbnailUrl": "",
                "previewUrl": "",
                "videoUrl": "",
            }
        ],
    }
    live_manifest = {
        "outputRoot": "/tmp/gallery-job",
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "displayName": "Barkour V0",
                "fileBase": REAL_BARKOUR_FILE_BASE,
                "sourceFile": REAL_BARKOUR_FILE,
                "status": "repo not in gallery catalog | urdf, renderable",
                "thumbnailPath": "",
                "thumbnailUrl": "",
                "previewUrl": "",
                "videoUrl": "",
            }
        ],
    }
    captured_candidate_paths: list[str] = []

    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_generate",
        lambda source, output_root: stale_manifest,
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_generate_from_repo",
        lambda source, output_root: live_manifest,
    )

    def _fake_asset_generation(
        source,
        output_root: pathlib.Path,
        candidate_paths: list[str],
        asset_kinds: list[str],
        on_candidate_generated=None,
        on_render_step_started=None,
    ):
        nonlocal captured_candidate_paths
        captured_candidate_paths = list(candidate_paths)
        thumbnail_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.png"
        video_path = output_root / "generated" / f"{REAL_BARKOUR_FILE_BASE}.webm"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"png-bytes")
        video_path.write_bytes(b"webm-bytes")
        return {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": candidate_paths[0],
                    "thumbnailPath": str(thumbnail_path),
                    "videoPath": str(video_path),
                }
            ],
        }

    monkeypatch.setattr(
        ilu_gallery, "_run_gallery_asset_generation", _fake_asset_generation
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    generated = ilu_gallery.generate_gallery_job(
        response.job_id,
        IluGalleryJobGenerateRequest(mode="repo"),
    )

    assert captured_candidate_paths == [REAL_BARKOUR_PATH]
    assert generated.items[0].urdf_path == REAL_BARKOUR_PATH


def test_merge_generated_manifest_image_only_does_not_stamp_missing_video_paths(
    tmp_path: pathlib.Path,
) -> None:
    output_root = tmp_path / "output"
    output_root.mkdir(parents=True, exist_ok=True)
    current_manifest = {
        "outputRoot": str(output_root),
        "repoMetadata": {"org": "Google DeepMind"},
        "catalogSnapshot": {"repoEntries": [], "previewEntries": []},
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "status": "repo not in gallery catalog | urdf, renderable",
                "thumbnailPath": "",
                "thumbnailUrl": "",
                "previewUrl": "",
                "videoPath": "",
                "videoUrl": "",
                "galleryRepoKey": "",
                "galleryFileBase": REAL_BARKOUR_FILE_BASE,
                "galleryPngPath": "",
                "galleryWebmPath": "",
            }
        ],
    }
    generated_manifest = {
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "thumbnailPath": str(output_root / f"{REAL_BARKOUR_FILE_BASE}.png"),
            }
        ]
    }

    merged_manifest = ilu_gallery._merge_generated_manifest(
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        output_root,
        current_manifest,
        generated_manifest,
        ["image"],
    )

    assert merged_manifest["items"][0]["galleryPngPath"] == REAL_BARKOUR_PNG_PATH
    assert merged_manifest["items"][0]["galleryWebmPath"] == ""


def test_map_gallery_items_does_not_treat_review_url_as_preview() -> None:
    items, output_root = ilu_gallery._map_gallery_items(
        "job-123",
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        {
            "outputRoot": "/tmp/gallery",
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "status": "repo not in gallery catalog | urdf, renderable",
                    "sourceFile": REAL_BARKOUR_FILE,
                }
            ],
        },
    )

    assert output_root == "/tmp/gallery"
    assert items[0].preview_url is None


def test_map_gallery_items_rehydrates_catalog_snapshot_metadata_for_stale_manifest_items() -> (
    None
):
    items, output_root = ilu_gallery._map_gallery_items(
        "job-123",
        ilu_gallery.IluGallerySource(owner="TheRobotStudio", repo="SO-ARM100"),
        {
            "outputRoot": "/tmp/gallery",
            "catalogSnapshot": {
                "repoEntries": [
                    {
                        "repoKey": "therobotstudio/so-arm100",
                        "robots": [
                            {
                                "name": "SO-ARM100",
                                "file": "so100.urdf",
                                "fileBase": "so100--vyv9ty",
                            }
                        ],
                    }
                ],
                "previewEntries": [
                    {
                        "repoKey": "therobotstudio/so-arm100",
                        "fileBase": "so100--vyv9ty",
                        "meshCount": 13,
                        "linkCount": 7,
                        "jointCount": 6,
                        "armCount": 1,
                        "legCount": 0,
                        "wheelCount": 0,
                        "tags": [
                            "meshes:13",
                            "links:7",
                            "joints:6",
                            "arms:1",
                            "legs:0",
                            "wheels:0",
                            "source:urdf",
                        ],
                        "png": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                        "webp": "previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
                    }
                ],
            },
            "items": [
                {
                    "candidatePath": "Simulation/SO100/so100.urdf",
                    "status": "image ready, animated preview ready | urdf, renderable",
                    "thumbnailUrl": "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                    "previewUrl": "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
                    "galleryRepoKey": "therobotstudio/so-arm100",
                    "galleryFileBase": "so100--vyv9ty",
                    "galleryRobotName": "SO-ARM100",
                    "sourceFile": "so100.urdf",
                    "sourcePath": "Simulation/SO100/so100.urdf",
                    "galleryPngPath": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                    "attentionNotes": [],
                    "robotTraits": None,
                }
            ],
        },
    )

    assert output_root == "/tmp/gallery"
    assert items[0].mesh_count == 13
    assert items[0].link_count == 7
    assert items[0].joint_count == 6
    assert items[0].arm_count == 1
    assert items[0].leg_count == 0
    assert items[0].wheel_count == 0
    assert items[0].tags == [
        "meshes:13",
        "links:7",
        "joints:6",
        "arms:1",
        "legs:0",
        "wheels:0",
        "source:urdf",
        "urdf",
    ]


def test_update_gallery_job_metadata_updates_titles_and_repo_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_run_ilu_gallery_generate",
        lambda source, output_root: {
            "outputRoot": str(output_root),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "status": "generated",
                    "thumbnailPath": "",
                }
            ],
        },
    )
    monkeypatch.setattr(ilu_gallery.threading.Thread, "start", lambda self: self.run())

    response = ilu_gallery.create_gallery_job(
        IluGalleryJobCreateRequest(
            source={"owner": REAL_GALLERY_OWNER, "repo": REAL_GALLERY_REPO}
        )
    )
    updated = ilu_gallery.update_gallery_job_metadata(
        response.job_id,
        {
            "repoMetadata": {
                "org": "Google DeepMind",
                "summary": "Barkour quadruped models",
                "demo": "",
                "tags": ["Arm", "Educational"],
                "license": "Apache-2.0",
                "authorWebsite": "https://deepmind.google",
                "authorX": "",
                "authorLinkedin": "",
                "authorGithub": REAL_GALLERY_OWNER,
                "contact": "",
                "extra": "",
            },
            "items": [{"id": REAL_BARKOUR_PATH, "title": "Barkour V0"}],
        },
    )

    assert updated.repo_metadata.org == "Google DeepMind"
    assert updated.repo_metadata.author_website == "https://deepmind.google"
    assert updated.items[0].title == "Barkour V0"


def test_merge_gallery_repo_metadata_prefers_gallery_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(
            repo_entries={
                "therobotstudio/so-arm100": [
                    {
                        "repoKey": "therobotstudio/so-arm100",
                        "org": "",
                        "summary": "Compact desktop arm.",
                        "demo": "",
                        "tags": [],
                        "license": "",
                        "authorWebsite": "",
                        "authorX": "",
                        "authorLinkedin": "",
                        "authorGithub": "",
                        "contact": "",
                        "extra": "",
                        "stars": 5585,
                        "ownerLogin": "TheRobotStudio",
                        "ownerAvatar": "https://avatars.example/owner.png",
                        "authorLogin": "TheRobotStudio",
                        "authorAvatar": "https://avatars.example/author.png",
                        "repoUpdatedAt": "2026-03-02T12:00:00Z",
                        "robots": [],
                    }
                ]
            },
            preview_entries={},
        ),
    )
    metadata = ilu_gallery._merge_gallery_repo_metadata(
        ilu_gallery.IluGallerySource(owner="TheRobotStudio", repo="SO-ARM100"),
        {
            "org": "The Robot Studio",
            "summary": "Ignored because gallery already has summary.",
            "demo": "https://example.com/demo",
            "tags": ["arm"],
            "license": "Apache-2.0",
            "authorWebsite": "https://therobotstudio.com",
            "authorX": "@therobotstudio",
            "authorLinkedin": "https://linkedin.com/company/therobotstudio",
            "authorGithub": "TheRobotStudio",
            "contact": "hello@therobotstudio.com",
            "extra": "",
        },
    )

    assert metadata.org == "The Robot Studio"
    assert metadata.summary == "Compact desktop arm."
    assert metadata.demo == "https://example.com/demo"
    assert metadata.license == "Apache-2.0"
    assert metadata.author_github == "TheRobotStudio"
    assert metadata.stars == 5585
    assert metadata.owner_login == "TheRobotStudio"
    assert metadata.author_avatar == "https://avatars.example/author.png"
    assert metadata.repo_updated_at == "2026-03-02T12:00:00Z"


def test_merge_gallery_repo_metadata_uses_inspection_defaults_for_new_repo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )
    metadata = ilu_gallery._merge_gallery_repo_metadata(
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        {
            "org": "Google DeepMind",
            "summary": "Barkour quadruped models",
            "demo": REAL_GALLERY_REPO_URL,
            "tags": ["robotics", "quadruped"],
            "license": "Apache-2.0",
            "authorWebsite": "https://deepmind.google",
            "authorX": "",
            "authorLinkedin": "",
            "authorGithub": REAL_GALLERY_OWNER,
            "contact": "",
            "extra": "",
        },
    )

    assert metadata.org == "Google DeepMind"
    assert metadata.summary == "Barkour quadruped models"
    assert metadata.demo == REAL_GALLERY_REPO_URL
    assert metadata.license == "Apache-2.0"
    assert metadata.author_website == "https://deepmind.google"
    assert metadata.author_github == REAL_GALLERY_OWNER
    assert metadata.contact == ""


def test_map_gallery_items_prefers_gallery_robot_name_and_source_file() -> None:
    items, output_root = ilu_gallery._map_gallery_items(
        "job-123",
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        {
            "outputRoot": "/tmp/gallery",
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "status": "image ready, video ready | urdf, renderable",
                    "sourceFile": REAL_BARKOUR_FILE,
                    "galleryRobotName": "Barkour V0",
                    "thumbnailUrl": "https://example.com/thumb.png",
                    "videoUrl": "https://example.com/preview.webm",
                }
            ],
        },
    )

    assert output_root == "/tmp/gallery"
    assert items[0].title == "Barkour V0"
    assert items[0].source_file == REAL_BARKOUR_FILE


def test_build_gallery_manifest_from_inspection_enriches_catalog_media(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_robot_traits",
        lambda source, candidate_path, inspection_mode, repo_file_bytes_by_path=None: (
            None
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(
            repo_entries={
                "therobotstudio/so-arm100": [
                    {
                        "repoKey": "therobotstudio/so-arm100",
                        "robots": [
                            {
                                "name": "SO-ARM100",
                                "file": "so100.urdf",
                                "fileBase": "so100--vyv9ty",
                            }
                        ],
                    }
                ]
            },
            preview_entries={
                "therobotstudio/so-arm100::so100--vyv9ty": {
                    "repoKey": "therobotstudio/so-arm100",
                    "fileBase": "so100--vyv9ty",
                    "png": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                    "webm": "previews/therobotstudio/so-arm100/so100--vyv9ty.webm",
                    "webp": "previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
                    "macroTags": ["Arm"],
                    "meshCount": 13,
                    "linkCount": 7,
                    "jointCount": 6,
                    "armCount": 1,
                    "legCount": 0,
                    "wheelCount": 0,
                }
            },
        ),
    )

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        ilu_gallery.IluGallerySource(owner="TheRobotStudio", repo="SO-ARM100"),
        tmp_path,
        {
            "repoMetadata": {
                "org": "The Robot Studio",
                "authorGithub": "TheRobotStudio",
            },
            "candidates": [
                {
                    "path": "robots/so100.urdf",
                    "inspectionMode": "urdf",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                }
            ],
        },
    )

    assert manifest["items"] == [
        {
            "candidatePath": "robots/so100.urdf",
            "status": "image ready, video ready | urdf, renderable",
            "thumbnailPath": "",
            "thumbnailUrl": "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
            "previewUrl": "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
            "videoUrl": "https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/previews/therobotstudio/so-arm100/so100--vyv9ty.webm",
            "galleryRepoKey": "therobotstudio/so-arm100",
            "galleryFileBase": "so100--vyv9ty",
            "galleryRobotName": "SO-ARM100",
            "sourceFile": "so100.urdf",
            "sourcePath": "robots/so100.urdf",
            "galleryPngPath": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
            "galleryWebmPath": "previews/therobotstudio/so-arm100/so100--vyv9ty.webm",
            "attentionNotes": [],
            "tags": [],
            "macroTags": ["Arm"],
            "meshCount": 13,
            "linkCount": 7,
            "jointCount": 6,
            "armCount": 1,
            "legCount": 0,
            "wheelCount": 0,
            "robotTraits": None,
        }
    ]
    assert manifest["repoMetadata"] == {
        "org": "The Robot Studio",
        "authorGithub": "TheRobotStudio",
    }
    assert manifest["catalogSnapshot"] == {
        "repoEntries": [
            {
                "repoKey": "therobotstudio/so-arm100",
                "robots": [
                    {
                        "name": "SO-ARM100",
                        "file": "so100.urdf",
                        "fileBase": "so100--vyv9ty",
                    }
                ],
            }
        ],
        "previewEntries": [
            {
                "repoKey": "therobotstudio/so-arm100",
                "fileBase": "so100--vyv9ty",
                "png": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                "webm": "previews/therobotstudio/so-arm100/so100--vyv9ty.webm",
                "webp": "previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
                "macroTags": ["Arm"],
                "meshCount": 13,
                "linkCount": 7,
                "jointCount": 6,
                "armCount": 1,
                "legCount": 0,
                "wheelCount": 0,
            }
        ],
    }


def test_build_gallery_manifest_from_inspection_falls_back_to_robot_metadata_when_preview_metadata_is_partial(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_robot_traits",
        lambda source, candidate_path, inspection_mode, repo_file_bytes_by_path=None: (
            None
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(
            repo_entries={
                "therobotstudio/so-arm100": [
                    {
                        "repoKey": "therobotstudio/so-arm100",
                        "robots": [
                            {
                                "name": "SO-ARM100",
                                "file": "so100.urdf",
                                "fileBase": "so100--vyv9ty",
                                "macroTags": ["Arm"],
                                "meshCount": 13,
                                "linkCount": 7,
                                "jointCount": 6,
                                "armCount": 1,
                                "legCount": 0,
                                "wheelCount": 0,
                            }
                        ],
                    }
                ]
            },
            preview_entries={
                "therobotstudio/so-arm100::so100--vyv9ty": {
                    "repoKey": "therobotstudio/so-arm100",
                    "fileBase": "so100--vyv9ty",
                    "png": "thumbnails/therobotstudio/so-arm100/so100--vyv9ty.png",
                    "webm": "previews/therobotstudio/so-arm100/so100--vyv9ty.webm",
                    "webp": "previews/therobotstudio/so-arm100/so100--vyv9ty.webp",
                }
            },
        ),
    )

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        ilu_gallery.IluGallerySource(owner="TheRobotStudio", repo="SO-ARM100"),
        tmp_path,
        {
            "repoMetadata": {},
            "candidates": [
                {
                    "path": "Simulation/SO100/so100.urdf",
                    "inspectionMode": "urdf",
                    "sourceFile": "so100.urdf",
                    "fileBase": "so100--vyv9ty",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                }
            ],
        },
    )

    assert manifest["items"][0]["macroTags"] == ["Arm"]
    assert manifest["items"][0]["meshCount"] == 13
    assert manifest["items"][0]["linkCount"] == 7
    assert manifest["items"][0]["jointCount"] == 6
    assert manifest["items"][0]["armCount"] == 1
    assert manifest["items"][0]["legCount"] == 0
    assert manifest["items"][0]["wheelCount"] == 0


def test_run_ilu_gallery_generate_uses_inspect_repo_cli(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    captured_args: list[str] = []
    fake_cli_path = tmp_path / "cli.js"
    fake_cli_path.write_text("// test cli", encoding="utf-8")

    def _fake_run(args, **kwargs):
        nonlocal captured_args
        captured_args = list(args)
        return CompletedProcess(
            args=args,
            returncode=0,
            stdout=json.dumps(
                {
                    "candidates": [
                        {
                            "path": REAL_BARKOUR_PATH,
                            "displayName": "Barkour V0",
                            "fileBase": REAL_BARKOUR_FILE_BASE,
                            "sourceFile": REAL_BARKOUR_FILE,
                            "inspectionMode": "urdf",
                            "hasRenderableGeometry": True,
                            "unresolvedMeshReferenceCount": 0,
                        }
                    ],
                    "repoMetadata": {
                        "org": "Google DeepMind",
                        "authorGithub": REAL_GALLERY_OWNER,
                    },
                }
            ),
            stderr="",
        )

    monkeypatch.setattr(ilu_gallery, "_resolve_ilu_cli_path", lambda: fake_cli_path)
    monkeypatch.setattr(
        ilu_gallery, "resolve_server_github_token", lambda: "ghs_test_token"
    )
    monkeypatch.setattr(
        ilu_gallery,
        "list_repo_candidates",
        lambda owner, repo, path="", branch=None: (_ for _ in ()).throw(
            ilu_gallery.GitHubPublicProxyError(
                status_code=502, detail="candidate summary unavailable"
            )
        ),
    )
    monkeypatch.setattr(ilu_gallery.subprocess, "run", _fake_run)
    monkeypatch.setattr(
        ilu_gallery,
        "_resolve_gallery_robot_traits",
        lambda source, candidate_path, inspection_mode, repo_file_bytes_by_path=None: (
            None
        ),
    )
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(repo_entries={}, preview_entries={}),
    )

    manifest = ilu_gallery._run_ilu_gallery_generate(
        ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER,
            repo=REAL_GALLERY_REPO,
            path="google_barkour_v0",
            branch="main",
        ),
        tmp_path / "output",
    )

    assert captured_args == [
        ilu_gallery.NODE_BIN,
        str(fake_cli_path),
        "inspect-repo",
        "--github",
        REAL_GALLERY_REPO_URL,
        "--ref",
        "main",
        "--path",
        "google_barkour_v0",
        "--token",
        "ghs_test_token",
    ]
    assert manifest["items"] == [
        {
            "candidatePath": REAL_BARKOUR_PATH,
            "status": "repo not in gallery catalog | urdf, renderable",
            "thumbnailPath": "",
            "thumbnailUrl": "",
            "previewUrl": "",
            "videoUrl": "",
            "galleryRepoKey": "",
            "galleryFileBase": REAL_BARKOUR_FILE_BASE,
            "galleryRobotName": "Barkour V0",
            "sourceFile": REAL_BARKOUR_FILE,
            "sourcePath": REAL_BARKOUR_PATH,
            "galleryPngPath": "",
            "galleryWebmPath": "",
            "attentionNotes": ["repo not in gallery catalog"],
            "tags": [],
            "macroTags": [],
            "meshCount": None,
            "linkCount": None,
            "jointCount": None,
            "armCount": None,
            "legCount": None,
            "wheelCount": None,
            "robotTraits": None,
        }
    ]
    assert manifest["catalogSnapshot"] == {"repoEntries": [], "previewEntries": []}
    assert (
        json.loads((tmp_path / "output" / "manifest.json").read_text(encoding="utf-8"))
        == manifest
    )


def test_merge_gallery_repo_metadata_uses_catalog_snapshot_selection_for_scoped_repo() -> (
    None
):
    catalog = ilu_gallery._catalog_from_snapshot(
        {
            "repoEntries": [
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "path": "",
                    "summary": "Root summary",
                },
                {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "path": "google_barkour_v0",
                    "summary": "Scoped summary",
                },
            ],
            "previewEntries": [],
        }
    )

    metadata = ilu_gallery._merge_gallery_repo_metadata(
        ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO, path="google_barkour_v0"
        ),
        {"summary": "Inspection summary"},
        catalog,
    )

    assert metadata.summary == "Scoped summary"


def test_build_gallery_manifest_from_inspection_supports_multiple_repo_entries_for_same_repo(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    monkeypatch.setattr(
        ilu_gallery,
        "_load_gallery_catalog",
        lambda: ilu_gallery._GalleryCatalog(
            repo_entries={
                REAL_GALLERY_REPO_KEY: [
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "path": "",
                        "robots": [
                            {
                                "name": "Root Arm",
                                "file": "root.urdf",
                                "fileBase": "root-file-base",
                            },
                        ],
                    },
                    {
                        "repoKey": REAL_GALLERY_REPO_KEY,
                        "path": "google_barkour_v0",
                        "robots": [
                            {
                                "name": "Barkour V0",
                                "file": REAL_BARKOUR_FILE,
                                "fileBase": REAL_BARKOUR_FILE_BASE,
                            },
                        ],
                    },
                ]
            },
            preview_entries={
                f"{REAL_GALLERY_REPO_KEY}::{REAL_BARKOUR_FILE_BASE}": {
                    "repoKey": REAL_GALLERY_REPO_KEY,
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "png": REAL_BARKOUR_PNG_PATH,
                    "webm": REAL_BARKOUR_WEBM_PATH,
                }
            },
        ),
    )

    manifest = ilu_gallery._build_gallery_manifest_from_inspection(
        ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO, path="google_barkour_v0"
        ),
        tmp_path,
        {
            "repoMetadata": {"summary": "Inspection summary"},
            "candidates": [
                {
                    "path": REAL_BARKOUR_PATH,
                    "displayName": "Barkour V0",
                    "fileBase": REAL_BARKOUR_FILE_BASE,
                    "sourceFile": REAL_BARKOUR_FILE,
                    "inspectionMode": "urdf",
                    "hasRenderableGeometry": True,
                    "unresolvedMeshReferenceCount": 0,
                }
            ],
        },
    )

    assert manifest["items"][0]["galleryRobotName"] == "Barkour V0"
    assert manifest["items"][0]["galleryFileBase"] == REAL_BARKOUR_FILE_BASE
    assert manifest["items"][0]["thumbnailUrl"] == (
        f"https://cdn.jsdelivr.net/gh/urdf-studio/urdf-robot-gallery@main/docs/{REAL_BARKOUR_PNG_PATH}"
    )


def test_run_gallery_asset_generation_uses_repo_local_playwright_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    captured_env = {}
    captured_args: list[str] = []
    fake_cli_path = tmp_path / "cli.js"
    fake_cli_path.write_text("// test cli", encoding="utf-8")
    browsers_path = tmp_path / ".cache" / "ms-playwright"
    browsers_path.mkdir(parents=True, exist_ok=True)

    def _fake_run(args, **kwargs):
        nonlocal captured_env
        nonlocal captured_args
        captured_args = list(args)
        captured_env = dict(kwargs.get("env") or {})
        manifest = {
            "outputRoot": str(tmp_path / "output"),
            "items": [
                {
                    "candidatePath": REAL_BARKOUR_PATH,
                    "thumbnailPath": "",
                    "videoPath": "",
                }
            ],
        }
        return CompletedProcess(
            args=args, returncode=0, stdout=json.dumps(manifest), stderr=""
        )

    @contextmanager
    def _fake_render_app_url():
        yield "http://127.0.0.1:43123"

    monkeypatch.setattr(ilu_gallery, "_resolve_ilu_cli_path", lambda: fake_cli_path)
    monkeypatch.setattr(ilu_gallery, "PLAYWRIGHT_BROWSERS_PATH", browsers_path)
    monkeypatch.setattr(
        ilu_gallery, "_resolve_gallery_render_app_url", _fake_render_app_url
    )
    monkeypatch.setattr(ilu_gallery.subprocess, "run", _fake_run)

    manifest = ilu_gallery._run_gallery_asset_generation(
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        tmp_path / "output",
        [REAL_BARKOUR_PATH],
        ["image"],
    )
    assert captured_args == [
        ilu_gallery.NODE_BIN,
        str(fake_cli_path),
        "gallery-render",
        "--app",
        "http://127.0.0.1:43123",
        "--out",
        str(tmp_path / "output"),
        "--github",
        REAL_GALLERY_REPO_URL,
        "--asset",
        "image",
        "--urdf",
        REAL_BARKOUR_PATH,
    ]
    assert manifest["items"][0]["candidatePath"] == REAL_BARKOUR_PATH
    assert captured_env["PLAYWRIGHT_BROWSERS_PATH"] == str(browsers_path)


def test_run_gallery_asset_generation_chunks_repeated_cli_values_for_progress(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    captured_args: list[list[str]] = []
    fake_cli_path = tmp_path / "cli.js"
    fake_cli_path.write_text("// test cli", encoding="utf-8")

    def _fake_run(args, **_kwargs):
        captured_args.append(list(args))
        candidate_paths = [
            args[index + 1] for index, value in enumerate(args) if value == "--urdf"
        ]
        asset_kinds = [
            args[index + 1] for index, value in enumerate(args) if value == "--asset"
        ]
        generated_dir = tmp_path / "generated"
        generated_dir.mkdir(exist_ok=True)
        for candidate_path in candidate_paths:
            file_base = pathlib.Path(candidate_path).stem
            if "image" in asset_kinds:
                (generated_dir / f"{file_base}.png").write_bytes(b"png")
            if "video" in asset_kinds:
                (generated_dir / f"{file_base}.webm").write_bytes(b"webm")
        manifest = {
            "outputRoot": str(tmp_path / "output"),
            "items": [
                {
                    "candidatePath": candidate_path,
                    "thumbnailPath": (
                        str(generated_dir / f"{pathlib.Path(candidate_path).stem}.png")
                        if "image" in asset_kinds
                        else ""
                    ),
                    "videoPath": (
                        str(generated_dir / f"{pathlib.Path(candidate_path).stem}.webm")
                        if "video" in asset_kinds
                        else ""
                    ),
                }
                for candidate_path in candidate_paths
            ],
        }
        return CompletedProcess(
            args=args, returncode=0, stdout=json.dumps(manifest), stderr=""
        )

    @contextmanager
    def _fake_render_app_url():
        yield "http://127.0.0.1:43123"

    monkeypatch.setattr(ilu_gallery, "_resolve_ilu_cli_path", lambda: fake_cli_path)
    monkeypatch.setattr(
        ilu_gallery, "_resolve_gallery_render_app_url", _fake_render_app_url
    )
    monkeypatch.setattr(ilu_gallery.subprocess, "run", _fake_run)
    started_steps: list[tuple[list[str], list[str]]] = []
    completed_counts: list[int] = []

    manifest = ilu_gallery._run_gallery_asset_generation(
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        tmp_path / "output",
        [REAL_BARKOUR_PATH, REAL_BARKOUR_VB_PATH],
        ["image", "video"],
        on_candidate_generated=lambda _candidate_path, generated_count: (
            completed_counts.append(generated_count)
        ),
        on_render_step_started=lambda candidate_paths, asset_kinds: (
            started_steps.append((candidate_paths, asset_kinds))
        ),
    )

    assert [item["candidatePath"] for item in manifest["items"]] == [
        REAL_BARKOUR_PATH,
        REAL_BARKOUR_VB_PATH,
    ]
    assert manifest["items"][0]["thumbnailPath"] == str(
        tmp_path / "generated" / f"{REAL_BARKOUR_FILE_BASE}.png"
    )
    assert manifest["items"][0]["videoPath"] == str(
        tmp_path / "generated" / f"{REAL_BARKOUR_FILE_BASE}.webm"
    )
    assert manifest["items"][1]["thumbnailPath"] == str(
        tmp_path / "generated" / f"{REAL_BARKOUR_VB_FILE_BASE}.png"
    )
    assert manifest["items"][1]["videoPath"] == str(
        tmp_path / "generated" / f"{REAL_BARKOUR_VB_FILE_BASE}.webm"
    )
    assert started_steps == [
        ([REAL_BARKOUR_PATH], ["image"]),
        ([REAL_BARKOUR_PATH], ["video"]),
        ([REAL_BARKOUR_VB_PATH], ["image"]),
        ([REAL_BARKOUR_VB_PATH], ["video"]),
    ]
    assert completed_counts == [1, 1, 1, 1]
    assert len(captured_args) == 4
    for args, expected_candidate_path, expected_asset_kind in zip(
        captured_args,
        [
            REAL_BARKOUR_PATH,
            REAL_BARKOUR_PATH,
            REAL_BARKOUR_VB_PATH,
            REAL_BARKOUR_VB_PATH,
        ],
        ["image", "video", "image", "video"],
        strict=True,
    ):
        asset_positions = [
            index for index, value in enumerate(args) if value == "--asset"
        ]
        assert args.count("--urdf") == 1
        assert args.count("--asset") == 1
        assert [args[index + 1] for index in asset_positions] == [expected_asset_kind]
        assert args[args.index("--urdf") + 1] == expected_candidate_path


def test_resolve_gallery_render_app_url_builds_fresh_preview_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    no_timeout_sentinel_seconds = 0
    captured_build_args: list[str] = []
    captured_build_env: dict[str, str] = {}
    captured_preview_args: list[str] = []
    captured_preview_env: dict[str, str] = {}
    waited: list[tuple[str, object]] = []

    class _FakePreviewProcess:
        def __init__(self) -> None:
            self.stdout = None
            self.terminated = False
            self.killed = False
            self.wait_calls: list[int] = []

        def poll(self) -> None:
            return None

        def terminate(self) -> None:
            self.terminated = True

        def kill(self) -> None:
            self.killed = True

        def wait(self, timeout: int | None = None) -> int:
            self.wait_calls.append(
                no_timeout_sentinel_seconds if timeout is None else timeout
            )
            return 0

    preview_process = _FakePreviewProcess()

    def _fake_run(args, **kwargs):
        captured_build_env.update(kwargs.get("env") or {})
        captured_build_args.extend(args)
        return CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    def _fake_popen(args, **kwargs):
        captured_preview_env.update(kwargs.get("env") or {})
        captured_preview_args.extend(args)
        return preview_process

    def _fake_wait(base_url: str, process: object) -> None:
        waited.append((base_url, process))

    monkeypatch.delenv("URDF_GALLERY_RENDER_APP_URL", raising=False)
    monkeypatch.delenv("VITE_API_BASE_URL", raising=False)
    monkeypatch.setenv("URDF_API_HOST", "127.0.0.1")
    monkeypatch.setenv("URDF_API_PORT", "8000")
    monkeypatch.setattr(ilu_gallery, "_reserve_loopback_port", lambda: 43123)
    monkeypatch.setattr(ilu_gallery.subprocess, "run", _fake_run)
    monkeypatch.setattr(ilu_gallery.subprocess, "Popen", _fake_popen)
    monkeypatch.setattr(ilu_gallery, "_wait_for_gallery_render_app_ready", _fake_wait)

    with ilu_gallery._resolve_gallery_render_app_url() as render_app_url:
        assert render_app_url == "http://127.0.0.1:43123"

    assert captured_build_args == [ilu_gallery.NPM_BIN, "run", "build"]
    assert captured_build_env["VITE_API_BASE_URL"] == "http://127.0.0.1:8000"
    assert captured_preview_args == [
        ilu_gallery.NPM_BIN,
        "run",
        "preview",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "43123",
    ]
    assert captured_preview_env["VITE_API_BASE_URL"] == "http://127.0.0.1:8000"
    assert waited == [("http://127.0.0.1:43123", preview_process)]
    assert preview_process.terminated is True
    assert preview_process.killed is False


def test_run_ilu_gallery_publish_build_uses_cli(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    fake_cli_path = tmp_path / "cli.js"
    fake_cli_path.write_text("// test cli", encoding="utf-8")
    output_root = tmp_path / "output"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(
            {
                "outputRoot": str(output_root),
                "items": [
                    {
                        "candidatePath": REAL_BARKOUR_PATH,
                        "sourcePath": REAL_BARKOUR_PATH,
                        "sourceFile": REAL_BARKOUR_FILE,
                        "galleryRepoKey": REAL_GALLERY_REPO_KEY,
                        "galleryFileBase": REAL_BARKOUR_FILE_BASE,
                        "galleryPngPath": REAL_BARKOUR_PNG_PATH,
                        "galleryWebmPath": REAL_BARKOUR_WEBM_PATH,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    record = ilu_gallery._GalleryJobRecord(
        job_id="job-123",
        status="completed",
        phase="generate",
        source=ilu_gallery.IluGallerySource(
            owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO
        ),
        repo_metadata=ilu_gallery.IluGalleryRepoMetadata(org="Google DeepMind"),
        published_repo=None,
        items=[
            ilu_gallery.IluGalleryEntry(
                id=REAL_BARKOUR_PATH,
                title="Barkour V0",
                owner=REAL_GALLERY_OWNER,
                repo=REAL_GALLERY_REPO,
                urdfPath=REAL_BARKOUR_PATH,
            )
        ],
        error=None,
        output_root=str(output_root),
        created_at=ilu_gallery._utc_now(),
        updated_at=ilu_gallery._utc_now(),
    )
    captured_args: list[str] = []

    def _fake_run(args, **kwargs):
        nonlocal captured_args
        captured_args = list(args)
        return CompletedProcess(
            args=args,
            returncode=0,
            stdout=json.dumps(
                {
                    "title": f"Add gallery assets for {REAL_GALLERY_REPO_KEY}",
                    "body": "Generated via ILU gallery publish draft",
                    "branchName": "gallery-import/test",
                    "repoSlug": "urdf-studio/urdf-robot-gallery",
                    "files": [
                        {
                            "path": "docs/robots.json",
                            "content": f'[{{"robots":[{{"file":"{REAL_BARKOUR_PATH}"}}]}}]\n',
                            "encoding": "utf-8",
                        }
                    ],
                }
            ),
            stderr="",
        )

    monkeypatch.setattr(ilu_gallery, "_resolve_ilu_cli_path", lambda: fake_cli_path)
    monkeypatch.setattr(ilu_gallery.subprocess, "run", _fake_run)

    draft = ilu_gallery._run_ilu_gallery_publish_build(record, output_root)

    assert captured_args == [
        ilu_gallery.NODE_BIN,
        str(fake_cli_path),
        "gallery-build-publish",
        "--spec",
        str(output_root / "publish-spec.json"),
    ]
    spec = json.loads((output_root / "publish-spec.json").read_text(encoding="utf-8"))
    assert spec["items"][0] == {"id": REAL_BARKOUR_PATH, "title": "Barkour V0"}
    assert spec["manifestPath"] == str(output_root / "manifest.json")
    assert draft.files[0].path == "docs/robots.json"


def test_resolve_ilu_cli_path_prefers_sibling_dist_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    installed_cli_path = tmp_path / "node_modules" / "i-love-urdf" / "dist" / "cli.js"
    sibling_cli_path = tmp_path / "i-love-urdf" / "dist" / "cli.js"
    for cli_path in (installed_cli_path, sibling_cli_path):
        cli_path.parent.mkdir(parents=True, exist_ok=True)
        cli_path.write_text("// test cli", encoding="utf-8")
        for relative_path in ilu_gallery.ILU_REQUIRED_DIST_RELATIVE_PATHS:
            required_path = cli_path.parent / relative_path
            required_path.parent.mkdir(parents=True, exist_ok=True)
            required_path.write_text("// ok", encoding="utf-8")

    monkeypatch.setattr(ilu_gallery, "ILU_INSTALLED_DIST_CLI_PATH", installed_cli_path)
    monkeypatch.setattr(ilu_gallery, "ILU_UPSTREAM_DIST_CLI_PATH", sibling_cli_path)
    monkeypatch.delenv(ilu_gallery.ILU_DIST_SOURCE_ENV, raising=False)

    assert ilu_gallery._resolve_ilu_cli_path() == sibling_cli_path


def test_resolve_ilu_cli_path_can_prefer_installed_dist_via_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    installed_cli_path = tmp_path / "node_modules" / "i-love-urdf" / "dist" / "cli.js"
    sibling_cli_path = tmp_path / "i-love-urdf" / "dist" / "cli.js"
    for cli_path in (installed_cli_path, sibling_cli_path):
        cli_path.parent.mkdir(parents=True, exist_ok=True)
        cli_path.write_text("// test cli", encoding="utf-8")
        for relative_path in ilu_gallery.ILU_REQUIRED_DIST_RELATIVE_PATHS:
            required_path = cli_path.parent / relative_path
            required_path.parent.mkdir(parents=True, exist_ok=True)
            required_path.write_text("// ok", encoding="utf-8")

    monkeypatch.setattr(ilu_gallery, "ILU_INSTALLED_DIST_CLI_PATH", installed_cli_path)
    monkeypatch.setattr(ilu_gallery, "ILU_UPSTREAM_DIST_CLI_PATH", sibling_cli_path)
    monkeypatch.setenv(
        ilu_gallery.ILU_DIST_SOURCE_ENV, ilu_gallery.ILU_DIST_SOURCE_INSTALLED
    )

    assert ilu_gallery._resolve_ilu_cli_path() == installed_cli_path


def test_merge_generated_manifest_preserves_catalog_snapshot(
    tmp_path: pathlib.Path,
) -> None:
    output_root = tmp_path / "output"
    output_root.mkdir(parents=True, exist_ok=True)
    current_manifest = {
        "outputRoot": str(output_root),
        "repoMetadata": {"org": "Google DeepMind"},
        "catalogSnapshot": {
            "repoEntries": [{"repoKey": REAL_GALLERY_REPO_KEY}],
            "previewEntries": [
                {"repoKey": REAL_GALLERY_REPO_KEY, "fileBase": REAL_BARKOUR_FILE_BASE}
            ],
        },
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "status": "repo not in gallery catalog | urdf, renderable",
                "thumbnailPath": "",
                "thumbnailUrl": "",
                "previewUrl": "",
                "videoUrl": "",
                "galleryRepoKey": "",
                "galleryFileBase": REAL_BARKOUR_FILE_BASE,
                "galleryPngPath": "",
                "galleryWebmPath": "",
            }
        ],
    }
    generated_manifest = {
        "items": [
            {
                "candidatePath": REAL_BARKOUR_PATH,
                "thumbnailPath": str(output_root / f"{REAL_BARKOUR_FILE_BASE}.png"),
                "videoPath": str(output_root / f"{REAL_BARKOUR_FILE_BASE}.webm"),
            }
        ]
    }

    merged_manifest = ilu_gallery._merge_generated_manifest(
        ilu_gallery.IluGallerySource(owner=REAL_GALLERY_OWNER, repo=REAL_GALLERY_REPO),
        output_root,
        current_manifest,
        generated_manifest,
        ["image", "video"],
    )

    assert merged_manifest["catalogSnapshot"] == current_manifest["catalogSnapshot"]
