from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class XacroFile(BaseModel):
    path: str = Field(..., description="Relative file path within the upload tree.")
    content_base64: str = Field(..., description="Base64 encoded file contents.")


class XacroExpandRequest(BaseModel):
    target_path: str = Field(..., description="Path to the xacro file to expand.")
    files: List[XacroFile] = Field(default_factory=list)
    args: Dict[str, str] = Field(default_factory=dict)
    use_inorder: bool = Field(default=True, description="Use xacro --inorder mode.")


class GitHubXacroExpandRequest(BaseModel):
    owner: str = Field(..., min_length=1, description="GitHub repository owner.")
    repo: str = Field(..., min_length=1, description="GitHub repository name.")
    target_path: str = Field(..., min_length=1, description="Repository-relative xacro path.")
    branch: Optional[str] = Field(default=None, description="Optional branch or ref name.")
    access_token: Optional[str] = Field(default=None, description="Optional GitHub token.")
    args: Dict[str, str] = Field(default_factory=dict)
    use_inorder: bool = Field(default=True, description="Use xacro --inorder mode.")


class XacroExpandResponse(BaseModel):
    urdf: str
    stderr: Optional[str] = None
