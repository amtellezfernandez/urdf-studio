from __future__ import annotations

from fastapi import APIRouter

from backend.models.samples import SampleFilesResponse, SamplesResponse
from backend.services.samples import list_samples, load_sample_files

router = APIRouter(prefix="/samples", tags=["samples"])


@router.get("", response_model=SamplesResponse)
async def list_sample_catalog() -> SamplesResponse:
    quickstart_id, entries = list_samples()
    return SamplesResponse(quickstart_id=quickstart_id, samples=entries)


@router.get("/quickstart", response_model=SampleFilesResponse)
async def get_quickstart_sample() -> SampleFilesResponse:
    quickstart_id, _ = list_samples()
    sample_id = quickstart_id or "so-arm100"
    return load_sample_files(sample_id)


@router.get("/{sample_id}", response_model=SampleFilesResponse)
async def get_sample_by_id(sample_id: str) -> SampleFilesResponse:
    return load_sample_files(sample_id)
