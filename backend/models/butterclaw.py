from __future__ import annotations

from pydantic import BaseModel, Field


class ButterClawChatRequest(BaseModel):
    robot_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class ButterClawChatResponse(BaseModel):
    robot_id: str
    accepted: bool
    messages: list[str] = Field(default_factory=list)
    raw_text: str = ""
