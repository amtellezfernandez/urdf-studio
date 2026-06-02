from __future__ import annotations

import subprocess
from pathlib import Path

from backend.services import github_auth


def _isolate_gh_hosts(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(github_auth, "GH_HOSTS_PATH", tmp_path / "missing-hosts.yml")


def test_resolve_server_github_token_prefers_explicit_token(monkeypatch) -> None:
    monkeypatch.setenv("URDF_GITHUB_TOKEN", "env-token")
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)

    assert github_auth.resolve_server_github_token("explicit-token") == "explicit-token"


def test_resolve_server_github_token_uses_env_before_gh(monkeypatch) -> None:
    monkeypatch.setenv("URDF_GITHUB_TOKEN", "env-token")
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)
    monkeypatch.setattr(
        "backend.services.github_auth.subprocess.run",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("gh should not be queried")),
    )

    assert github_auth.resolve_server_github_token() == "env-token"


def test_resolve_server_github_token_falls_back_to_gh_cli(monkeypatch) -> None:
    monkeypatch.delenv("URDF_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)

    def _fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout="gh-token\n", stderr="")

    monkeypatch.setattr("backend.services.github_auth.subprocess.run", _fake_run)

    assert github_auth.resolve_server_github_token() == "gh-token"


def test_get_server_github_auth_status_reports_gh_cli(monkeypatch) -> None:
    monkeypatch.delenv("URDF_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)

    def _fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout="gh-token\n", stderr="")

    monkeypatch.setattr("backend.services.github_auth.subprocess.run", _fake_run)

    status = github_auth.get_server_github_auth_status()

    assert status.available is True
    assert status.mode == "gh-cli"


def test_get_server_github_auth_status_reports_none_without_env_or_gh(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("URDF_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)
    _isolate_gh_hosts(monkeypatch, tmp_path)

    def _fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 1, stdout="", stderr="not logged in")

    monkeypatch.setattr("backend.services.github_auth.subprocess.run", _fake_run)

    status = github_auth.get_server_github_auth_status()

    assert status.available is False
    assert status.mode == "none"


def test_resolve_server_github_token_caches_failed_gh_lookup(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("URDF_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)
    _isolate_gh_hosts(monkeypatch, tmp_path)

    calls = {"count": 0}

    def _fake_run(*args, **kwargs):
        calls["count"] += 1
        return subprocess.CompletedProcess(args[0], 1, stdout="", stderr="not logged in")

    monkeypatch.setattr("backend.services.github_auth.subprocess.run", _fake_run)

    assert github_auth.resolve_server_github_token() is None
    assert github_auth.resolve_server_github_token() is None
    assert calls["count"] == 1


def test_resolve_server_github_token_falls_back_to_gh_hosts_file_when_cli_token_command_is_unavailable(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("URDF_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "_gh_auth_cache", None)
    monkeypatch.setattr(github_auth, "GH_HOSTS_PATH", tmp_path / "hosts.yml")
    github_auth.GH_HOSTS_PATH.write_text(
        "github.com:\n"
        "  user: octocat\n"
        "  oauth_token: hosts-token\n"
        "  git_protocol: https\n",
        encoding="utf-8",
    )

    def _fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args[0],
            1,
            stdout='unknown command "token" for "gh auth"\n',
            stderr="",
        )

    monkeypatch.setattr("backend.services.github_auth.subprocess.run", _fake_run)

    assert github_auth.resolve_server_github_token() == "hosts-token"
