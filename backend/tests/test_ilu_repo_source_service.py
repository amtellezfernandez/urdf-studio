from __future__ import annotations

import base64
import json
import subprocess
import zipfile
from io import BytesIO

import pytest

from backend.services import ilu_repo_source
from backend.services.ilu_repo_source import (
    GitHubPublicProxyError,
    _ArchiveSnapshot,
    _extract_github_error_detail,
    _load_public_archive_snapshot,
    fetch_file_bytes,
    list_repo_candidates,
    list_repo_contents,
)


def test_list_repo_contents_uses_ilu_bridge(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda: "server-token")

    def _fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        payload = {
            "files": [
                {
                    "name": "robot.urdf",
                    "path": "robot.urdf",
                    "type": "file",
                    "sha": "sha-robot",
                    "encoding": "sha",
                }
            ]
        }
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_repo_source.subprocess.run", _fake_run)

    files = list_repo_contents(owner="acme", repo="robot")

    assert calls[0][-1] == "repo-contents"
    assert files[0]["download_url"] == "/ilu/file?owner=acme&repo=robot&path=robot.urdf&sha=sha-robot"


def test_list_repo_contents_filters_bridge_results_to_requested_path(monkeypatch) -> None:
    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda: "server-token")

    def _fake_run(*args, **kwargs):
        del kwargs
        payload = {
            "ref": "main",
            "files": [
                {
                    "name": "demo.urdf",
                    "path": "robots/demo/demo.urdf",
                    "type": "file",
                    "sha": "sha-demo",
                    "encoding": "sha",
                },
                {
                    "name": "other.urdf",
                    "path": "robots/other/other.urdf",
                    "type": "file",
                    "sha": "sha-other",
                    "encoding": "sha",
                },
            ],
        }
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_repo_source.subprocess.run", _fake_run)

    files = list_repo_contents(owner="acme", repo="robot", path="robots/demo")

    assert [file["path"] for file in files] == ["robots/demo/demo.urdf"]
    assert files[0]["download_url"] == (
        "/ilu/file?owner=acme&repo=robot&path=robots%2Fdemo%2Fdemo.urdf&sha=sha-demo&branch=main"
    )


def test_fetch_file_bytes_uses_ilu_bridge(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda: "server-token")

    def _fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        payload = {
            "contentBase64": base64.b64encode(b"<robot />").decode("ascii"),
            "mimeType": "application/xml",
        }
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_repo_source.subprocess.run", _fake_run)

    content, mime_type = fetch_file_bytes(owner="acme", repo="robot", path="robot.urdf", sha="sha-robot")

    assert calls[0][-1] == "file-bytes"
    assert content == b"<robot />"
    assert mime_type == "application/xml"


def test_list_repo_candidates_uses_ilu_bridge(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda: "server-token")

    def _fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        payload = {
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
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_repo_source.subprocess.run", _fake_run)

    payload = list_repo_candidates(owner="acme", repo="robot")

    assert calls[0][-1] == "repo-candidates"
    assert payload["ref"] == "main"
    assert payload["candidates"][0]["path"] == "robots/demo/demo.urdf"


def test_list_repo_contents_falls_back_to_public_archive(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._load_public_archive_snapshot",
        lambda owner, repo, branch=None: _ArchiveSnapshot(
            resolved_ref="main",
            files=[
                {
                    "name": "robot.urdf",
                    "path": "robot.urdf",
                    "type": "file",
                    "download_url": None,
                    "sha": None,
                    "encoding": None,
                }
            ],
            file_bytes_by_path={"robot.urdf": b"<robot />"},
        ),
    )

    files = list_repo_contents(owner="acme", repo="robot")

    assert files[0]["download_url"] == "/ilu/file?owner=acme&repo=robot&path=robot.urdf&branch=main"


def test_fetch_file_bytes_falls_back_to_public_archive(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._load_public_archive_snapshot",
        lambda owner, repo, branch=None: _ArchiveSnapshot(
            resolved_ref=branch or "main",
            files=[],
            file_bytes_by_path={"robot.urdf": b"<robot />"},
        ),
    )

    content, mime_type = fetch_file_bytes(
        owner="acme",
        repo="robot",
        path="robot.urdf",
        branch="main",
    )

    assert content == b"<robot />"
    assert mime_type == "application/xml"


def test_list_repo_candidates_falls_back_to_public_archive(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._load_public_archive_snapshot",
        lambda owner, repo, branch=None: _ArchiveSnapshot(
            resolved_ref=branch or "main",
            files=[
                {
                    "name": "demo.urdf",
                    "path": "robots/demo/demo.urdf",
                    "type": "file",
                    "download_url": None,
                    "sha": None,
                    "encoding": None,
                },
                {
                    "name": "meshes",
                    "path": "robots/demo/meshes",
                    "type": "dir",
                    "download_url": None,
                    "sha": None,
                    "encoding": None,
                },
            ],
            file_bytes_by_path={"robots/demo/demo.urdf": b"<robot />"},
        ),
    )

    payload = list_repo_candidates(owner="acme", repo="robot")

    assert payload["ref"] == "main"
    assert payload["candidates"][0]["path"] == "robots/demo/demo.urdf"
    assert payload["candidates"][0]["hasMeshesFolder"] is True


def test_list_repo_candidates_falls_back_when_bridge_process_fails(monkeypatch) -> None:
    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda: "server-token")
    monkeypatch.setattr(
        "backend.services.ilu_repo_source.subprocess.run",
        lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError("node")),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._load_public_archive_snapshot",
        lambda owner, repo, branch=None, force_refresh=False: _ArchiveSnapshot(
            resolved_ref=branch or "main",
            files=[
                {
                    "name": "demo.urdf",
                    "path": "robots/demo/demo.urdf",
                    "type": "file",
                    "download_url": None,
                    "sha": None,
                    "encoding": None,
                },
                {
                    "name": "assets",
                    "path": "robots/demo/assets",
                    "type": "dir",
                    "download_url": None,
                    "sha": None,
                    "encoding": None,
                },
            ],
            file_bytes_by_path={"robots/demo/demo.urdf": b"<robot />"},
        ),
    )

    payload = list_repo_candidates(owner="acme", repo="robot")

    assert payload["ref"] == "main"
    assert payload["candidates"][0]["path"] == "robots/demo/demo.urdf"
    assert payload["candidates"][0]["meshesFolderPath"] == "robots/demo/assets"


def test_load_public_git_tree_files_builds_candidate_discovery_listing(monkeypatch) -> None:
    owner = "google-deepmind"
    repo = "mujoco_menagerie"
    requested_urls: list[str] = []

    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda explicit_token=None: None)
    monkeypatch.setattr("backend.services.ilu_repo_source._resolve_default_branch_from_html", lambda owner, repo: "main")
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._fetch_url_bytes",
        lambda url, *, max_bytes, headers=None: (
            requested_urls.append(url)
            or json.dumps(
                {
                    "truncated": False,
                    "tree": [
                        {"path": "robots", "type": "tree"},
                        {"path": "robots/demo", "type": "tree"},
                        {
                            "path": "robots/demo/demo.urdf",
                            "type": "blob",
                            "size": 128,
                            "sha": "sha-demo",
                        },
                        {"path": "robots/demo/assets", "type": "tree"},
                    ],
                }
            ).encode("utf-8")
        ),
    )

    resolved_ref, files = ilu_repo_source._load_public_git_tree_files(owner, repo)

    assert resolved_ref == "main"
    assert requested_urls == [
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/main?recursive=1",
    ]
    assert any(file["path"] == "robots/demo/assets" and file["type"] == "dir" for file in files)
    assert any(file["path"] == "robots/demo/demo.urdf" and file["type"] == "file" for file in files)


def test_load_public_git_tree_files_quotes_refs_with_slashes(monkeypatch) -> None:
    owner = "google-deepmind"
    repo = "mujoco_menagerie"
    slash_ref = "refs/pull/1/head"
    requested_urls: list[str] = []

    monkeypatch.setattr("backend.services.ilu_repo_source.resolve_server_github_token", lambda explicit_token=None: None)
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._fetch_url_bytes",
        lambda url, *, max_bytes, headers=None: (
            requested_urls.append(url)
            or json.dumps({"truncated": False, "tree": []}).encode("utf-8")
        ),
    )

    resolved_ref, files = ilu_repo_source._load_public_git_tree_files(owner, repo, branch=slash_ref)

    assert resolved_ref == slash_ref
    assert files == []
    assert requested_urls == [
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/refs%2Fpull%2F1%2Fhead?recursive=1",
    ]


def test_list_repo_candidates_falls_back_to_public_git_tree_when_archive_is_too_large(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._load_public_archive_snapshot",
        lambda owner, repo, branch=None, force_refresh=False: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=413, detail="GitHub response exceeds configured size limit.")
        ),
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._list_repo_candidates_from_git_tree",
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
                    "meshesFolderPath": "robots/demo/assets",
                    "isXacro": False,
                }
            ],
        },
    )

    payload = list_repo_candidates(owner="acme", repo="robot")

    assert payload["ref"] == "main"
    assert payload["candidates"][0]["path"] == "robots/demo/demo.urdf"


def test_extract_github_error_detail_simplifies_rate_limit_json() -> None:
    detail = _extract_github_error_detail(
        403,
        json.dumps(
            {
                "message": "API rate limit exceeded for 203.0.113.42.",
                "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
            }
        ),
        "Forbidden",
    )

    assert detail == "GitHub public API rate limit exceeded. Configure server GitHub auth or retry later."


def test_fetch_file_bytes_refreshes_stale_archive_snapshot(monkeypatch) -> None:
    calls: list[bool] = []

    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )

    def _fake_load(owner, repo, branch=None, force_refresh=False):
        calls.append(force_refresh)
        if force_refresh:
            return _ArchiveSnapshot(
                resolved_ref=branch or "main",
                files=[],
                file_bytes_by_path={"robot.urdf": b"<robot />"},
            )
        return _ArchiveSnapshot(
            resolved_ref=branch or "main",
            files=[],
            file_bytes_by_path={},
        )

    monkeypatch.setattr("backend.services.ilu_repo_source._load_public_archive_snapshot", _fake_load)

    content, mime_type = fetch_file_bytes(
        owner="acme",
        repo="robot",
        path="robot.urdf",
        branch="main",
    )

    assert calls == [False, True]
    assert content == b"<robot />"
    assert mime_type == "application/xml"


def test_list_repo_contents_refreshes_empty_subpath_archive_listing(monkeypatch) -> None:
    calls: list[bool] = []

    monkeypatch.setattr(
        "backend.services.ilu_repo_source._run_bridge",
        lambda command, payload: (_ for _ in ()).throw(
            GitHubPublicProxyError(status_code=403, detail="GitHub API rate limit exceeded")
        ),
    )

    def _fake_load(owner, repo, branch=None, force_refresh=False):
        calls.append(force_refresh)
        if force_refresh:
            return _ArchiveSnapshot(
                resolved_ref=branch or "main",
                files=[
                    {
                        "name": "robot.urdf",
                        "path": "nested/robot.urdf",
                        "type": "file",
                        "download_url": None,
                        "sha": None,
                        "encoding": None,
                    }
                ],
                file_bytes_by_path={"nested/robot.urdf": b"<robot />"},
            )
        return _ArchiveSnapshot(
            resolved_ref=branch or "main",
            files=[],
            file_bytes_by_path={},
        )

    monkeypatch.setattr("backend.services.ilu_repo_source._load_public_archive_snapshot", _fake_load)

    files = list_repo_contents(owner="acme", repo="robot", path="nested", branch="main")

    assert calls == [False, True]
    assert files[0]["path"] == "nested/robot.urdf"



def _build_archive_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in entries.items():
            archive.writestr(f"repo-main/{path}", content)
    return buffer.getvalue()


def test_load_public_archive_snapshot_rejects_excessive_file_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._resolve_default_branch_from_html",
        lambda owner, repo: "main",
    )
    monkeypatch.setattr(
        "backend.services.ilu_repo_source._fetch_url_bytes",
        lambda url, max_bytes: _build_archive_bytes({"a.txt": b"a", "b.txt": b"b"}),
    )
    monkeypatch.setattr("backend.services.ilu_repo_source.GITHUB_PUBLIC_ARCHIVE_MAX_ENTRY_COUNT", 1)

    with pytest.raises(GitHubPublicProxyError) as exc:
        _load_public_archive_snapshot("acme", "robot")

    assert exc.value.status_code == 413
    assert "file-count limit" in exc.value.detail.lower()
