from __future__ import annotations

import os
from typing import Mapping


ISAAC_EULA_ENV = "OMNI_KIT_ACCEPT_EULA"


def isaac_eula_accepted(env: Mapping[str, str] | None = None) -> bool:
    env = env or os.environ
    return env.get(ISAAC_EULA_ENV, "").strip().upper() == "YES"
