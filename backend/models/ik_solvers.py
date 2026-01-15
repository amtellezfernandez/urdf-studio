from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class IkSolverInfo(BaseModel):
    id: str
    label: str
    description: Optional[str] = None
    mode: Optional[str] = None


class IkSolversResponse(BaseModel):
    solvers: List[IkSolverInfo]
    default_chain: List[str]
