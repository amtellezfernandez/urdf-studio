from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TypeAlias, TypeVar, cast

from backend.core.paths import BASE_DIR

JsonConfig: TypeAlias = dict[str, object]
DefaultValue = TypeVar("DefaultValue")
APP_CONFIG_PATH = BASE_DIR / "config" / "app.config.json"


def read_app_config(config_path: Path | None = None) -> JsonConfig:
    path = config_path or _default_app_config_path()
    if not path.exists():
        return {}
    try:
        decoded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if not isinstance(decoded, dict):
        return {}
    return cast(JsonConfig, decoded)


def _default_app_config_path() -> Path:
    return APP_CONFIG_PATH


def get_config_value(
    config: Mapping[str, object],
    path: Sequence[str],
    default_value: DefaultValue,
) -> object | DefaultValue:
    current: object = config
    for key in path:
        if not isinstance(current, Mapping) or key not in current:
            return default_value
        current = current[key]
    return current if current is not None else default_value
