from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from backend.core.settings import settings


class RerunVisualizeRequest(BaseModel):
    episode: Dict[str, Any] = Field(..., description="Episode data as JSON")
    urdf: str = Field(..., description="URDF XML string")
    recording: str = Field(default="lerobot/episode_0", description="Recording name")
    spawn: bool = Field(default=False, description="Spawn desktop viewer")
    serve: bool = Field(default=False, description="Serve web viewer")
    web_port: int = Field(default=settings.rerun_web_port, description="Web viewer port")
    ws_port: int = Field(default=settings.rerun_ws_port, description="WebSocket port")


class RerunVisualizeResponse(BaseModel):
    success: bool
    message: str
    mode: Optional[str] = None
    web_port: Optional[int] = None
    stderr: Optional[str] = None
    stdout: Optional[str] = None
