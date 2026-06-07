from __future__ import annotations

import subprocess
import sys

from backend.core.paths import BASE_DIR
from backend.core.settings import settings
from backend.models.genesis_world import (
    GenesisDynamicContainerMode,
    GenesisWorldOpenResponse,
)


def launch_default_genesis_world(
    *,
    dynamic_container_mode: GenesisDynamicContainerMode = "box",
) -> GenesisWorldOpenResponse:
    command = [
        sys.executable,
        "-m",
        "backend.scripts.genesis_world_open",
        "--dynamic-container-mode",
        dynamic_container_mode,
        "--live-state-base-url",
        f"http://127.0.0.1:{settings.api_port}/worlds/genesis",
    ]
    process = subprocess.Popen(
        command,
        cwd=BASE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return GenesisWorldOpenResponse(
        started=True,
        pid=process.pid,
        command=command,
        dynamic_container_mode=dynamic_container_mode,
    )
