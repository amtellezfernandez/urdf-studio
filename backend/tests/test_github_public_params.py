from __future__ import annotations

import pytest

from backend.services import github_public_params


def test_read_int_env_accepts_positive_integer_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URDF_TEST_PUBLIC_INT", "42")

    assert github_public_params._read_int_env("URDF_TEST_PUBLIC_INT", 7) == 42


@pytest.mark.parametrize("raw_value", ["0", "-1", "bad"])
def test_read_int_env_rejects_non_positive_or_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str,
) -> None:
    monkeypatch.setenv("URDF_TEST_PUBLIC_INT", raw_value)

    assert github_public_params._read_int_env("URDF_TEST_PUBLIC_INT", 7) == 7


def test_read_int_env_rejects_boolean_like_non_string_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        github_public_params.os,
        "getenv",
        lambda name: True if name == "URDF_TEST_PUBLIC_INT" else None,
    )

    assert github_public_params._read_int_env("URDF_TEST_PUBLIC_INT", 7) == 7


def test_read_int_env_rejects_type_error_from_env_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        github_public_params.os,
        "getenv",
        lambda name: object() if name == "URDF_TEST_PUBLIC_INT" else None,
    )

    assert github_public_params._read_int_env("URDF_TEST_PUBLIC_INT", 7) == 7
