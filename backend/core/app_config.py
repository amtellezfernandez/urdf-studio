from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_app_config() -> dict:
    root_dir = Path(__file__).resolve().parents[2]
    config_path = root_dir / "config" / "app.config.json"
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def get_config_value(config: dict, path: list[str], fallback: Any) -> Any:
    current: Any = config
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return fallback
        current = current[key]
    return current if current is not None else fallback
