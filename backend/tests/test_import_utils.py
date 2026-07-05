from __future__ import annotations

from backend.services.import_utils import (
    module_not_found_matches_any_import_name,
    module_not_found_matches_import_name,
)


def test_module_not_found_matches_exact_import_name() -> None:
    assert module_not_found_matches_import_name("yourdfpy", "yourdfpy") is True


def test_module_not_found_matches_nested_module_under_import_name() -> None:
    assert module_not_found_matches_import_name("datasets.config", "datasets") is True


def test_module_not_found_rejects_unrelated_module_name() -> None:
    assert module_not_found_matches_import_name("pyarrow", "datasets") is False


def test_module_not_found_rejects_missing_name_when_absent() -> None:
    assert module_not_found_matches_import_name(None, "datasets") is False


def test_module_not_found_matches_any_import_name() -> None:
    assert module_not_found_matches_any_import_name(
        "genesis.ext.trimesh",
        ("torch", "genesis"),
    ) is True


def test_module_not_found_matches_any_import_name_rejects_unrelated_names() -> None:
    assert module_not_found_matches_any_import_name(
        "numpy",
        ("torch", "genesis"),
    ) is False
