from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from backend.core.paths import BASE_DIR

BLENDER_PATH_ENV = "URDF_STUDIO_BLENDER_PATH"
BLENDER_PORTABLE_VERSION = "4.5.10"
BLENDER_PORTABLE_PLATFORM = "linux-x64"
WINDOWS_DRIVE_PATH_PATTERN = re.compile(r"^([A-Za-z]):[\\/](.+)$")


def resolve_blender_executable(configured_path: str = "") -> str | None:
    explicit_candidate = configured_path.strip() or os.getenv(BLENDER_PATH_ENV, "").strip()
    if explicit_candidate:
        for variant in _candidate_path_variants(explicit_candidate):
            resolved = _resolve_blender_candidate(variant)
            if resolved:
                return resolved
        return None
    for candidate in _blender_executable_candidates():
        resolved = _resolve_blender_candidate(candidate)
        if resolved:
            return resolved
    return None


def _blender_executable_candidates() -> Iterable[str]:
    seen: set[str] = set()
    executable_names = ("blender.exe",) if os.name == "nt" else ("blender",)
    for candidate in (
        *executable_names,
        *_portable_blender_candidates(),
        *_common_macos_blender_candidates(),
        *_common_windows_blender_candidates(),
    ):
        for variant in _candidate_path_variants(candidate):
            if variant and variant not in seen:
                seen.add(variant)
                yield variant


def _candidate_path_variants(candidate: str) -> tuple[str, ...]:
    stripped = candidate.strip()
    if not stripped:
        return ()
    wsl_path = _windows_drive_path_to_wsl_path(stripped)
    if wsl_path == stripped:
        return (stripped,)
    return (stripped, wsl_path)


def _windows_drive_path_to_wsl_path(candidate: str) -> str:
    match = WINDOWS_DRIVE_PATH_PATTERN.match(candidate.strip())
    if not match:
        return candidate
    drive, relative_path = match.groups()
    normalized_relative_path = relative_path.replace("\\", "/").lstrip("/")
    return f"/mnt/{drive.lower()}/{normalized_relative_path}"


def _resolve_blender_candidate(candidate: str) -> str | None:
    path = Path(candidate).expanduser()
    if path.suffix.lower() == ".exe" and os.name != "nt":
        return None
    if path.suffix == ".app" and path.is_dir():
        app_binary = path / "Contents" / "MacOS" / "Blender"
        if _is_usable_blender_executable(app_binary):
            return str(app_binary)
    if path.is_dir():
        executable_names = ("blender.exe",) if os.name == "nt" else ("blender",)
        for executable_name in executable_names:
            executable_path = path / executable_name
            if _is_usable_blender_executable(executable_path):
                return str(executable_path)
    if _is_usable_blender_executable(path):
        return str(path)
    resolved = shutil.which(candidate)
    if resolved and _is_usable_blender_executable(Path(resolved)):
        return resolved
    return None


def _is_executable_file(path: Path) -> bool:
    return (
        path.is_file()
        and path.stat().st_size > 0
        and (os.access(path, os.X_OK) or path.suffix.lower() == ".exe")
    )


@lru_cache(maxsize=16)
def _is_usable_blender_executable(path: Path) -> bool:
    if not _is_executable_file(path):
        return False
    try:
        result = subprocess.run(
            [
                str(path),
                "--background",
                "--python-expr",
                'import bpy; print("blender python runtime ok")',
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=15.0,
        )
    except Exception:
        return False
    output = "\n".join(part for part in (result.stdout, result.stderr) if part)
    return result.returncode == 0 and "blender python runtime ok" in output


def _common_macos_blender_candidates() -> tuple[str, ...]:
    if os.name == "nt":
        return ()
    candidates: list[str] = []
    for root in (Path("/Applications"), Path.home() / "Applications"):
        candidates.extend(str(path) for path in root.glob("Blender*.app/Contents/MacOS/Blender"))
        app_path = root / "Blender.app"
        if app_path.exists():
            candidates.append(str(app_path))
    return tuple(candidates)


def _common_windows_blender_candidates() -> tuple[str, ...]:
    if os.name != "nt":
        return ()
    roots = [
        os.getenv("ProgramFiles", ""),
        os.getenv("ProgramFiles(x86)", ""),
        os.getenv("LOCALAPPDATA", ""),
        "/mnt/c/Program Files",
        "/mnt/c/Program Files (x86)",
        "/mnt/c/Users",
    ]
    candidates: list[str] = []
    for root_value in roots:
        if not root_value:
            continue
        root = Path(root_value).expanduser()
        if not root.exists():
            continue
        if root.name == "Users":
            patterns = (
                "*/AppData/Local/Programs/Blender Foundation/Blender */blender.exe",
                "*/AppData/Local/Blender Foundation/Blender */blender.exe",
            )
        else:
            patterns = (
                "Blender Foundation/Blender */blender.exe",
                "Blender Foundation/Blender/blender.exe",
            )
        for pattern in patterns:
            candidates.extend(str(path) for path in sorted(root.glob(pattern), reverse=True))
    return tuple(candidates)


def _portable_blender_candidates() -> tuple[str, ...]:
    if os.name == "nt" or platform.system().lower() != "linux":
        return ()
    machine = platform.machine().lower()
    if machine not in {"x86_64", "amd64"}:
        return ()
    executable_path = (
        BASE_DIR
        / ".cache"
        / "blender-runtime"
        / f"blender-{BLENDER_PORTABLE_VERSION}-{BLENDER_PORTABLE_PLATFORM}"
        / "blender"
    )
    return (str(executable_path),)
