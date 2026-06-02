from __future__ import annotations

import json
import subprocess

from backend.models.xacro import GitHubXacroExpandRequest
from backend.services.ilu_urdf import expand_github_xacro


def test_expand_github_xacro_uses_load_source_bridge(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("backend.services.ilu_urdf.resolve_server_github_token", lambda token=None: "server-token")

    def _fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        payload = {
            "urdf": "<robot name=\"demo\"/>",
            "ref": "main",
            "entryPath": "urdf/demo.xacro",
            "runtime": "python-xacro",
        }
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_urdf.subprocess.run", _fake_run)

    urdf, stderr = expand_github_xacro(
        GitHubXacroExpandRequest(
            owner="acme",
            repo="demo_robot",
            target_path="urdf/demo.xacro",
            branch="main",
            access_token="token",
        )
    )

    assert calls[0][-1] == "load-source-github"
    assert urdf == "<robot name=\"demo\"/>"
    assert stderr is None
