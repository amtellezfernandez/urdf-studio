from __future__ import annotations

from collections.abc import Iterable


def module_not_found_matches_import_name(missing_name: str | None, import_name: str) -> bool:
    return bool(missing_name) and (
        missing_name == import_name or missing_name.startswith(f"{import_name}.")
    )


def module_not_found_matches_any_import_name(
    missing_name: str | None,
    import_names: Iterable[str],
) -> bool:
    return any(
        module_not_found_matches_import_name(missing_name, import_name)
        for import_name in import_names
    )
