from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from backend.core.settings import settings
from backend.models.attestation import (
    AttestationStatusUpsertRequest,
    AttestationTrustState,
    ZraGatewayPullRequest,
    ZraOrchestratorDeviceStatus,
    ZraOrchestratorStatusResponse,
    utc_now,
)
from backend.services.attestation import attestation_status_store
from backend.services.zra_attestation import convert_zra_gateway_to_attestation
from backend.services.zra_gateway_pull import fetch_zra_gateway_decision


logger = logging.getLogger("urdf.zra_orchestrator")


@dataclass(frozen=True)
class ZraOrchestratorDevice:
    robot_id: str
    ssh_host: str | None = None
    ssh_user: str | None = None
    ssh_password: str | None = None
    remote_gateway_path: str | None = None
    local_gateway_path: str | None = None
    timeout_seconds: int = 10


@dataclass
class _DeviceRuntime:
    config: ZraOrchestratorDevice
    last_poll_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    current_state: AttestationTrustState = AttestationTrustState.INACTIVE


def load_zra_orchestrator_devices(path_value: str | None) -> list[ZraOrchestratorDevice]:
    if not path_value:
        return []
    path = Path(path_value)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Failed to read zRA orchestrator devices file: {path}") from exc
    if not isinstance(payload, list):
        raise ValueError("zRA orchestrator devices file must contain a JSON list.")
    devices: list[ZraOrchestratorDevice] = []
    for entry in payload:
        if not isinstance(entry, dict):
            raise ValueError("Each zRA orchestrator device entry must be a JSON object.")
        robot_id = str(entry.get("robot_id") or "").strip()
        if not robot_id:
            raise ValueError("Each zRA orchestrator device entry requires robot_id.")
        devices.append(
            ZraOrchestratorDevice(
                robot_id=robot_id,
                ssh_host=str(entry.get("ssh_host") or "").strip() or None,
                ssh_user=str(entry.get("ssh_user") or "").strip() or None,
                ssh_password=str(entry.get("ssh_password") or "").strip() or None,
                remote_gateway_path=str(entry.get("remote_gateway_path") or "").strip() or None,
                local_gateway_path=str(entry.get("local_gateway_path") or "").strip() or None,
                timeout_seconds=int(entry.get("timeout_seconds") or 10),
            )
        )
    return devices


class ZraOrchestratorService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._devices: list[_DeviceRuntime] = []

    def _ensure_devices_loaded(self) -> None:
        if self._devices:
            return
        try:
            loaded_devices = load_zra_orchestrator_devices(settings.zra_orchestrator_devices_path)
        except Exception as exc:
            logger.warning("zRA orchestrator device config could not be loaded: %s", exc)
            loaded_devices = []
        self._devices = [_DeviceRuntime(config=device) for device in loaded_devices]

    def start(self) -> None:
        if not settings.zra_orchestrator_enabled:
            return
        self._ensure_devices_loaded()
        if not self._devices:
            return
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, name="zra-orchestrator", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        with self._lock:
            thread = self._thread
            self._thread = None
        if thread and thread.is_alive():
            thread.join(timeout=1.0)

    def status(self) -> ZraOrchestratorStatusResponse:
        self._ensure_devices_loaded()
        with self._lock:
            devices = [
                ZraOrchestratorDeviceStatus(
                    robot_id=device.config.robot_id,
                    enabled=True,
                    last_poll_at=device.last_poll_at,
                    last_success_at=device.last_success_at,
                    last_error=device.last_error,
                    consecutive_failures=device.consecutive_failures,
                    current_state=device.current_state,
                )
                for device in self._devices
            ]
        return ZraOrchestratorStatusResponse(
            enabled=settings.zra_orchestrator_enabled,
            poll_interval_seconds=settings.zra_orchestrator_poll_interval_seconds,
            inactive_after_seconds=settings.zra_orchestrator_inactive_after_seconds,
            device_count=len(devices),
            devices=devices,
        )

    def _run_loop(self) -> None:
        self._poll_once()
        while not self._stop_event.wait(settings.zra_orchestrator_poll_interval_seconds):
            self._poll_once()

    def _poll_once(self) -> None:
        for device in self._devices:
            self._poll_device(device)
        self._mark_inactive_devices()

    def _poll_device(self, device: _DeviceRuntime) -> None:
        now = utc_now()
        device.last_poll_at = now
        try:
            gateway_decision = fetch_zra_gateway_decision(
                ZraGatewayPullRequest(
                    robot_id=device.config.robot_id,
                    ssh_host=device.config.ssh_host,
                    ssh_user=device.config.ssh_user,
                    ssh_password=device.config.ssh_password,
                    remote_gateway_path=device.config.remote_gateway_path,
                    local_gateway_path=device.config.local_gateway_path,
                    timeout_seconds=device.config.timeout_seconds,
                )
            )
            converted = convert_zra_gateway_to_attestation(
                robot_id=device.config.robot_id,
                gateway_decision=gateway_decision,
            )
            attestation_status_store.upsert(converted)
            device.last_success_at = now
            device.last_error = None
            device.consecutive_failures = 0
            device.current_state = converted.trust_state
        except Exception as exc:  # pragma: no cover - exercised through status behavior
            device.last_error = str(exc)
            device.consecutive_failures += 1
            logger.warning("zRA orchestrator poll failed for %s: %s", device.config.robot_id, exc)

    def _mark_inactive_devices(self) -> None:
        now = utc_now()
        inactive_after_seconds = max(1, settings.zra_orchestrator_inactive_after_seconds)
        for device in self._devices:
            last_success_at = device.last_success_at
            if last_success_at is None:
                if device.last_poll_at is None:
                    continue
                elapsed = (now - device.last_poll_at).total_seconds()
            else:
                elapsed = (now - last_success_at).total_seconds()
            if elapsed < inactive_after_seconds:
                continue
            inactive_payload = AttestationStatusUpsertRequest(
                robot_id=device.config.robot_id,
                verifier="zra-orchestrator",
                trust_state=AttestationTrustState.INACTIVE,
                reason=device.last_error or "No recent attestation has been published for this robot.",
                metadata={"orchestrator": "inactive-timeout"},
            )
            attestation_status_store.upsert(inactive_payload)
            device.current_state = AttestationTrustState.INACTIVE


zra_orchestrator_service = ZraOrchestratorService()
