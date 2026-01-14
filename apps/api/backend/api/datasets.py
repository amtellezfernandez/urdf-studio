from __future__ import annotations

from fastapi import APIRouter

from backend.models.datasets import DatasetMixRequest, DatasetMixResponse
from backend.services.datasets import mix_datasets

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("/mix", response_model=DatasetMixResponse)
def datasets_mix(req: DatasetMixRequest) -> DatasetMixResponse:
    """Mix multiple robot learning datasets."""
    return mix_datasets(req)
