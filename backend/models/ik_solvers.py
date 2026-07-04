from __future__ import annotations

from pydantic import BaseModel, Field


class IkSolverInfo(BaseModel):
    id: str
    label: str
    description: str | None = None
    mode: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)


class IkSolversResponse(BaseModel):
    version: str
    solvers: list[IkSolverInfo]
    default_chain: list[str]
