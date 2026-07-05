from __future__ import annotations

import json
from pathlib import Path

from backend.models.ilu_session import IluSessionSaveRequest
from backend.services import ilu_session as ilu_session_service


def test_get_ilu_session_snapshot_uses_camel_case_contract(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")
    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "github",
                    "urdfPath": str(working_urdf_path),
                    "githubRef": "https://github.com/openai/robot.git",
                    "githubRevision": "main",
                    "repositoryUrdfPath": "robots/demo/robot.urdf",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    snapshot = ilu_session_service.get_ilu_session_snapshot("session-1")

    assert snapshot.session_schema == "ilu-shared-session"
    assert snapshot.schema_version == 1
    assert snapshot.loaded_source is not None
    assert snapshot.loaded_source.repository_urdf_path == "robots/demo/robot.urdf"
    assert snapshot.model_dump(by_alias=True) == {
        "schema": "ilu-shared-session",
        "schemaVersion": 1,
        "sessionId": "session-1",
        "createdAt": "2026-03-23T00:00:00Z",
        "updatedAt": "2026-03-23T00:00:01Z",
        "workingUrdfPath": str(working_urdf_path),
        "lastUrdfPath": str(working_urdf_path),
        "urdfContent": "<robot name='demo'/>",
        "loadedSource": {
            "source": "github",
            "urdfPath": str(working_urdf_path),
            "localPath": None,
            "githubRef": "https://github.com/openai/robot.git",
            "githubRevision": "main",
            "repositoryUrdfPath": "robots/demo/robot.urdf",
        },
    }


def test_save_request_accepts_previous_and_camel_case_payloads() -> None:
    assert IluSessionSaveRequest.model_validate({"urdf_xml": "<robot />"}).urdf_xml == "<robot />"
    assert IluSessionSaveRequest.model_validate({"urdfContent": "<robot />"}).urdf_xml == "<robot />"


def test_session_snapshot_rejects_non_object_metadata(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text("[]", encoding="utf-8")
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.get_ilu_session_snapshot("session-1")
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 500
        assert exc.detail == "ilu session metadata is incomplete."
    else:
        raise AssertionError("Expected non-object session metadata to be rejected.")


def test_session_snapshot_rejects_invalid_metadata_encoding(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_bytes(b"\x80not-utf8")
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.get_ilu_session_snapshot("session-1")
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 500
        assert exc.detail == "Failed to read ilu session metadata."
    else:
        raise AssertionError("Expected invalid session metadata encoding to be rejected.")


def test_session_snapshot_rejects_non_string_session_id(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.get_ilu_session_snapshot(123)  # type: ignore[arg-type]
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 400
        assert exc.detail == "Invalid ilu session id."
    else:
        raise AssertionError("Expected non-string session id to be rejected.")


def test_local_session_manifest_exposes_working_urdf_and_filtered_assets(
    monkeypatch, tmp_path: Path
) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    repo_root = tmp_path / "repo"
    (repo_root / "robots/demo/meshes").mkdir(parents=True)
    (repo_root / "robots/demo/meshes/link.stl").write_text("solid demo\nendsolid demo\n", encoding="utf-8")
    (repo_root / "robots/demo/meshes/albedo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (repo_root / "robots/demo/package.xml").write_text(
        "<package><name>demo_description</name></package>",
        encoding="utf-8",
    )
    (repo_root / "robots/demo/notes.txt").write_text("ignore me", encoding="utf-8")

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "local-repo",
                    "urdfPath": str(working_urdf_path),
                    "localPath": str(repo_root),
                    "repositoryUrdfPath": "robots/demo/robot.xacro",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    manifest = ilu_session_service.get_ilu_session_asset_manifest("session-1")
    files = manifest.model_dump(by_alias=True)["files"]

    assert files == [
        {
            "path": "robots/demo/robot.urdf",
            "url": "/ilu-session/session-1/asset?kind=working&path=robots%2Fdemo%2Frobot.urdf",
            "mime": "application/xml",
        },
        {
            "path": "robots/demo/meshes/albedo.png",
            "url": "/ilu-session/session-1/asset?kind=source&path=robots%2Fdemo%2Fmeshes%2Falbedo.png",
            "mime": "image/png",
        },
        {
            "path": "robots/demo/meshes/link.stl",
            "url": "/ilu-session/session-1/asset?kind=source&path=robots%2Fdemo%2Fmeshes%2Flink.stl",
            "mime": "model/stl",
        },
        {
            "path": "robots/demo/package.xml",
            "url": "/ilu-session/session-1/asset?kind=source&path=robots%2Fdemo%2Fpackage.xml",
            "mime": "application/xml",
        },
    ]


def test_session_snapshot_rejects_invalid_working_urdf_encoding(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_bytes(b"\x80not-utf8")
    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.get_ilu_session_snapshot("session-1")
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 500
        assert exc.detail == "Failed to read ilu working URDF."
    else:
        raise AssertionError("Expected invalid working URDF encoding to be rejected.")


def test_github_session_manifest_exposes_working_urdf_and_repo_assets(
    monkeypatch, tmp_path: Path
) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "github",
                    "urdfPath": str(working_urdf_path),
                    "githubRef": "https://github.com/openai/robot.git",
                    "githubRevision": "main",
                    "repositoryUrdfPath": "robots/demo/robot.xacro",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)
    monkeypatch.setattr(
        ilu_session_service,
        "list_repo_contents",
        lambda owner, repo, path="", branch=None: [
            {"path": "robots/demo/robot.xacro", "type": "file", "download_url": "/ilu/file?path=robots/demo/robot.xacro"},
            {"path": "robots/demo/meshes/link.stl", "type": "file", "download_url": "/ilu/file?path=robots/demo/meshes/link.stl"},
            {"path": "robots/demo", "type": "dir", "download_url": None},
        ],
    )

    manifest = ilu_session_service.get_ilu_session_asset_manifest("session-1")
    files = manifest.model_dump(by_alias=True)["files"]

    assert files == [
        {
            "path": "robots/demo/robot.urdf",
            "url": "/ilu-session/session-1/asset?kind=working&path=robots%2Fdemo%2Frobot.urdf",
            "mime": "application/xml",
        },
        {
            "path": "robots/demo/robot.xacro",
            "url": "/ilu/file?path=robots/demo/robot.xacro",
            "mime": "application/octet-stream",
        },
        {
            "path": "robots/demo/meshes/link.stl",
            "url": "/ilu/file?path=robots/demo/meshes/link.stl",
            "mime": "model/stl",
        },
    ]


def test_github_session_manifest_rejects_blank_github_source_fields(
    monkeypatch, tmp_path: Path
) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "github",
                    "urdfPath": str(working_urdf_path),
                    "githubRef": "   ",
                    "githubRevision": "   ",
                    "repositoryUrdfPath": "   ",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.get_ilu_session_asset_manifest("session-1")
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 404
        assert exc.detail == "ilu session GitHub source is unavailable."
    else:
        raise AssertionError("Expected blank GitHub source fields to be rejected.")


def test_local_session_asset_resolution_restricts_paths(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    robot_root = tmp_path / "robot"
    (robot_root / "meshes").mkdir(parents=True)
    mesh_path = robot_root / "meshes" / "link.stl"
    mesh_path.write_text("solid demo\nendsolid demo\n", encoding="utf-8")

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "local-file",
                    "urdfPath": str(working_urdf_path),
                    "localPath": str(robot_root / "robot.urdf"),
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    working_asset = ilu_session_service.resolve_ilu_session_asset_file(
        "session-1",
        "robot.urdf",
        "working",
    )
    mesh_asset = ilu_session_service.resolve_ilu_session_asset_file(
        "session-1",
        "meshes/link.stl",
        "source",
    )

    assert working_asset.file_path == working_urdf_path
    assert mesh_asset.file_path == mesh_path.resolve()

    try:
        ilu_session_service.resolve_ilu_session_asset_file("session-1", "../etc/passwd", "source")
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected invalid asset path to be rejected")


def test_local_session_asset_resolution_rejects_non_string_asset_inputs(monkeypatch, tmp_path: Path) -> None:
    session_root = tmp_path / "sessions"
    session_dir = session_root / "session-1"
    session_dir.mkdir(parents=True)
    working_urdf_path = session_dir / "working.urdf"
    working_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    robot_root = tmp_path / "robot"
    robot_root.mkdir(parents=True)

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-shared-session",
                "schemaVersion": 1,
                "sessionId": "session-1",
                "createdAt": "2026-03-23T00:00:00Z",
                "updatedAt": "2026-03-23T00:00:01Z",
                "workingUrdfPath": str(working_urdf_path),
                "lastUrdfPath": str(working_urdf_path),
                "loadedSource": {
                    "source": "local-file",
                    "urdfPath": str(working_urdf_path),
                    "localPath": str(robot_root / "robot.urdf"),
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_session_service, "ILU_SESSION_ROOT", session_root)

    try:
        ilu_session_service.resolve_ilu_session_asset_file("session-1", ["robot.urdf"], "working")  # type: ignore[arg-type]
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 400
        assert exc.detail == "Invalid ilu session asset path."
    else:
        raise AssertionError("Expected non-string asset path to be rejected.")

    try:
        ilu_session_service.resolve_ilu_session_asset_file("session-1", "robot.urdf", None)  # type: ignore[arg-type]
    except ilu_session_service.IluSessionError as exc:
        assert exc.status_code == 400
        assert exc.detail == "Invalid ilu session asset kind."
    else:
        raise AssertionError("Expected non-string asset kind to be rejected.")
