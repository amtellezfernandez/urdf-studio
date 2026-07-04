from __future__ import annotations

from pathlib import Path

from backend.core.app_config import get_config_value, read_app_config


def test_read_app_config_loads_json_object(tmp_path: Path) -> None:
    config_path = tmp_path / "app.config.json"
    config_path.write_text(
        '{"web": {"host": "localhost"}, "enabled": true}',
        encoding="utf-8",
    )

    config = read_app_config(config_path)

    assert config == {"web": {"host": "localhost"}, "enabled": True}


def test_read_app_config_returns_empty_object_for_missing_invalid_or_non_object_json(
    tmp_path: Path,
) -> None:
    missing_path = tmp_path / "missing.json"
    invalid_path = tmp_path / "invalid.json"
    list_path = tmp_path / "list.json"
    invalid_path.write_text("{", encoding="utf-8")
    list_path.write_text('["not", "a", "config"]', encoding="utf-8")

    assert read_app_config(missing_path) == {}
    assert read_app_config(invalid_path) == {}
    assert read_app_config(list_path) == {}


def test_get_config_value_reads_nested_value() -> None:
    config = {"web": {"host": "localhost"}}

    assert get_config_value(config, ["web", "host"], "127.0.0.1") == "localhost"


def test_get_config_value_returns_default_for_missing_non_mapping_or_null_value() -> None:
    config = {
        "web": {
            "host": None,
            "port": 5173,
        }
    }

    assert get_config_value(config, ["api", "host"], "127.0.0.1") == "127.0.0.1"
    assert get_config_value(config, ["web", "host"], "127.0.0.1") == "127.0.0.1"
    assert get_config_value(config, ["web", "port", "nested"], 8000) == 8000
