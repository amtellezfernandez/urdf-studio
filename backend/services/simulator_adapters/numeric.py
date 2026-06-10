from __future__ import annotations

import math
from typing import Any


def is_finite_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
