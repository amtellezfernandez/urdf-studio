from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.responses import Response

import backend.api.robot_mastering as robot_mastering_api
from backend.models.robot_mastering import (
    BakeExportExecuteRequest,
    BakeExportExecuteResponse,
    CanonicalSynthesisRequest,
    CanonicalSynthesisResponse,
    FramePreflightRequest,
    FramePreflightResponse,
    GeneratePhysicsPreflightRequest,
    GeneratePhysicsPreflightResponse,
    GeneratePhysicsJobRequest,
    GeneratePhysicsJobResultResponse,
    RobotMasteringJobCreatedResponse,
    RobotMasteringJobStatusResponse,
)
from backend.services.robot_mastering import RobotMasteringError


def test_robot_mastering_job_endpoints_expose_create_status_and_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "create_generate_physics_job",
        lambda _request: RobotMasteringJobCreatedResponse(
            jobId="rm-123",
            jobType="generate-physics",
            status="queued",
        ),
    )
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "get_job_status",
        lambda _job_id: RobotMasteringJobStatusResponse(
            jobId="rm-123",
            jobType="generate-physics",
            status="succeeded",
            createdAt="2026-03-28T10:00:00Z",
            updatedAt="2026-03-28T10:00:01Z",
            error=None,
        ),
    )
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "get_generate_physics_result",
        lambda _job_id: GeneratePhysicsJobResultResponse(
            jobId="rm-123",
            jobType="generate-physics",
            draftUrdfContent="<robot name='draft' />",
            auditSummary={"totalLinkCount": 1},
            synthesisResult={"results": []},
            plausibilitySummary=None,
        ),
    )
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "get_job_artifact",
        lambda _job_id, _artifact_name: ("<robot name='draft' />", "application/xml"),
    )

    request = GeneratePhysicsJobRequest(
        jobType="generate-physics",
        sourceUrdf="<robot name='demo'/>",
        meshFiles=[],
        densityPresetId="aluminum",
        repairMode="repair-missing-invalid",
        linkNames=["arm_link"],
    )

    created = robot_mastering_api.create_robot_mastering_job(request)
    status = robot_mastering_api.get_robot_mastering_job_status("rm-123")
    result = robot_mastering_api.get_robot_mastering_job_result("rm-123")
    artifact = robot_mastering_api.get_robot_mastering_artifact("rm-123", "draft.urdf")

    assert created.job_id == "rm-123"
    assert status.status == "succeeded"
    assert result.draft_urdf_content == "<robot name='draft' />"
    assert isinstance(artifact, Response)
    assert artifact.body.decode("utf-8") == "<robot name='draft' />"
    assert request.link_names == ["arm_link"]


def test_robot_mastering_preflight_endpoint_maps_service_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "run_generate_physics_preflight",
        lambda _request: GeneratePhysicsPreflightResponse(
            auditSummary={"totalLinkCount": 12},
            plausibilitySummary={"verdict": "plausible"},
        ),
    )

    request = GeneratePhysicsPreflightRequest(
        sourceUrdf="<robot name='demo'/>",
        meshFiles=[],
        packageRoots={},
    )

    response = robot_mastering_api.generate_physics_preflight(request)

    assert response.audit_summary == {"totalLinkCount": 12}
    assert response.plausibility_summary == {"verdict": "plausible"}


def test_robot_mastering_frame_preflight_endpoint_maps_service_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "run_frame_preflight",
        lambda _request: FramePreflightResponse(
            orientationCard={"isValid": True},
            frameLint={"verdict": "canonical", "rewriteSafe": True},
        ),
    )

    request = FramePreflightRequest(
        sourceUrdf="<robot name='demo'/>",
    )

    response = robot_mastering_api.frame_preflight(request)

    assert response.orientation_card == {"isValid": True}
    assert response.frame_lint == {"verdict": "canonical", "rewriteSafe": True}


def test_robot_mastering_bake_export_endpoint_maps_service_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "run_bake_export_execute",
        lambda _request: BakeExportExecuteResponse(
            overrides=[
                {
                    "sourceReference": "meshes/base.obj",
                    "resolvedPath": "robot/meshes/base.obj",
                    "outputFilename": "base.obj",
                    "blob": {
                        "base64Content": "YmFrZWQ=",
                        "mimeType": "text/plain",
                    },
                    "sidecars": [],
                }
            ],
            unsupported=[],
        ),
    )

    request = BakeExportExecuteRequest(
        planEntries=[
            {
                "meshReference": "meshes/base.obj",
                "bakeMatrixElements": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 3.0, 1.0],
                "linkNames": ["base_link"],
                "sourceEntryCount": 1,
            }
        ],
        planConflicts=[],
        meshFiles=[],
        packageRoots={},
    )

    response = robot_mastering_api.bake_export_execute(request)

    assert response.overrides[0].source_reference == "meshes/base.obj"
    assert response.overrides[0].blob.base64_content == "YmFrZWQ="
    assert response.unsupported == []


def test_robot_mastering_canonical_synthesis_endpoint_maps_service_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "run_canonical_synthesis",
        lambda _request: CanonicalSynthesisResponse(
            preview={"rootLinkName": "base_link", "jointCount": 1},
            draftContent="<robot name='draft' />",
        ),
    )

    request = CanonicalSynthesisRequest(
        sourceUrdf="<robot name='demo'/>",
        synthesisSourceUrdf="<robot name='demo'/>",
        robotName="demo_robot",
        capturedLinkWorldPoses=[
            {
                "linkName": "base_link",
                "matrixWorldElements": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            }
        ],
        supportPlane={
            "success": True,
            "confidence": 1.0,
            "evidence": "Likely +z up.",
            "inferredUpAxis": "z",
            "inferredUpSign": 1,
            "targetUpAxis": "z",
            "targetUpSign": 1,
        },
    )

    response = robot_mastering_api.canonical_synthesis(request)

    assert response.preview["rootLinkName"] == "base_link"
    assert response.draft_content == "<robot name='draft' />"


def test_robot_mastering_result_endpoint_maps_service_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        robot_mastering_api.robot_mastering_service,
        "get_generate_physics_result",
        lambda _job_id: (_ for _ in ()).throw(
            RobotMasteringError(status_code=409, detail="Robot mastering job is not complete.")
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        robot_mastering_api.get_robot_mastering_job_result("rm-123")

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Robot mastering job is not complete."
