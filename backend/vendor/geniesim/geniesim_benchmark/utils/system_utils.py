# URDF Studio shim — NOT part of the vendored Genie Sim sources.
#
# Replaces Genie Sim's utils/system_utils.py (which resolves paths inside the
# geniesim_assets pip package and SIM_REPO_ROOT) with URDF-Studio-local
# resolution. Only the functions the vendored subset actually calls are
# provided: benchmark_conf_path() and app_root_path().
from __future__ import annotations

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4].parent

SCENARIO_CONF_ENV_VAR = "URDF_SCENARIO_CONF_PATH"


def benchmark_conf_path() -> str:
    """Directory holding scenario/task configuration (Genie Sim: benchmark conf dir)."""
    override = os.environ.get(SCENARIO_CONF_ENV_VAR, "").strip()
    if override:
        return override
    return str(_REPO_ROOT / "scenarios")


def app_root_path() -> str:
    """Directory holding robot configuration (Genie Sim: app root)."""
    return benchmark_conf_path()
