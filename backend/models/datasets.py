from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class DatasetMixRequest(BaseModel):
    repo_ids: List[str] = Field(default_factory=list, description="HuggingFace repo IDs")
    local_paths: List[str] = Field(default_factory=list, description="Local dataset paths")


class DatasetMixResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    output_path: Optional[str] = None
    error: Optional[str] = None
