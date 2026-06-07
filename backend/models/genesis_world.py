from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


GenesisDynamicContainerMode = Literal["mesh", "box", "visual-only"]


class GenesisWorldOpenRequest(BaseModel):
    dynamic_container_mode: GenesisDynamicContainerMode = Field(default="mesh")


class GenesisWorldOpenResponse(BaseModel):
    started: bool
    pid: int
    command: list[str]
    dynamic_container_mode: GenesisDynamicContainerMode
