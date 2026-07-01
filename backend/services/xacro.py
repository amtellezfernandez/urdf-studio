from __future__ import annotations

from fastapi import HTTPException

from backend.models.xacro import XacroExpandRequest
from backend.services.ilu_urdf import (
    IluUrdfBridgeError,
    expand_xacro as expand_xacro_via_ilu,
)


def expand_xacro(request: XacroExpandRequest) -> tuple[str, str | None]:
    try:
        return expand_xacro_via_ilu(request)
    except IluUrdfBridgeError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
