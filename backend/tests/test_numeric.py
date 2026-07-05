from __future__ import annotations

from fractions import Fraction

import numpy as np
import pytest

from backend.services.simulator_adapters.numeric import is_finite_number


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1, True),
        (1.5, True),
        (np.int64(7), True),
        (np.float64(1.25), True),
        (Fraction(3, 2), True),
        (True, False),
        (False, False),
        (float("nan"), False),
        (float("inf"), False),
        ("1.5", False),
        (None, False),
    ],
)
def test_is_finite_number_recognizes_supported_real_scalars(
    value: object,
    expected: bool,
) -> None:
    assert is_finite_number(value) is expected
