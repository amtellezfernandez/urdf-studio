from __future__ import annotations

import re
import subprocess
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_PYBULLET_ID, SimulatorId
from backend.services.simulator_adapters.workspace_package import read_log_tail

WORKSPACE_DIAGNOSTIC_LOG_TAIL_CHARS = 16_000
OPENGL_PROBE_TIMEOUT_SEC = 2.0
PYBULLET_SOFTWARE_OPENGL_RENDERERS = (
    "llvmpipe",
    "softpipe",
    "software rasterizer",
    "swrast",
)
PYBULLET_HARDWARE_OPENGL_DIAGNOSTIC_NAME = "hardware OpenGL"
PYBULLET_OPENGL_RENDERER_PATTERNS = (
    re.compile(r"^GL_RENDERER=(?P<renderer>.+)$", re.MULTILINE),
    re.compile(r"^Renderer\s*=\s*(?P<renderer>.+)$", re.MULTILINE),
    re.compile(r"^OpenGL renderer string:\s*(?P<renderer>.+)$", re.MULTILINE),
)


def read_workspace_launch_warnings(
    simulator_id: SimulatorId,
    log_path: Path,
) -> list[str]:
    if simulator_id != SIMULATOR_PYBULLET_ID:
        return []
    return list(_pybullet_log_warnings(log_path))


def pybullet_runtime_opengl_warnings(
    *,
    workspace_root: Path,
    log_name: str,
) -> tuple[str, ...]:
    glxinfo_renderer = pybullet_glxinfo_renderer()
    if glxinfo_renderer is not None:
        return _pybullet_renderer_warnings_from_optional_renderer(glxinfo_renderer)
    return pybullet_latest_workspace_log_warnings(
        workspace_root=workspace_root,
        log_name=log_name,
    )


def pybullet_latest_workspace_log_warnings(
    *,
    workspace_root: Path,
    log_name: str,
) -> tuple[str, ...]:
    log_path = latest_workspace_log_path(
        workspace_root=workspace_root,
        log_name=log_name,
    )
    if log_path is None:
        return ()
    return _pybullet_log_warnings(log_path)


def latest_workspace_log_path(*, workspace_root: Path, log_name: str) -> Path | None:
    try:
        candidate_paths = tuple(workspace_root.glob(f"workspace-*/{log_name}"))
    except OSError:
        return None
    return _latest_existing_path_by_mtime(candidate_paths)


def pybullet_glxinfo_warnings() -> tuple[str, ...]:
    return _pybullet_renderer_warnings_from_optional_renderer(pybullet_glxinfo_renderer())


def pybullet_glxinfo_renderer() -> str | None:
    try:
        process = subprocess.run(
            ["glxinfo", "-B"],
            capture_output=True,
            text=True,
            timeout=OPENGL_PROBE_TIMEOUT_SEC,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if process.returncode != 0:
        return None
    return _pybullet_opengl_renderer(f"{process.stdout}\n{process.stderr}")


def pybullet_opengl_warnings(log_text: str) -> tuple[str, ...]:
    return _pybullet_renderer_warnings_from_optional_renderer(_pybullet_opengl_renderer(log_text))


def _pybullet_log_warnings(log_path: Path) -> tuple[str, ...]:
    return pybullet_opengl_warnings(
        read_log_tail(log_path, tail_chars=WORKSPACE_DIAGNOSTIC_LOG_TAIL_CHARS)
    )


def _latest_existing_path_by_mtime(candidate_paths: tuple[Path, ...]) -> Path | None:
    latest_path: Path | None = None
    latest_mtime = float("-inf")
    for path in candidate_paths:
        path_mtime = _existing_path_mtime(path)
        if path_mtime is None:
            continue
        if path_mtime > latest_mtime:
            latest_path = path
            latest_mtime = path_mtime
    return latest_path


def _existing_path_mtime(path: Path) -> float | None:
    try:
        if not path.is_file():
            return None
        return path.stat().st_mtime
    except OSError:
        return None


def _pybullet_renderer_warnings_from_optional_renderer(renderer: str | None) -> tuple[str, ...]:
    if renderer is None:
        return ()
    return _pybullet_renderer_warnings(renderer)


def _pybullet_renderer_warnings(renderer: str) -> tuple[str, ...]:
    renderer_lower = renderer.lower()
    if not any(token in renderer_lower for token in PYBULLET_SOFTWARE_OPENGL_RENDERERS):
        return ()
    return (
        "PyBullet GUI is using software OpenGL "
        f"({renderer}). Mouse and camera interaction can be very slow; "
        "enable GPU OpenGL for the display server or use another simulator target.",
    )


def _pybullet_opengl_renderer(log_text: str) -> str | None:
    for pattern in PYBULLET_OPENGL_RENDERER_PATTERNS:
        match = pattern.search(log_text)
        if match is not None:
            renderer = match.group("renderer").strip()
            if renderer:
                return renderer
    return None
