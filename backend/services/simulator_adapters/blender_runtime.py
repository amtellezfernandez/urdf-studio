from __future__ import annotations

import os
import shutil
from pathlib import Path

BLENDER_PATH_ENV = "URDF_STUDIO_BLENDER_PATH"


def resolve_blender_executable(configured_path: str = "") -> str | None:
    candidates = [
        configured_path.strip(),
        os.getenv(BLENDER_PATH_ENV, "").strip(),
        shutil.which("blender") or "",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.exists():
            return str(path)
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None
