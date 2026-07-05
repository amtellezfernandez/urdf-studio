from __future__ import annotations

import math
from numbers import Real


def is_finite_number(value: object) -> bool:
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value)
