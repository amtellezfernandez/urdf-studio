from __future__ import annotations

import json
from pathlib import Path

from backend.services import ilu_assembly as ilu_assembly_service


def test_get_ilu_assembly_manifest_exposes_files_and_selected_paths(
    monkeypatch, tmp_path: Path
) -> None:
    assembly_root = tmp_path / "assembly-sessions"
    session_dir = assembly_root / "assembly-1"
    workspace_root = session_dir / "files"
    (workspace_root / "base").mkdir(parents=True)
    (workspace_root / "tool" / "meshes").mkdir(parents=True)
    (workspace_root / "base" / "base.urdf").write_text("<robot name='base'/>", encoding="utf-8")
    (workspace_root / "tool" / "tool.urdf").write_text("<robot name='tool'/>", encoding="utf-8")
    (workspace_root / "tool" / "meshes" / "finger.stl").write_text(
        "solid finger\nendsolid finger\n", encoding="utf-8"
    )
    (session_dir / "assembly-session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-assembly-session",
                "schemaVersion": 1,
                "sessionId": "assembly-1",
                "createdAt": "2026-03-26T00:00:00Z",
                "updatedAt": "2026-03-26T00:00:01Z",
                "label": "Bench Assembly",
                "workspaceRoot": str(workspace_root),
                "selectedPaths": ["base/base.urdf", "tool/tool.urdf"],
                "namesByPath": {
                    "base/base.urdf": "base.urdf",
                    "tool/tool.urdf": "tool.urdf",
                },
                "sourceByPath": {
                    "base/base.urdf": {"type": "local", "folder": "base_pkg"},
                    "tool/tool.urdf": {"type": "local", "folder": "tool_pkg"},
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_assembly_service, "ILU_ASSEMBLY_ROOT", assembly_root)

    manifest = ilu_assembly_service.get_ilu_assembly_manifest("assembly-1")
    payload = manifest.model_dump(by_alias=True)

    assert payload["label"] == "Bench Assembly"
    assert payload["selectedPaths"] == ["base/base.urdf", "tool/tool.urdf"]
    assert payload["namesByPath"]["tool/tool.urdf"] == "tool.urdf"
    assert payload["sourceByPath"]["base/base.urdf"] == {"type": "local", "folder": "base_pkg"}
    assert payload["files"] == [
        {
            "path": "base/base.urdf",
            "url": "/ilu-assembly/assembly-1/asset?path=base%2Fbase.urdf",
            "mime": "application/xml",
        },
        {
            "path": "tool/meshes/finger.stl",
            "url": "/ilu-assembly/assembly-1/asset?path=tool%2Fmeshes%2Ffinger.stl",
            "mime": "model/stl",
        },
        {
            "path": "tool/tool.urdf",
            "url": "/ilu-assembly/assembly-1/asset?path=tool%2Ftool.urdf",
            "mime": "application/xml",
        },
    ]


def test_ilu_assembly_asset_resolution_restricts_paths(monkeypatch, tmp_path: Path) -> None:
    assembly_root = tmp_path / "assembly-sessions"
    session_dir = assembly_root / "assembly-1"
    workspace_root = session_dir / "files"
    (workspace_root / "tool").mkdir(parents=True)
    asset_path = workspace_root / "tool" / "tool.urdf"
    asset_path.write_text("<robot name='tool'/>", encoding="utf-8")
    (session_dir / "assembly-session.json").write_text(
        json.dumps(
            {
                "schema": "ilu-assembly-session",
                "schemaVersion": 1,
                "sessionId": "assembly-1",
                "createdAt": "2026-03-26T00:00:00Z",
                "updatedAt": "2026-03-26T00:00:01Z",
                "label": "Bench Assembly",
                "workspaceRoot": str(workspace_root),
                "selectedPaths": ["tool/tool.urdf"],
                "namesByPath": {"tool/tool.urdf": "tool.urdf"},
                "sourceByPath": {"tool/tool.urdf": {"type": "local", "folder": "tool_pkg"}},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ilu_assembly_service, "ILU_ASSEMBLY_ROOT", assembly_root)

    asset = ilu_assembly_service.resolve_ilu_assembly_asset_file("assembly-1", "tool/tool.urdf")
    assert asset.file_path == asset_path.resolve()

    try:
        ilu_assembly_service.resolve_ilu_assembly_asset_file("assembly-1", "../etc/passwd")
    except ilu_assembly_service.IluAssemblyError as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected invalid assembly asset path to be rejected")
