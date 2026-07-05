from __future__ import annotations

from pathlib import Path

import pytest

from backend.services import ilu_gallery_params


def test_read_positive_float_env_accepts_positive_finite_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("URDF_TEST_GALLERY_FLOAT", "12.5")

    assert ilu_gallery_params._read_positive_float_env("URDF_TEST_GALLERY_FLOAT", 3.0) == 12.5


@pytest.mark.parametrize("raw_value", ["nan", "inf", "-inf", "0", "-3", "bad"])
def test_read_positive_float_env_rejects_non_positive_or_non_finite_values(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str,
) -> None:
    monkeypatch.setenv("URDF_TEST_GALLERY_FLOAT", raw_value)

    assert ilu_gallery_params._read_positive_float_env("URDF_TEST_GALLERY_FLOAT", 3.0) == 3.0


def test_read_positive_int_env_rejects_non_positive_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("URDF_TEST_GALLERY_INT", "0")

    assert ilu_gallery_params._read_positive_int_env("URDF_TEST_GALLERY_INT", 4) == 4


def test_read_bool_env_supports_common_true_false_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("URDF_TEST_GALLERY_BOOL", "yes")
    assert ilu_gallery_params._read_bool_env("URDF_TEST_GALLERY_BOOL", False) is True

    monkeypatch.setenv("URDF_TEST_GALLERY_BOOL", "off")
    assert ilu_gallery_params._read_bool_env("URDF_TEST_GALLERY_BOOL", True) is False


def test_read_path_env_expands_user_paths(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("URDF_TEST_GALLERY_PATH", "~/gallery-cache")

    assert ilu_gallery_params._read_path_env(
        "URDF_TEST_GALLERY_PATH",
        Path("/fallback"),
    ) == (tmp_path / "gallery-cache").resolve(strict=False)
