from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class IkdRuntimeStatusResponse(BaseModel):
    configured_enabled: bool
    configured_use_for_drag: bool
    running: bool
    pid: Optional[int] = None
    launch_mode: Optional[str] = None
    message: Optional[str] = None


class IkdRuntimeActionResponse(IkdRuntimeStatusResponse):
    action: Literal["start", "stop"]

