from __future__ import annotations

import platform
import sys
from importlib import metadata


def _package_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def environment_fingerprint(backend_id: str | None = None) -> dict:
    """Versions and platform facts embedded in run artifacts for reproducibility."""
    fingerprint: dict = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            name: version
            for name, version in {
                "mujoco": _package_version("mujoco"),
                "genesis-world": _package_version("genesis-world"),
                "usd-core": _package_version("usd-core"),
                "numpy": _package_version("numpy"),
                "scipy": _package_version("scipy"),
            }.items()
            if version is not None
        },
    }
    if backend_id is not None:
        fingerprint["backend_id"] = backend_id
    return fingerprint
