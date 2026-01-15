from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class SampleEntry(BaseModel):
    id: str
    label: str
    urdf_path: str


class SampleFile(BaseModel):
    path: str
    content_base64: str
    mime: str


class SampleFilesResponse(BaseModel):
    id: str
    label: str
    urdf_path: str
    files: List[SampleFile]


class SamplesResponse(BaseModel):
    quickstart_id: Optional[str] = None
    samples: List[SampleEntry]
