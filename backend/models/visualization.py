from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class RerunVisualizeRequest(BaseModel):
    episode: Dict[str, Any] = Field(..., description="Episode data as JSON")
    urdf: str = Field(..., description="URDF XML string")
    recording: str = Field(default="lerobot/episode_0", description="Recording name")
    spawn: bool = Field(default=False, description="Spawn desktop viewer")
    serve: bool = Field(default=False, description="Serve web viewer")
    web_port: int = Field(default=9090, description="Web viewer port")
    ws_port: int = Field(default=9876, description="WebSocket port")


class RerunVisualizeResponse(BaseModel):
    success: bool
    message: str
    mode: Optional[str] = None
    web_port: Optional[int] = None
    stderr: Optional[str] = None
    stdout: Optional[str] = None
