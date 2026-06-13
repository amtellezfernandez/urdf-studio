from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Iterable

BLENDER_PATH_ENV = "URDF_STUDIO_BLENDER_PATH"


def resolve_blender_executable(configured_path: str = "") -> str | None:
    for candidate in _blender_executable_candidates(configured_path):
        resolved = _resolve_blender_candidate(candidate)
        if resolved:
            return resolved
    return None


def _blender_executable_candidates(configured_path: str = "") -> Iterable[str]:
    seen: set[str] = set()
    for candidate in (
        configured_path.strip(),
        os.getenv(BLENDER_PATH_ENV, "").strip(),
        "blender",
        "blender.exe",
        *_common_macos_blender_candidates(),
        *_common_windows_blender_candidates(),
    ):
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _resolve_blender_candidate(candidate: str) -> str | None:
    path = Path(candidate).expanduser()
    if path.suffix == ".app" and path.is_dir():
        app_binary = path / "Contents" / "MacOS" / "Blender"
        if _is_executable_file(app_binary):
            return str(app_binary)
    if _is_executable_file(path):
        return str(path)
    resolved = shutil.which(candidate)
    if resolved and _is_executable_file(Path(resolved)):
        return resolved
    return None


def _is_executable_file(path: Path) -> bool:
    return path.is_file() and (os.access(path, os.X_OK) or path.suffix.lower() == ".exe")


def _common_macos_blender_candidates() -> tuple[str, ...]:
    candidates: list[str] = []
    for root in (Path("/Applications"), Path.home() / "Applications"):
        candidates.extend(str(path) for path in root.glob("Blender*.app/Contents/MacOS/Blender"))
        app_path = root / "Blender.app"
        if app_path.exists():
            candidates.append(str(app_path))
    return tuple(candidates)


def _common_windows_blender_candidates() -> tuple[str, ...]:
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
