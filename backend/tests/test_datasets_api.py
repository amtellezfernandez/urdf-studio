from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

import backend.api.datasets as datasets_api
from backend.models.dataset_alignment import DatasetRepresentationValidationResponse
from backend.models.datasets import (
    DatasetMixRequest,
    DatasetTreatmentAnalysisResponse,
    DatasetTreatmentManifest,
    DatasetTreatmentSourceManifest,
    DatasetTreatmentStats,
)


def _run_api(coro):
    return asyncio.run(coro)


def test_analyze_dataset_treatments_returns_manifest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        datasets_api,
        "normalize_local_dataset_paths",
        lambda local_paths: [f"/safe/{path.split('/')[-1]}" for path in local_paths],
    )
    monkeypatch.setattr(
        datasets_api,
        "analyze_dataset_treatment",
        lambda _req, _local_paths: DatasetTreatmentAnalysisResponse(
            success=True,
            warnings=[],
            alignment=DatasetRepresentationValidationResponse(
                valid=True,
                errors=[],
                warnings=[],
            ),
            treatment_manifest=DatasetTreatmentManifest(
                manifest_version="v1",
                required_representation_id="semantic/joint-position/v1",
                sources=[
                    DatasetTreatmentSourceManifest(
                        source_id="local:0",
                        dataset_id="local:demo/train",
                        source_kind="local",
                        source_value="../unsafe-demo",
                        canonical_source="/safe/unsafe-demo",
                        representation_id="semantic/joint-position/v1",
                        naming_status="named",
                        profile_id="semantic-aligned",
                        profile_version="v1",
                    )
                ],
                stats=DatasetTreatmentStats(total_sources=1, local_source_count=1, unique_canonical_sources=1),
            ),
        ),
    )

    result = _run_api(
        datasets_api.analyze_dataset_treatments(
            DatasetMixRequest(
                local_paths=["../unsafe-demo"],
                alignment={
                    "datasets": [
                        {
                            "dataset_id": "local:demo/train",
                            "embodiment_id": "demo:robot",
                            "representation_id": "semantic/joint-position/v1",
                            "naming_status": "named",
                        }
                    ],
                    "required_representation_id": "semantic/joint-position/v1",
                },
            )
        )
    )

    assert result.success is True
    assert result.treatment_manifest.manifest_version == "v1"
    assert result.treatment_manifest.sources[0].canonical_source == "/safe/unsafe-demo"


def test_analyze_dataset_treatments_supports_virtual_sources() -> None:
    result = _run_api(
        datasets_api.analyze_dataset_treatments(
            DatasetMixRequest(
                alignment={
                    "datasets": [
                        {
                            "dataset_id": "local-upload:demo",
                            "embodiment_id": "demo:robot",
                            "representation_id": "rep:joint_pos_abs:indexed:v1",
                            "naming_status": "named",
                        }
                    ],
                    "required_representation_id": "rep:joint_pos_abs:semantic:v1",
                },
            )
        )
    )

    assert result.treatment_manifest.sources[0].source_kind == "virtual"
    assert result.treatment_manifest.sources[0].canonical_source == "local-upload:demo"



def test_hf_proxy_rejects_non_huggingface_hosts() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _run_api(datasets_api.hf_proxy("https://example.com/data.json"))

    assert exc_info.value.status_code == 400


def test_hf_proxy_forwards_allowed_huggingface_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_headers: dict[str, str] = {}

    class FakeUpstreamResponse:
        status = 200
        headers = {"Content-Type": "application/json"}

        def __enter__(self) -> "FakeUpstreamResponse":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"ok":true}'

    def fake_urlopen(request: object, timeout: int) -> FakeUpstreamResponse:
        assert timeout == datasets_api.HF_PROXY_TIMEOUT_SECONDS
        captured_headers.update(dict(getattr(request, "header_items")()))
        return FakeUpstreamResponse()

    monkeypatch.setattr(datasets_api.urllib.request, "urlopen", fake_urlopen)

    response = _run_api(
        datasets_api.hf_proxy(
            "https://huggingface.co/api/datasets/demo/repo",
            authorization="Bearer hf_token",
        )
    )

    assert response.status_code == 200
    assert response.body == b'{"ok":true}'
    assert captured_headers["Authorization"] == "Bearer hf_token"
