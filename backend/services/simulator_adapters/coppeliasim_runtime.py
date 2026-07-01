from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Mapping


COPPELIASIM_EXECUTABLE_ENV = "URDF_STUDIO_COPPELIASIM_PATH"
COPPELIASIM_ROOT_ENV = "COPPELIASIM_ROOT"
COPPELIASIM_REMOTE_ENV = "URDF_STUDIO_COPPELIASIM_REMOTE"
COPPELIASIM_HOST_ENV = "URDF_STUDIO_COPPELIASIM_HOST"
COPPELIASIM_PORT_ENV = "URDF_STUDIO_COPPELIASIM_PORT"
DEFAULT_COPPELIASIM_PORT = 23000

_EXECUTABLE_NAMES = (
    "coppeliaSim.sh",
    "coppeliaSim",
    "coppeliasim",
    "CoppeliaSim",
)


def coppeliasim_remote_configured(env: Mapping[str, str] | None = None) -> bool:
    env = env or os.environ
    value = env.get(COPPELIASIM_REMOTE_ENV, "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


def coppeliasim_host(env: Mapping[str, str] | None = None) -> str:
    env = env or os.environ
    return env.get(COPPELIASIM_HOST_ENV, "127.0.0.1").strip() or "127.0.0.1"


def coppeliasim_port(env: Mapping[str, str] | None = None) -> int:
    env = env or os.environ
    raw_port = env.get(COPPELIASIM_PORT_ENV, "").strip()
    if not raw_port:
        return DEFAULT_COPPELIASIM_PORT
    try:
        return int(raw_port)
    except ValueError:
        return DEFAULT_COPPELIASIM_PORT


def resolve_coppeliasim_executable(env: Mapping[str, str] | None = None) -> Path | None:
    env = env or os.environ
    explicit = env.get(COPPELIASIM_EXECUTABLE_ENV, "").strip()
    if explicit:
        resolved = _resolve_coppeliasim_path(Path(explicit))
        if resolved is not None:
            return resolved
    root = env.get(COPPELIASIM_ROOT_ENV, "").strip()
    if root:
        resolved = _resolve_coppeliasim_path(Path(root))
        if resolved is not None:
            return resolved
    for name in _EXECUTABLE_NAMES:
        path = shutil.which(name)
        if path:
            return Path(path)
    return None


def _resolve_coppeliasim_path(path: Path) -> Path | None:
    if path.is_file():
        return path
    if not path.is_dir():
        return None
    for name in _EXECUTABLE_NAMES:
        candidate = path / name
        if candidate.is_file():
            return candidate
    return None
