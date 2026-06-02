from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("httpx")

from httpx import ASGITransport, AsyncClient

from backend.app import create_app
from backend.models.ilu_gallery import IluGalleryJobResponse, IluGalleryPrDraftResponse, IluGalleryPublishResponse
from backend.services.github_auth import GitHubServerAuthStatus


TEST_BASE_URL = "http://testserver"
TEST_CLIENT_HOST = "127.0.0.1"
TEST_CLIENT_PORT = 8001


async def _request_json(method: str, path: str, **kwargs):
    transport = ASGITransport(
        app=create_app(),
        client=(TEST_CLIENT_HOST, TEST_CLIENT_PORT),
    )
    async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as client:
        return await client.request(method, path, **kwargs)


def test_github_auth_status_endpoint_exposes_server_auth_mode(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.api.ilu_urdf.get_server_github_auth_status",
        lambda: GitHubServerAuthStatus(mode="gh-cli", available=True),
    )

    response = asyncio.run(_request_json("GET", "/ilu/github-auth-status"))

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "mode": "gh-cli",
    }


def test_github_auth_status_endpoint_reports_missing_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.api.ilu_urdf.get_server_github_auth_status",
        lambda: GitHubServerAuthStatus(mode="none", available=False),
    )

    response = asyncio.run(_request_json("GET", "/ilu/github-auth-status"))

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "mode": "none",
    }


def test_gallery_job_endpoints_expose_generation_and_pr_actions(monkeypatch) -> None:
    captured_generate_payload = {}

    monkeypatch.setattr(
        "backend.api.ilu_urdf.create_gallery_job",
        lambda payload: IluGalleryJobResponse(
            job_id="job-123",
            status="queued",
            phase="inspect",
            source=payload.source,
            repo_metadata={"org": "", "summary": "", "demo": "", "tags": [], "license": "", "authorWebsite": "", "authorX": "", "authorLinkedin": "", "authorGithub": "", "contact": "", "extra": "", "hfDatasets": []},
            items=[],
            error=None,
            created_at="2026-03-27T10:00:00Z",
            updated_at="2026-03-27T10:00:00Z",
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.get_gallery_job",
        lambda job_id: IluGalleryJobResponse(
            job_id=job_id,
            status="completed",
            phase="generate",
            source={"owner": "acme", "repo": "robot", "path": "robots/demo", "branch": "main"},
            repo_metadata={"org": "Acme Robotics", "summary": "Compact demo arm", "demo": "", "tags": ["Arm"], "license": "Apache-2.0", "authorWebsite": "https://acme.example", "authorX": "", "authorLinkedin": "", "authorGithub": "acme", "contact": "", "extra": "", "hfDatasets": []},
            items=[
                {
                    "id": "demo",
                    "title": "Demo",
                    "summary": "robots/demo/demo.urdf",
                    "owner": "acme",
                    "repo": "robot",
                    "path": "robots/demo",
                    "branch": "main",
                    "urdfPath": "robots/demo/demo.urdf",
                    "thumbnailUrl": "/thumbs/demo.png",
                    "previewUrl": "/?thumbnail=1&github=https://github.com/acme/robot&urdf=robots/demo/demo.urdf",
                    "videoUrl": None,
                    "tags": ["urdf"],
                }
            ],
            error=None,
            created_at="2026-03-27T10:00:00Z",
            updated_at="2026-03-27T10:00:01Z",
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.generate_gallery_job",
        lambda job_id, payload: (
            captured_generate_payload.update(
                {
                    "mode": payload.mode,
                    "item_ids": list(payload.item_ids),
                    "asset_kinds": list(payload.asset_kinds),
                }
            )
            or IluGalleryJobResponse(
                job_id=job_id,
                status="queued",
                phase="generate",
                source={"owner": "acme", "repo": "robot", "path": "robots/demo", "branch": "main"},
                repo_metadata={"org": "", "summary": "", "demo": "", "tags": [], "license": "", "authorWebsite": "", "authorX": "", "authorLinkedin": "", "authorGithub": "", "contact": "", "extra": "", "hfDatasets": []},
                items=[],
                error=None,
                created_at="2026-03-27T10:00:00Z",
                updated_at="2026-03-27T10:00:02Z",
            )
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.update_gallery_job_metadata",
        lambda job_id, payload: IluGalleryJobResponse(
            job_id=job_id,
            status="completed",
            phase="generate",
            source={"owner": "acme", "repo": "robot", "path": "robots/demo", "branch": "main"},
            repo_metadata=payload.repo_metadata,
            items=[
                {
                    "id": "demo",
                    "title": "Demo Arm",
                    "summary": "robots/demo/demo.urdf",
                    "owner": "acme",
                    "repo": "robot",
                    "path": "robots/demo",
                    "branch": "main",
                    "urdfPath": "robots/demo/demo.urdf",
                    "thumbnailUrl": "/thumbs/demo.png",
                    "previewUrl": "/?thumbnail=1&github=https://github.com/acme/robot&urdf=robots/demo/demo.urdf",
                    "videoUrl": None,
                    "tags": ["urdf"],
                }
            ],
            error=None,
            created_at="2026-03-27T10:00:00Z",
            updated_at="2026-03-27T10:00:03Z",
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.build_gallery_job_bundle",
        lambda job_id: (b"zip-bytes", f"{job_id}.zip"),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.build_gallery_job_pr_draft",
        lambda job_id: IluGalleryPrDraftResponse(
            title="Import gallery assets",
            body="body",
            branch_name=f"gallery-import/{job_id}",
            repo_slug="urdf-studio/urdf-robot-gallery",
            files=[{"path": "imports/demo.json", "content": "{}"}],
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.publish_gallery_job",
        lambda job_id: IluGalleryPublishResponse(
            title="Import gallery assets",
            repo_slug="urdf-studio/urdf-robot-gallery",
            branch_name=f"gallery-import/{job_id}",
            base_branch="main",
            pull_request_number=7,
            pull_request_url="https://github.com/urdf-studio/urdf-robot-gallery/pull/7",
            files_changed=2,
            reused_existing_pull_request=False,
        ),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.read_gallery_thumbnail_file",
        lambda job_id, item_id: (b"png-bytes", "image/png"),
    )
    monkeypatch.setattr(
        "backend.api.ilu_urdf.read_gallery_job_asset_file",
        lambda job_id, item_id, kind: (b"webm-bytes", "video/webm"),
    )

    create_response = asyncio.run(
        _request_json(
            "POST",
            "/ilu/gallery/jobs",
            json={"source": {"owner": "acme", "repo": "robot", "path": "robots/demo", "branch": "main"}},
        )
    )
    status_response = asyncio.run(_request_json("GET", "/ilu/gallery/jobs/job-123"))
    generate_response = asyncio.run(
        _request_json(
            "POST",
            "/ilu/gallery/jobs/job-123/generate",
            json={"mode": "selected", "itemIds": ["demo"], "assetKinds": ["video"]},
        )
    )
    metadata_response = asyncio.run(
        _request_json(
            "PATCH",
            "/ilu/gallery/jobs/job-123/metadata",
            json={
                "repoMetadata": {
                    "org": "Acme Robotics",
                    "summary": "Compact demo arm",
                    "demo": "",
                    "tags": ["Arm"],
                    "license": "Apache-2.0",
                    "authorWebsite": "https://acme.example",
                    "authorX": "",
                    "authorLinkedin": "",
                    "authorGithub": "acme",
                    "contact": "",
                    "extra": "",
                    "hfDatasets": [],
                },
                "items": [{"id": "demo", "title": "Demo Arm"}],
            },
        )
    )
    bundle_response = asyncio.run(_request_json("GET", "/ilu/gallery/jobs/job-123/bundle"))
    thumbnail_response = asyncio.run(
        _request_json("GET", "/ilu/gallery/jobs/job-123/thumbnail?item_id=robots/demo/demo.urdf")
    )
    asset_response = asyncio.run(
        _request_json("GET", "/ilu/gallery/jobs/job-123/asset?item_id=robots/demo/demo.urdf&kind=video")
    )
    pr_draft_response = asyncio.run(_request_json("GET", "/ilu/gallery/jobs/job-123/pr-draft"))
    publish_response = asyncio.run(_request_json("POST", "/ilu/gallery/jobs/job-123/publish"))

    assert create_response.status_code == 200
    assert create_response.json()["jobId"] == "job-123"
    assert create_response.json()["phase"] == "inspect"
    assert status_response.status_code == 200
    assert generate_response.status_code == 200
    assert metadata_response.status_code == 200
    assert generate_response.json()["phase"] == "generate"
    assert generate_response.json()["status"] == "queued"
    assert captured_generate_payload == {
        "mode": "selected",
        "item_ids": ["demo"],
        "asset_kinds": ["video"],
    }
    status_payload = status_response.json()
    assert status_payload["jobId"] == "job-123"
    assert status_payload["status"] == "completed"
    assert status_payload["phase"] == "generate"
    assert status_payload["source"] == {
        "owner": "acme",
        "repo": "robot",
        "path": "robots/demo",
        "branch": "main",
        "urdfPath": None,
    }
    assert status_payload["repoMetadata"]["org"] == "Acme Robotics"
    assert status_payload["repoMetadata"]["summary"] == "Compact demo arm"
    assert status_payload["repoMetadata"]["tags"] == ["Arm"]
    assert status_payload["repoMetadata"]["license"] == "Apache-2.0"
    assert status_payload["repoMetadata"]["authorWebsite"] == "https://acme.example"
    assert status_payload["repoMetadata"]["authorGithub"] == "acme"
    assert status_payload["publishedRepo"] is None
    assert status_payload["error"] is None
    assert status_payload["createdAt"] == "2026-03-27T10:00:00Z"
    assert status_payload["updatedAt"] == "2026-03-27T10:00:01Z"
    assert len(status_payload["items"]) == 1
    assert status_payload["items"][0]["id"] == "demo"
    assert status_payload["items"][0]["title"] == "Demo"
    assert status_payload["items"][0]["summary"] == "robots/demo/demo.urdf"
    assert status_payload["items"][0]["attentionNotes"] == []
    assert status_payload["items"][0]["owner"] == "acme"
    assert status_payload["items"][0]["repo"] == "robot"
    assert status_payload["items"][0]["path"] == "robots/demo"
    assert status_payload["items"][0]["branch"] == "main"
    assert status_payload["items"][0]["urdfPath"] == "robots/demo/demo.urdf"
    assert status_payload["items"][0]["sourceFile"] is None
    assert status_payload["items"][0]["thumbnailUrl"] == "/thumbs/demo.png"
    assert (
        status_payload["items"][0]["previewUrl"]
        == "/?thumbnail=1&github=https://github.com/acme/robot&urdf=robots/demo/demo.urdf"
    )
    assert status_payload["items"][0]["videoUrl"] is None
    assert status_payload["items"][0]["galleryRepoKey"] is None
    assert status_payload["items"][0]["galleryFileBase"] is None
    assert status_payload["items"][0]["robotTraits"] is None
    assert status_payload["items"][0]["tags"] == ["urdf"]
    assert bundle_response.status_code == 200
    assert bundle_response.headers["content-disposition"] == 'attachment; filename="job-123.zip"'
    assert thumbnail_response.status_code == 200
    assert thumbnail_response.content == b"png-bytes"
    assert asset_response.status_code == 200
    assert asset_response.content == b"webm-bytes"
    assert pr_draft_response.status_code == 200
    assert pr_draft_response.json()["repoSlug"] == "urdf-studio/urdf-robot-gallery"
    assert publish_response.status_code == 200
    assert publish_response.json()["pullRequestUrl"] == "https://github.com/urdf-studio/urdf-robot-gallery/pull/7"


def test_repo_candidates_endpoint_returns_candidate_summary(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.api.ilu_urdf.list_repo_candidates",
        lambda owner, repo, path="", branch=None: {
            "ref": branch or "main",
            "candidates": [
                {
                    "path": "robots/demo/demo.urdf",
                    "name": "demo.urdf",
                    "displayName": "demo",
                    "fileBase": "demo--abc123",
                    "sourceFile": "demo.urdf",
                    "hasMeshesFolder": True,
                    "meshesFolderPath": "robots/demo/meshes",
                    "isXacro": False,
                }
            ],
        },
    )

    response = asyncio.run(
        _request_json(
            "GET",
            "/ilu/repo-candidates?owner=acme&repo=robot&path=robots%2Fdemo",
        )
    )

    assert response.status_code == 200
    assert response.json() == {
        "ref": "main",
        "candidates": [
            {
                "path": "robots/demo/demo.urdf",
                "name": "demo.urdf",
                "displayName": "demo",
                "fileBase": "demo--abc123",
                "sourceFile": "demo.urdf",
                "hasMeshesFolder": True,
                "meshesFolderPath": "robots/demo/meshes",
                "isXacro": False,
            }
        ],
    }


def test_repo_gallery_preview_endpoint_returns_published_preview_items(monkeypatch) -> None:
    owner = "google-deepmind"
    repo = "mujoco_menagerie"
    repo_key = f"{owner}/{repo}"
    branch = "main"
    candidate_path = "google_barkour_v0/barkour_v0.urdf"
    candidate_file = "barkour_v0.urdf"
    candidate_file_base = "google-barkour-v0"
    captured_preview_payload = {}

    monkeypatch.setattr(
        "backend.api.ilu_urdf.get_gallery_repo_preview",
        lambda source, candidates=None: (
            captured_preview_payload.update(
                {
                    "source": source.model_dump(mode="json", by_alias=True),
                    "candidates": list(candidates or []),
                }
            )
            or {
            "source": {
                "owner": source.owner,
                "repo": source.repo,
                "path": source.path,
                "branch": source.branch,
            },
            "publishedRepo": {
                "repo": f"https://github.com/{repo_key}",
                "repoKey": repo_key,
                "path": None,
                "name": "MuJoCo Menagerie",
                "summary": "",
                "org": "Google DeepMind",
                "demo": "",
                "tags": [],
                "robots": [],
                "hfDatasets": [],
                "authorWebsite": "",
                "authorX": "",
                "authorLinkedin": "",
                "authorGithub": "",
                "contact": "",
                "extra": "",
                "stars": 12,
                "ownerLogin": owner,
                "ownerAvatar": "https://example.com/google-deepmind.png",
                "authorLogin": None,
                "authorAvatar": None,
                "repoUpdatedAt": "2026-04-10T09:00:00Z",
                "updatedAt": "2026-04-10T09:00:00Z",
                "license": "Apache-2.0",
            },
            "items": [
                {
                    "id": candidate_path,
                    "title": "Barkour V0",
                    "summary": "gallery catalog thumbnail available",
                    "attentionNotes": [],
                    "owner": owner,
                    "repo": repo,
                    "path": None,
                    "branch": branch,
                    "urdfPath": candidate_path,
                    "sourceFile": candidate_file,
                    "thumbnailUrl": "https://example.com/thumb.png",
                    "previewUrl": "https://example.com/preview.webp",
                    "videoUrl": None,
                    "galleryRepoKey": repo_key,
                    "galleryFileBase": candidate_file_base,
                    "macroTags": [],
                    "meshCount": None,
                    "linkCount": None,
                    "jointCount": None,
                    "armCount": None,
                    "legCount": None,
                    "wheelCount": None,
                    "robotTraits": None,
                    "tags": ["urdf"],
                }
            ],
            }
        ),
    )

    response = asyncio.run(
        _request_json(
            "POST",
            "/ilu/repo-gallery-preview",
            json={
                "source": {
                    "owner": owner,
                    "repo": repo,
                    "branch": branch,
                },
                "candidates": [
                    {
                        "path": candidate_path,
                        "name": candidate_file,
                        "displayName": "Barkour V0",
                        "fileBase": candidate_file_base,
                        "sourceFile": candidate_file,
                        "hasMeshesFolder": True,
                        "isXacro": False,
                    }
                ],
            },
        )
    )

    assert response.status_code == 200
    assert captured_preview_payload == {
        "source": {
            "owner": owner,
            "repo": repo,
            "path": None,
            "branch": branch,
            "urdfPath": None,
        },
        "candidates": [
            {
                "path": candidate_path,
                "name": candidate_file,
                "displayName": "Barkour V0",
                "fileBase": candidate_file_base,
                "sourceFile": candidate_file,
                "hasMeshesFolder": True,
                "isXacro": False,
            }
        ],
    }
    assert response.json() == {
        "source": {
            "owner": owner,
            "repo": repo,
            "path": None,
            "branch": branch,
            "urdfPath": None,
        },
        "publishedRepo": {
            "repo": f"https://github.com/{repo_key}",
            "repoKey": repo_key,
            "path": None,
            "name": "MuJoCo Menagerie",
            "summary": "",
            "org": "Google DeepMind",
            "demo": "",
            "tags": [],
            "robots": [],
            "hfDatasets": [],
            "authorWebsite": "",
            "authorX": "",
            "authorLinkedin": "",
            "authorGithub": "",
            "contact": "",
            "extra": "",
            "stars": 12,
            "ownerLogin": owner,
            "ownerAvatar": "https://example.com/google-deepmind.png",
            "authorLogin": None,
            "authorAvatar": None,
            "repoUpdatedAt": "2026-04-10T09:00:00Z",
            "updatedAt": "2026-04-10T09:00:00Z",
            "license": "Apache-2.0",
        },
        "items": [
            {
                "id": candidate_path,
                "title": "Barkour V0",
                "summary": "gallery catalog thumbnail available",
                "attentionNotes": [],
                "owner": owner,
                "repo": repo,
                "path": None,
                "branch": branch,
                "urdfPath": candidate_path,
                "sourceFile": candidate_file,
                "thumbnailUrl": "https://example.com/thumb.png",
                "previewUrl": "https://example.com/preview.webp",
                "videoUrl": None,
                "galleryRepoKey": repo_key,
                "galleryFileBase": candidate_file_base,
                "macroTags": [],
                "meshCount": None,
                "linkCount": None,
                "jointCount": None,
                "armCount": None,
                "legCount": None,
                "wheelCount": None,
                "robotTraits": None,
                "tags": ["urdf"],
            }
        ],
    }
