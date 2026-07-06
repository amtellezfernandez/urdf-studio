from __future__ import annotations

import sys
from pathlib import Path

_VENDOR_DIR = Path(__file__).resolve().parents[2] / "vendor" / "geniesim"


def ensure_geniesim_on_path() -> None:
    """Make the vendored geniesim_benchmark subset importable.

    The vendored files keep their original absolute imports
    (``geniesim_benchmark.plugins...``), so the vendor directory must be first
    on sys.path. Do not pip-install the real geniesim_benchmark package into
    the same environment — the vendored subset intentionally shadows it (see
    backend/vendor/geniesim/VENDORED.md).
    """
    vendor_path = str(_VENDOR_DIR)
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)
