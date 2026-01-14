from __future__ import annotations

from pathlib import Path

# Resolve directories relative to backend package
BACKEND_DIR = Path(__file__).resolve().parents[1]
BASE_DIR = BACKEND_DIR.parent
SCRIPTS_DIR = BACKEND_DIR / "scripts"
