from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from typing import TypeAlias

from backend.core.paths import BASE_DIR, SCRIPTS_DIR
from backend.models.json_payload import JsonObject
from backend.models.xacro import GitHubXacroExpandRequest, XacroExpandRequest
from backend.services.github_auth import resolve_server_github_token


def _read_float_env(name: str, default: float, *, minimum: float | None = None) -> float:
    raw = os.getenv(name)
    if not isinstance(raw, str):
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if not math.isfinite(value):
        return default
    if minimum is not None and value < minimum:
        return default
    return value


NODE_BIN = os.getenv("URDF_NODE_BIN", "node").strip() or "node"
NODE_TIMEOUT_SECONDS = _read_float_env("URDF_ILU_BRIDGE_TIMEOUT_SECONDS", 60.0, minimum=0.0)
BRIDGE_SCRIPT = SCRIPTS_DIR / "ilu_urdf_bridge.mjs"
XACRODOC_WHEEL = (
    BASE_DIR
    / "third_party"
    / "linkforge"
    / "wheels"
    / "xacrodoc-1.3.0-py3-none-any.whl"
)

BridgePayload: TypeAlias = Mapping[str, object]


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


@dataclass(frozen=True)
class BundledMeshAsset:
    original: str
    rewritten: str
    source_path: str
    target_path: str


@dataclass(frozen=True)
class BundleMeshAssetsResult:
    success: bool
    content: str
    out_path: str
    assets_root: str
    copied_files: int
    bundled: tuple[BundledMeshAsset, ...]
    unresolved: tuple[str, ...]
    error: str | None


@dataclass(frozen=True)
class MjcfConversionStats:
    bodies_created: int
    joints_converted: int
    geometries_converted: int


@dataclass(frozen=True)
class MjcfConversionDiagnostic:
    code: str
    severity: str
    link_name: str
    message: str


@dataclass(frozen=True)
class MjcfConversionResult:
    mjcf_content: str
    warnings: tuple[str, ...]
    diagnostics: tuple[MjcfConversionDiagnostic, ...]
    stats: MjcfConversionStats


@dataclass(frozen=True)
class UsdConversionStats:
    links_converted: int
    joints_converted: int
    visuals_converted: int
    collisions_converted: int
    inline_meshes_converted: int
    unsupported_meshes: int


@dataclass(frozen=True)
class UsdConversionResult:
    usd_content: str
    warnings: tuple[str, ...]
    stats: UsdConversionStats


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


def _run_bridge(command: str, payload: BridgePayload) -> JsonObject:
    try:
        completed_process = subprocess.run(
            [NODE_BIN, str(BRIDGE_SCRIPT), command],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=NODE_TIMEOUT_SECONDS,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError) as error:
        raise IluUrdfBridgeError(
            status_code=502,
            detail=f"Failed to execute ilu bridge: {error}",
        ) from error

    stdout = completed_process.stdout.strip()
    stderr = completed_process.stderr.strip()

    if completed_process.returncode != 0:
        detail = stderr or stdout or f"ilu bridge command failed: {command}"
        raise _map_bridge_error(command, detail)

    try:
        response = json.loads(stdout or "{}")
    except json.JSONDecodeError as error:
        raise IluUrdfBridgeError(
            status_code=502,
            detail="ilu bridge returned invalid JSON.",
        ) from error
    if not isinstance(response, dict):
        raise IluUrdfBridgeError(
            status_code=502,
            detail="ilu bridge returned an invalid JSON object.",
        )
    return response


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


def bundle_mesh_assets_for_urdf_file(
    *,
    urdf_path: str,
    urdf_xml: str,
    out_path: str,
    extra_search_roots: list[str] | None = None,
) -> BundleMeshAssetsResult:
    response = _run_bridge(
        "bundle-mesh-assets",
        {
            "urdfPath": urdf_path,
            "urdfXml": urdf_xml,
            "outPath": out_path,
            "extraSearchRoots": extra_search_roots or [],
        },
    )
    raw_bundled = response.get("bundled")
    raw_unresolved = response.get("unresolved")
    if not isinstance(raw_bundled, list) or not isinstance(raw_unresolved, list):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid mesh bundle response.")

    def _read_asset(value: object) -> BundledMeshAsset:
        if not isinstance(value, dict):
            raise IluUrdfBridgeError(502, "ilu bridge returned an invalid bundled mesh entry.")
        original = value.get("original")
        rewritten = value.get("rewritten")
        source_path = value.get("sourcePath")
        target_path = value.get("targetPath")
        if not all(isinstance(item, str) for item in (original, rewritten, source_path, target_path)):
            raise IluUrdfBridgeError(502, "ilu bridge returned an invalid bundled mesh entry.")
        return BundledMeshAsset(
            original=original,
            rewritten=rewritten,
            source_path=source_path,
            target_path=target_path,
        )

    success = response.get("success")
    content = response.get("content")
    returned_out_path = response.get("outPath")
    assets_root = response.get("assetsRoot")
    copied_files = response.get("copiedFiles")
    error = response.get("error")
    if not isinstance(success, bool) or not isinstance(content, str):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid mesh bundle response.")
    if not isinstance(returned_out_path, str) or not isinstance(assets_root, str):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid mesh bundle path.")
    if not isinstance(copied_files, int) or copied_files < 0:
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid copied file count.")
    if error is not None and not isinstance(error, str):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid mesh bundle error.")
    unresolved = tuple(item for item in raw_unresolved if isinstance(item, str))
    if len(unresolved) != len(raw_unresolved):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid unresolved mesh entry.")
    return BundleMeshAssetsResult(
        success=success,
        content=content,
        out_path=returned_out_path,
        assets_root=assets_root,
        copied_files=copied_files,
        bundled=tuple(_read_asset(item) for item in raw_bundled),
        unresolved=unresolved,
        error=error,
    )


def convert_urdf_to_mjcf(urdf_xml: str) -> MjcfConversionResult:
    response = _run_bridge("convert-mjcf", {"urdfXml": urdf_xml})
    mjcf_content = response.get("mjcfContent")
    raw_warnings = response.get("warnings")
    raw_diagnostics = response.get("diagnostics", [])
    raw_stats = response.get("stats")
    if (
        not isinstance(mjcf_content, str)
        or not isinstance(raw_warnings, list)
        or not isinstance(raw_diagnostics, list)
    ):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid MJCF conversion response.")
    if not isinstance(raw_stats, dict):
        raise IluUrdfBridgeError(502, "ilu bridge returned invalid MJCF conversion stats.")

    def _read_count(key: str) -> int:
        value = raw_stats.get(key)
        if not isinstance(value, int) or value < 0:
            raise IluUrdfBridgeError(502, f"ilu bridge returned invalid MJCF conversion stat: {key}.")
        return value

    warnings = tuple(item for item in raw_warnings if isinstance(item, str))
    if len(warnings) != len(raw_warnings):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid MJCF conversion warning.")

    diagnostics: list[MjcfConversionDiagnostic] = []
    for item in raw_diagnostics:
        if not isinstance(item, dict):
            raise IluUrdfBridgeError(502, "ilu bridge returned an invalid MJCF conversion diagnostic.")
        code = item.get("code")
        severity = item.get("severity")
        link_name = item.get("linkName")
        message = item.get("message")
        if not all(isinstance(value, str) and value for value in (code, severity, link_name, message)):
            raise IluUrdfBridgeError(502, "ilu bridge returned an invalid MJCF conversion diagnostic.")
        diagnostics.append(
            MjcfConversionDiagnostic(
                code=code,
                severity=severity,
                link_name=link_name,
                message=message,
            )
        )
    return MjcfConversionResult(
        mjcf_content=mjcf_content,
        warnings=warnings,
        diagnostics=tuple(diagnostics),
        stats=MjcfConversionStats(
            bodies_created=_read_count("bodiesCreated"),
            joints_converted=_read_count("jointsConverted"),
            geometries_converted=_read_count("geometriesConverted"),
        ),
    )


def convert_urdf_to_usd(urdf_xml: str) -> UsdConversionResult:
    response = _run_bridge("convert-usd", {"urdfXml": urdf_xml})
    usd_content = response.get("usdContent")
    raw_warnings = response.get("warnings")
    raw_stats = response.get("stats")
    if not isinstance(usd_content, str) or not isinstance(raw_warnings, list):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid USD conversion response.")
    if not isinstance(raw_stats, dict):
        raise IluUrdfBridgeError(502, "ilu bridge returned invalid USD conversion stats.")

    def _read_count(key: str) -> int:
        value = raw_stats.get(key)
        if not isinstance(value, int) or value < 0:
            raise IluUrdfBridgeError(502, f"ilu bridge returned invalid USD conversion stat: {key}.")
        return value

    warnings = tuple(item for item in raw_warnings if isinstance(item, str))
    if len(warnings) != len(raw_warnings):
        raise IluUrdfBridgeError(502, "ilu bridge returned an invalid USD conversion warning.")
    return UsdConversionResult(
        usd_content=usd_content,
        warnings=warnings,
        stats=UsdConversionStats(
            links_converted=_read_count("linksConverted"),
            joints_converted=_read_count("jointsConverted"),
            visuals_converted=_read_count("visualsConverted"),
            collisions_converted=_read_count("collisionsConverted"),
            inline_meshes_converted=_read_count("inlineMeshesConverted"),
            unsupported_meshes=_read_count("unsupportedMeshes"),
        ),
    )


def compute_sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
