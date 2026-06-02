from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from backend.models.xacro import (
    GitHubXacroExpandRequest,
    XacroExpandRequest,
    XacroExpandResponse,
)
from backend.models.ilu_gallery import (
    IluGalleryJobCreateRequest,
    IluGalleryJobGenerateRequest,
    IluGalleryJobMetadataUpdateRequest,
    IluGalleryPublishResponse,
    IluGalleryJobResponse,
    IluGalleryPrDraftResponse,
    IluGalleryRepoPreviewRequest,
    IluGalleryRepoPreviewResponse,
    IluGallerySource,
)
from backend.services.ilu_gallery import (
    build_gallery_job_bundle,
    build_gallery_job_pr_draft,
    create_gallery_job,
    generate_gallery_job,
    get_gallery_repo_preview,
    get_gallery_job,
    publish_gallery_job,
    read_gallery_job_asset_file,
    read_gallery_thumbnail_file,
    update_gallery_job_metadata,
)
from backend.services.ilu_repo_source import (
    GitHubPublicProxyError,
    fetch_file_bytes,
    list_repo_candidates,
    list_repo_contents,
)
from backend.services.github_auth import get_server_github_auth_status
from backend.services.xacro import expand_github_xacro, expand_xacro


router = APIRouter(prefix="/ilu", tags=["ilu"])


@router.get("/github-auth-status")
async def get_ilu_github_auth_status() -> dict:
    status = get_server_github_auth_status()
    return {
        "available": status.available,
        "mode": status.mode,
    }


@router.post("/gallery/jobs", response_model=IluGalleryJobResponse)
async def create_ilu_gallery_job(payload: IluGalleryJobCreateRequest) -> IluGalleryJobResponse:
    try:
        return create_gallery_job(payload)
    except GitHubPublicProxyError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@router.get("/gallery/jobs/{job_id}", response_model=IluGalleryJobResponse)
async def get_ilu_gallery_job(job_id: str) -> IluGalleryJobResponse:
    try:
        return get_gallery_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error


@router.post("/gallery/jobs/{job_id}/generate", response_model=IluGalleryJobResponse)
async def generate_ilu_gallery_job(job_id: str, payload: IluGalleryJobGenerateRequest) -> IluGalleryJobResponse:
    try:
        return generate_gallery_job(job_id, payload)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.patch("/gallery/jobs/{job_id}/metadata", response_model=IluGalleryJobResponse)
async def update_ilu_gallery_job_metadata(
    job_id: str, payload: IluGalleryJobMetadataUpdateRequest
) -> IluGalleryJobResponse:
    try:
        return update_gallery_job_metadata(job_id, payload)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/gallery/jobs/{job_id}/bundle")
async def download_ilu_gallery_job_bundle(job_id: str) -> Response:
    try:
        bundle_bytes, file_name = build_gallery_job_bundle(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    return Response(
        content=bundle_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/gallery/jobs/{job_id}/thumbnail")
async def get_ilu_gallery_job_thumbnail(job_id: str, item_id: str = Query(..., min_length=1)) -> Response:
    try:
        content, media_type = read_gallery_thumbnail_file(job_id, item_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Gallery thumbnail not found.") from error
    return Response(content=content, media_type=media_type)


@router.get("/gallery/jobs/{job_id}/asset")
async def get_ilu_gallery_job_asset(
    job_id: str,
    item_id: str = Query(..., min_length=1),
    kind: str = Query(..., min_length=1),
) -> Response:
    try:
        content, media_type = read_gallery_job_asset_file(job_id, item_id, kind)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Gallery asset not found.") from error
    return Response(content=content, media_type=media_type)


@router.get("/gallery/jobs/{job_id}/pr-draft", response_model=IluGalleryPrDraftResponse)
async def get_ilu_gallery_job_pr_draft(job_id: str) -> IluGalleryPrDraftResponse:
    try:
        return build_gallery_job_pr_draft(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/gallery/jobs/{job_id}/publish", response_model=IluGalleryPublishResponse)
async def publish_ilu_gallery_job(job_id: str) -> IluGalleryPublishResponse:
    try:
        return publish_gallery_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Gallery job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/repo-contents")
async def get_ilu_repo_contents(
    owner: str = Query(..., min_length=1),
    repo: str = Query(..., min_length=1),
    path: str = Query(""),
    branch: str | None = Query(None),
) -> list[dict]:
    try:
        return list_repo_contents(owner=owner, repo=repo, path=path, branch=branch)
    except GitHubPublicProxyError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@router.get("/repo-candidates")
async def get_ilu_repo_candidates(
    owner: str = Query(..., min_length=1),
    repo: str = Query(..., min_length=1),
    path: str = Query(""),
    branch: str | None = Query(None),
) -> dict:
    try:
        return list_repo_candidates(owner=owner, repo=repo, path=path, branch=branch)
    except GitHubPublicProxyError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@router.get("/repo-gallery-preview", response_model=IluGalleryRepoPreviewResponse)
async def get_ilu_repo_gallery_preview(
    owner: str = Query(..., min_length=1),
    repo: str = Query(..., min_length=1),
    path: str = Query(""),
    branch: str | None = Query(None),
) -> IluGalleryRepoPreviewResponse:
    return get_gallery_repo_preview(
        IluGallerySource(
            owner=owner,
            repo=repo,
            path=path or None,
            branch=branch,
        )
    )


@router.post("/repo-gallery-preview", response_model=IluGalleryRepoPreviewResponse)
async def post_ilu_repo_gallery_preview(payload: IluGalleryRepoPreviewRequest) -> IluGalleryRepoPreviewResponse:
    return get_gallery_repo_preview(
        payload.source,
        [
            candidate.model_dump(mode="json", by_alias=True, exclude_none=True)
            for candidate in payload.candidates
        ],
    )


@router.get("/file")
async def get_ilu_repo_file(
    owner: str = Query(..., min_length=1),
    repo: str = Query(..., min_length=1),
    path: str = Query(..., min_length=1),
    sha: str | None = Query(None),
    branch: str | None = Query(None),
) -> Response:
    try:
        content, mime_type = fetch_file_bytes(owner=owner, repo=repo, path=path, sha=sha, branch=branch)
    except GitHubPublicProxyError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    return Response(content=content, media_type=mime_type)


@router.post("/expand", response_model=XacroExpandResponse)
async def expand_ilu_xacro_endpoint(payload: XacroExpandRequest) -> XacroExpandResponse:
    urdf, stderr = expand_xacro(payload)
    return XacroExpandResponse(urdf=urdf, stderr=stderr)


@router.post("/expand-github", response_model=XacroExpandResponse)
async def expand_ilu_github_xacro_endpoint(payload: GitHubXacroExpandRequest) -> XacroExpandResponse:
    urdf, stderr = expand_github_xacro(payload)
    return XacroExpandResponse(urdf=urdf, stderr=stderr)
