from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

IkdLaunchMode = Literal["binary", "cargo", "external"]
IkdRuntimeAction = Literal["start", "stop"]


class IkdRuntimeStatusResponse(BaseModel):
    configured_enabled: bool
    configured_use_for_drag: bool
    running: bool
    pid: int | None = None
    launch_mode: IkdLaunchMode | None = None
    message: str | None = None


class IkdRuntimeActionResponse(IkdRuntimeStatusResponse):
    action: IkdRuntimeAction
