from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Response, UploadFile

from backend.models.dataset_alignment import (
    DatasetRepresentationValidationRequest,
    DatasetRepresentationValidationResponse,
    EmbodimentRef,
    EmbodimentResolveRequest,
    EmbodimentResolveResponse,
    MappingListQuery,
    MappingSpec,
)
from backend.models.datasets import (
    DatasetLocalExportResponse,
    DatasetMixRequest,
    DatasetTreatmentAnalysisResponse,
)
from backend.services.dataset_alignment import get_dataset_alignment_service
from backend.services.dataset_local_exports import (
    DatasetLocalExportError,
    extract_lerobot_archive_for_ops,
)
from backend.services.dataset_treatments import analyze_dataset_treatment
from backend.services.dataset_source_contract import normalize_local_dataset_paths

router = APIRouter(prefix="/datasets", tags=["datasets"])

HF_PROXY_ALLOWED_HOSTS = frozenset(
    {
        "huggingface.co",
        "datasets-server.huggingface.co",
    }
)
HF_PROXY_TIMEOUT_SECONDS = 30
HF_PROXY_USER_AGENT = "urdf-studio-hf-proxy/1.0"
HF_PROXY_CONTENT_TYPE_FALLBACK = "application/octet-stream"


def _validate_hf_proxy_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in HF_PROXY_ALLOWED_HOSTS:
        raise HTTPException(
            status_code=400,
            detail="HF proxy only supports HTTPS requests to approved Hugging Face hosts.",
        )
    return parsed


@router.get("/hf-proxy")
async def hf_proxy(
    url: str = Query(..., min_length=1),
    authorization: str | None = Header(default=None),
) -> Response:
    parsed = _validate_hf_proxy_url(url)
    headers = {
        "Accept": "*/*",
        "User-Agent": HF_PROXY_USER_AGENT,
    }
    if authorization:
        headers["Authorization"] = authorization

    request = urllib.request.Request(
        urllib.parse.urlunparse(parsed),
        headers=headers,
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=HF_PROXY_TIMEOUT_SECONDS) as upstream:
            body = upstream.read()
            content_type = upstream.headers.get(
                "Content-Type",
                HF_PROXY_CONTENT_TYPE_FALLBACK,
            )
            return Response(
                content=body,
                status_code=upstream.status,
                media_type=content_type,
            )
    except urllib.error.HTTPError as error:
        body = error.read()
        content_type = error.headers.get(
            "Content-Type",
            HF_PROXY_CONTENT_TYPE_FALLBACK,
        )
        return Response(
            content=body,
            status_code=error.code,
            media_type=content_type,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Hugging Face resource: {error}",
        ) from error


@router.post(
    "/local-exports",
    response_model=DatasetLocalExportResponse,
)
async def create_local_dataset_export(
    archive: UploadFile = File(...),
    dataset_name: str = Form(default=""),
) -> DatasetLocalExportResponse:
    try:
        result = extract_lerobot_archive_for_ops(
            await archive.read(),
            dataset_name=dataset_name,
        )
    except DatasetLocalExportError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return DatasetLocalExportResponse(
        datasetPath=str(result.dataset_path),
        datasetName=result.dataset_name,
        fileCount=result.file_count,
    )


@router.post(
    "/treatments/analyze",
    response_model=DatasetTreatmentAnalysisResponse,
)
async def analyze_dataset_treatments(
    req: DatasetMixRequest,
) -> DatasetTreatmentAnalysisResponse:
    return analyze_dataset_treatment(
        req,
        normalize_local_dataset_paths(req.local_paths),
    )


@router.post("/embodiments/resolve", response_model=EmbodimentResolveResponse)
async def resolve_embodiment(req: EmbodimentResolveRequest) -> EmbodimentResolveResponse:
    return get_dataset_alignment_service().resolve_embodiment(req)


@router.get("/embodiments", response_model=list[EmbodimentRef])
async def list_embodiments() -> list[EmbodimentRef]:
    return get_dataset_alignment_service().list_embodiments()


@router.post("/mappings", response_model=MappingSpec)
async def upsert_mapping(req: MappingSpec) -> MappingSpec:
    return get_dataset_alignment_service().upsert_mapping(req)


@router.get("/mappings", response_model=list[MappingSpec])
async def list_mappings(
    source_embodiment_id: str | None = Query(default=None),
    source_representation_id: str | None = Query(default=None),
    target_embodiment_id: str | None = Query(default=None),
    target_representation_id: str | None = Query(default=None),
) -> list[MappingSpec]:
    return get_dataset_alignment_service().list_mappings(
        MappingListQuery(
            source_embodiment_id=source_embodiment_id,
            source_representation_id=source_representation_id,
            target_embodiment_id=target_embodiment_id,
            target_representation_id=target_representation_id,
        )
    )


@router.post(
    "/representations/validate",
    response_model=DatasetRepresentationValidationResponse,
)
async def validate_representations(
    req: DatasetRepresentationValidationRequest,
) -> DatasetRepresentationValidationResponse:
    return get_dataset_alignment_service().validate_dataset_representations(req)
