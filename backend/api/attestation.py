from __future__ import annotations

import json
import subprocess

from fastapi import APIRouter, HTTPException

from backend.models.attestation import (
    AttestationOverrideRequest,
    AttestationScanTriggerRequest,
    AttestationStatusResponse,
    AttestationStatusUpsertRequest,
    AttestationSummary,
    ZraGatewayPullRequest,
    ZraGatewayImportRequest,
    ZraOrchestratorStatusResponse,
)
from backend.services.attestation import attestation_status_store
from backend.services.zra_orchestrator import zra_orchestrator_service
from backend.services.zra_gateway_pull import fetch_zra_gateway_decision
from backend.services.zra_attestation import convert_zra_gateway_to_attestation

router = APIRouter(prefix="/attestation", tags=["attestation"])


@router.get("/status", response_model=list[AttestationStatusResponse])
def list_attestation_statuses() -> list[AttestationStatusResponse]:
    return attestation_status_store.list()


@router.get("/status/{robot_id}", response_model=AttestationStatusResponse)
def get_attestation_status(robot_id: str) -> AttestationStatusResponse:
    status = attestation_status_store.get(robot_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"unknown robot attestation status: {robot_id}")
    return status


@router.get("/summary/{robot_id}", response_model=AttestationSummary)
def get_attestation_summary(robot_id: str) -> AttestationSummary:
    summary = attestation_status_store.summary(robot_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"unknown robot attestation summary: {robot_id}")
    return summary


@router.get("/orchestrator/status", response_model=ZraOrchestratorStatusResponse)
def get_zra_orchestrator_status() -> ZraOrchestratorStatusResponse:
    return zra_orchestrator_service.status()


@router.post("/status", response_model=AttestationStatusResponse)
def upsert_attestation_status(
    request: AttestationStatusUpsertRequest,
) -> AttestationStatusResponse:
    return attestation_status_store.upsert(request)


@router.post("/import/zra-gateway", response_model=AttestationStatusResponse)
def import_zra_gateway_attestation(
    request: ZraGatewayImportRequest,
) -> AttestationStatusResponse:
    converted = convert_zra_gateway_to_attestation(
        robot_id=request.robot_id,
        gateway_decision=request.gateway_decision,
    )
    return attestation_status_store.upsert(converted)


@router.post("/pull/zra-gateway", response_model=AttestationStatusResponse)
def pull_zra_gateway_attestation(
    request: ZraGatewayPullRequest,
) -> AttestationStatusResponse:
    try:
        gateway_decision = fetch_zra_gateway_decision(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Timed out pulling zRA gateway decision.") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        detail = stderr or "Failed to pull zRA gateway decision over SSH."
        raise HTTPException(status_code=502, detail=detail) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Pulled zRA gateway decision is not valid JSON.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    converted = convert_zra_gateway_to_attestation(
        robot_id=request.robot_id,
        gateway_decision=gateway_decision,
    )
    return attestation_status_store.upsert(converted)


@router.post("/status/{robot_id}/allow", response_model=AttestationStatusResponse)
def allow_attestation_connection(
    robot_id: str,
    request: AttestationOverrideRequest,
) -> AttestationStatusResponse:
    status = attestation_status_store.allow_connection(robot_id, request)
    if status is None:
        raise HTTPException(status_code=404, detail=f"unknown robot attestation status: {robot_id}")
    return status


@router.post("/status/{robot_id}/scan-trigger", response_model=AttestationStatusResponse)
def mark_attestation_scan_triggered(
    robot_id: str,
    request: AttestationScanTriggerRequest,
) -> AttestationStatusResponse:
    status = attestation_status_store.mark_scan_triggered(robot_id, request)
    if status is None:
        raise HTTPException(status_code=404, detail=f"unknown robot attestation status: {robot_id}")
    return status
