from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache

from backend.core.paths import BASE_DIR, SCRIPTS_DIR
from backend.models.xacro import GitHubXacroExpandRequest, XacroExpandRequest
from backend.services.github_auth import resolve_server_github_token


NODE_BIN = os.getenv("URDF_NODE_BIN", "node").strip() or "node"
NODE_TIMEOUT_SECONDS = float(os.getenv("URDF_ILU_BRIDGE_TIMEOUT_SECONDS", "60"))
BRIDGE_SCRIPT = SCRIPTS_DIR / "ilu_urdf_bridge.mjs"
XACRODOC_WHEEL = (
    BASE_DIR
    / "third_party"
    / "linkforge"
    / "wheels"
    / "xacrodoc-1.3.0-py3-none-any.whl"
)


@dataclass(frozen=True)
class IluUrdfBridgeError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class KinematicFingerprint:
    strict: str
    loose: str


@dataclass(frozen=True)
class RobotMorphologySummary:
    primary_family: str
    families: tuple[str, ...]
    link_count: int
    joint_count: int
    controllable_joint_count: int
    dof_count: int
    arm_count: int
    leg_count: int
    wheel_count: int


def _map_bridge_error(command: str, detail: str) -> IluUrdfBridgeError:
    lowered = detail.lower()
    if "target xacro file not found" in lowered:
        return IluUrdfBridgeError(status_code=404, detail=detail)
    if "repository not found" in lowered or "path not found" in lowered or "file not found" in lowered:
        return IluUrdfBridgeError(status_code=404, detail=detail)
    if "github api rate limit exceeded" in lowered or "access denied" in lowered or "no access" in lowered:
        return IluUrdfBridgeError(status_code=403, detail=detail)
    if "invalid github token" in lowered or "invalid token" in lowered:
        return IluUrdfBridgeError(status_code=401, detail=detail)
    if "no python xacro runtime available" in lowered or "no vendored xacro runtime available" in lowered:
        return IluUrdfBridgeError(status_code=500, detail=detail)
    if "failed to initialize vendored xacro runtime" in lowered:
        return IluUrdfBridgeError(status_code=500, detail=detail)
    if "bridge returned invalid json" in lowered:
        return IluUrdfBridgeError(status_code=502, detail=detail)
    if command == "expand-xacro":
        return IluUrdfBridgeError(status_code=400, detail=detail)
    return IluUrdfBridgeError(status_code=400, detail=detail)


def _run_bridge(command: str, payload: dict) -> dict:
    process = subprocess.run(
        [NODE_BIN, str(BRIDGE_SCRIPT), command],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=NODE_TIMEOUT_SECONDS,
        check=False,
    )

    stdout = process.stdout.strip()
    stderr = process.stderr.strip()

    if process.returncode != 0:
        detail = stderr or stdout or f"ilu bridge command failed: {command}"
        raise _map_bridge_error(command, detail)

    try:
        return json.loads(stdout or "{}")
    except json.JSONDecodeError as error:
        raise IluUrdfBridgeError(
            status_code=502,
            detail="ilu bridge returned invalid JSON.",
        ) from error


@lru_cache(maxsize=256)
def strip_urdf_for_kinematics(urdf_xml: str) -> str:
    payload = _run_bridge("strip-kinematics-urdf", {"urdfXml": urdf_xml})
    urdf = payload.get("urdf")
    if not isinstance(urdf, str):
        raise IluUrdfBridgeError(502, "ilu bridge did not return sanitized URDF content.")
    return urdf


@lru_cache(maxsize=256)
def compute_kinematic_fingerprint(urdf_xml: str) -> KinematicFingerprint:
    payload = _run_bridge("fingerprint", {"urdfXml": urdf_xml})
    strict = payload.get("strict")
    loose = payload.get("loose")
    if not isinstance(strict, str) or not isinstance(loose, str):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid kinematic fingerprint.")
    return KinematicFingerprint(strict=strict, loose=loose)


@lru_cache(maxsize=256)
def analyze_robot_morphology(urdf_xml: str) -> RobotMorphologySummary:
    payload = _run_bridge("analyze-morphology", {"urdfXml": urdf_xml})
    primary_family = payload.get("primaryFamily")
    raw_families = payload.get("families")
    if not isinstance(primary_family, str) or not primary_family.strip():
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid robot morphology summary.")
    if not isinstance(raw_families, list):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid robot morphology family list.")

    def _read_non_negative_int(key: str) -> int:
        value = payload.get(key)
        if not isinstance(value, int) or value < 0:
            raise IluUrdfBridgeError(502, f"ilu bridge returned an invalid robot morphology field: {key}.")
        return value

    families = tuple(
        family.strip()
        for family in raw_families
        if isinstance(family, str) and family.strip()
    )
    return RobotMorphologySummary(
        primary_family=primary_family.strip(),
        families=families,
        link_count=_read_non_negative_int("linkCount"),
        joint_count=_read_non_negative_int("jointCount"),
        controllable_joint_count=_read_non_negative_int("controllableJointCount"),
        dof_count=_read_non_negative_int("dofCount"),
        arm_count=_read_non_negative_int("armCount"),
        leg_count=_read_non_negative_int("legCount"),
        wheel_count=_read_non_negative_int("wheelCount"),
    )


def expand_xacro(request: XacroExpandRequest) -> tuple[str, str | None]:
    payload = {
        "target_path": request.target_path,
        "files": [file.model_dump() for file in request.files],
        "args": request.args,
        "use_inorder": request.use_inorder,
        "pythonExecutable": sys.executable,
    }
    if XACRODOC_WHEEL.exists():
        payload["wheelPath"] = str(XACRODOC_WHEEL)

    response = _run_bridge("expand-xacro", payload)
    urdf = response.get("urdf")
    if not isinstance(urdf, str) or not urdf.strip():
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid xacro expansion response.")
    stderr = response.get("stderr")
    return urdf, stderr if isinstance(stderr, str) or stderr is None else None


def expand_github_xacro(request: GitHubXacroExpandRequest) -> tuple[str, str | None]:
    access_token = resolve_server_github_token(request.access_token)
    payload = {
        "owner": request.owner,
        "repo": request.repo,
        "target_path": request.target_path,
        "branch": request.branch,
        "access_token": access_token,
        "args": request.args,
        "use_inorder": request.use_inorder,
        "pythonExecutable": sys.executable,
    }
    if XACRODOC_WHEEL.exists():
        payload["wheelPath"] = str(XACRODOC_WHEEL)

    response = _run_bridge("load-source-github", payload)
    urdf = response.get("urdf")
    if not isinstance(urdf, str) or not urdf.strip():
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid GitHub xacro expansion response.")
    return urdf, None


def compute_sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
