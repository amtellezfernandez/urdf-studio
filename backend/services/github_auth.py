from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


GitHubServerAuthMode = Literal["env-token", "gh-cli", "none"]


GH_BIN = os.getenv("URDF_GH_BIN", "gh").strip() or "gh"
GH_AUTH_TIMEOUT_SECONDS = float(os.getenv("URDF_GH_AUTH_TIMEOUT_SECONDS", "5"))
GH_AUTH_CACHE_TTL_SECONDS = float(os.getenv("URDF_GH_AUTH_CACHE_TTL_SECONDS", "60"))
GH_AUTH_HOST = os.getenv("URDF_GH_AUTH_HOST", "github.com").strip() or "github.com"
GH_HOSTS_PATH = Path(
    os.getenv("URDF_GH_HOSTS_PATH", str(Path.home() / ".config" / "gh" / "hosts.yml"))
)


@dataclass(frozen=True)
class GitHubServerAuthStatus:
    mode: GitHubServerAuthMode
    available: bool


@dataclass
class _GhAuthCacheEntry:
    expires_at: float
    token: str | None


_gh_auth_cache: _GhAuthCacheEntry | None = None


def _normalize_token(value: str | None) -> str | None:
    trimmed = (value or "").strip()
    return trimmed or None


def _get_env_github_token() -> str | None:
    return _normalize_token(os.getenv("URDF_GITHUB_TOKEN"))


def _read_gh_hosts_token(host: str = GH_AUTH_HOST) -> str | None:
    try:
        raw_text = GH_HOSTS_PATH.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    active_host: str | None = None
    for raw_line in raw_text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        if indent == 0 and stripped.endswith(":"):
            active_host = stripped[:-1].strip().strip("'\"")
            continue
        if active_host != host or indent <= 0:
            continue
        key, separator, value = stripped.partition(":")
        if separator and key.strip() == "oauth_token":
            return _normalize_token(value.strip().strip("'\""))
    return None


def _read_gh_auth_token() -> str | None:
    global _gh_auth_cache

    cached = _gh_auth_cache
    now = time.time()
    if cached is not None and now < cached.expires_at:
        return cached.token

    token: str | None = None
    try:
        result = subprocess.run(
            [GH_BIN, "auth", "token"],
            capture_output=True,
            text=True,
            timeout=GH_AUTH_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode == 0:
            token = _normalize_token(result.stdout)
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        token = None
    if token is None:
        token = _read_gh_hosts_token()

    _gh_auth_cache = _GhAuthCacheEntry(
        expires_at=now + GH_AUTH_CACHE_TTL_SECONDS,
        token=token,
    )
    return token


def resolve_server_github_token(explicit_token: str | None = None) -> str | None:
    normalized_explicit = _normalize_token(explicit_token)
    if normalized_explicit:
        return normalized_explicit

    env_token = _get_env_github_token()
    if env_token:
        return env_token

    return _read_gh_auth_token()


def get_server_github_auth_status() -> GitHubServerAuthStatus:
    if _get_env_github_token():
        return GitHubServerAuthStatus(mode="env-token", available=True)
    if _read_gh_auth_token():
        return GitHubServerAuthStatus(mode="gh-cli", available=True)
    return GitHubServerAuthStatus(mode="none", available=False)
