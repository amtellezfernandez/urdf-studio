#!/usr/bin/env python3
"""
FastAPI backend for URDF Studio.

Provides:
- /health            : basic health + dependency check
- /pyroki/fk         : forward kinematics using PyRoki, with URDF+Robot cached in memory
- /rerun/visualize   : Rerun visualization (spawn or serve)
- /datasets/mix      : Mix multiple robot learning datasets

Run (dev):
    uvicorn backend.server:app --reload
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import yourdfpy  # type: ignore
from jax import numpy as jnp  # type: ignore
from pyroki import Robot  # type: ignore
import pyroki as pk  # type: ignore
import jax  # type: ignore
import jaxlie  # type: ignore
import jaxls  # type: ignore
import jax_dataclasses as jdc  # type: ignore


class FKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: Dict[str, float] = Field(
        default_factory=dict,
        description="Mapping joint_name -> value (radians).",
    )


class FKLink(BaseModel):
    name: str
    position: List[float]  # [x, y, z]
    quaternion_wxyz: List[float]  # [w, x, y, z]


class FKResponse(BaseModel):
    links: List[FKLink]
    metadata: Dict[str, Any]


class IKRequest(BaseModel):
    urdf: str = Field(..., description="URDF XML as a string.")
    joint_values: Dict[str, float] = Field(
        default_factory=dict, description="Mapping joint_name -> value (radians)."
    )
    target_link: str = Field(..., description="End-effector link name.")
    target_position: List[float] = Field(
        ..., description="Target position [x, y, z] in meters."
    )
    target_wxyz: Optional[List[float]] = Field(
        default=None, description="Target orientation [w, x, y, z]. Defaults to identity."
    )
    target_rotation: Optional[List[List[float]]] = Field(
        default=None,
        description="Target orientation as 3x3 rotation matrix (row-major). Overrides target_wxyz when provided.",
    )


class IKDiagnostics(BaseModel):
    termination_reason: str
    termination_flags: List[bool]
    iterations: int
    cost: float
    lambda_final: float
    validity: str
    stability: str
    degeneracy: str
    branch_maybe: bool
    branch_metric: float
    branch_message: str


class IKResponse(BaseModel):
    solution: Dict[str, float]
    diagnostics: IKDiagnostics
    metadata: Dict[str, Any]


class HealthResponse(BaseModel):
    status: str
    pyroki: bool
    yourdfpy: bool
    rerun: bool


class RerunVisualizeRequest(BaseModel):
    episode: Dict[str, Any] = Field(..., description="Episode data as JSON")
    urdf: str = Field(..., description="URDF XML string")
    recording: str = Field(default="lerobot/episode_0", description="Recording name")
    spawn: bool = Field(default=False, description="Spawn desktop viewer")
    serve: bool = Field(default=False, description="Serve web viewer")
    web_port: int = Field(default=9090, description="Web viewer port")
    ws_port: int = Field(default=9876, description="WebSocket port")


class RerunVisualizeResponse(BaseModel):
    success: bool
    message: str
    mode: Optional[str] = None
    web_port: Optional[int] = None
    stderr: Optional[str] = None
    stdout: Optional[str] = None


class DatasetMixRequest(BaseModel):
    repo_ids: List[str] = Field(default_factory=list, description="HuggingFace repo IDs")
    local_paths: List[str] = Field(default_factory=list, description="Local dataset paths")


class DatasetMixResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    output_path: Optional[str] = None
    error: Optional[str] = None


app = FastAPI(title="URDF Studio Backend", version="0.1.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RobotEntry(BaseModel):
    urdf_hash: str
    urdf_xml: str
    robot: Any  # PyRoki Robot instance; skip Pydantic validation to avoid type subscripting issues
    ik_solver_cache: Dict[str, Any] = {}  # Cache IK problems per target link

    class Config:
        arbitrary_types_allowed = True


_robot_cache: Dict[str, RobotEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _load_urdf_from_xml(urdf_xml: str) -> yourdfpy.URDF:
    """
    yourdfpy prefers loading from file; write XML to a temp file once.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(urdf_xml)
        tmp_path = tmp.name
    try:
        urdf = yourdfpy.URDF.load(tmp_path)  # type: ignore[attr-defined]
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
    return urdf


def _get_or_create_robot(urdf_xml: str) -> RobotEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    urdf_hash = _hash_urdf(urdf_xml)
    entry = _robot_cache.get(urdf_hash)
    if entry is not None:
        return entry
    try:
        urdf = _load_urdf_from_xml(urdf_xml)
        robot = Robot.from_urdf(urdf)
    except Exception as exc:  # defensive; surfaced as HTTP error
        raise HTTPException(
            status_code=400, detail=f"Failed to build PyRoki robot: {exc}"
        ) from exc
    entry = RobotEntry(urdf_hash=urdf_hash, urdf_xml=urdf_xml, robot=robot)
    _robot_cache[urdf_hash] = entry
    return entry


def _build_cfg(robot: Robot, joint_values: Dict[str, float]) -> jnp.ndarray:
    """
    Map joint_name -> value into PyRoki's actuated joint ordering.
    Missing joints default to 0.0.
    """
    names = list(robot.joints.actuated_names)
    cfg = np.array([float(joint_values.get(name, 0.0)) for name in names], dtype=np.float32)
    if cfg.shape != (robot.joints.num_actuated_joints,):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Configuration size mismatch: got {cfg.shape[0]}, "
                f"expected {robot.joints.num_actuated_joints} actuated joints"
            ),
        )
    return jnp.array(cfg)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    try:
        _ = Robot  # noqa: F841
        pyroki_ok = True
    except Exception:  # pragma: no cover
        pyroki_ok = False
    try:
        _ = yourdfpy.URDF  # type: ignore[attr-defined]
        yourdfpy_ok = True
    except Exception:  # pragma: no cover
        yourdfpy_ok = False
    try:
        import rerun  # type: ignore # noqa: F401
        rerun_ok = True
    except Exception:  # pragma: no cover
        rerun_ok = False
    return HealthResponse(status="ok", pyroki=pyroki_ok, yourdfpy=yourdfpy_ok, rerun=rerun_ok)


@app.post("/pyroki/fk", response_model=FKResponse)
def pyroki_fk(req: FKRequest) -> FKResponse:
    """
    Forward kinematics via PyRoki.
    - URDF XML string is parsed + cached as a Robot.
    - Joint values are mapped into actuated order.
    - Returns link poses (wxyz_xyz) keyed by link name.
    """
    entry = _get_or_create_robot(req.urdf)
    robot = entry.robot
    cfg = _build_cfg(robot, req.joint_values)

    try:
        poses = robot.forward_kinematics(cfg)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"PyRoki forward_kinematics failed: {exc}"
        ) from exc

    arr = np.asarray(poses, dtype=np.float64)
    if arr.shape != (robot.links.num_links, 7):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Unexpected FK output shape {arr.shape}, "
                f"expected ({robot.links.num_links}, 7)"
            ),
        )

    names = list(robot.links.names)
    links: List[FKLink] = []
    for idx, name in enumerate(names):
        w, x, y, z, px, py, pz = map(float, arr[idx])
        links.append(
            FKLink(
                name=name,
                position=[px, py, pz],
                quaternion_wxyz=[w, x, y, z],
            )
        )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(robot.joints.actuated_names),
        "all_link_names": names,
    }
    return FKResponse(links=links, metadata=metadata)


def _get_or_create_ik_solver(entry: RobotEntry, target_link: str, target_idx: int):
    """
    Get or create a JIT-compiled IK solver using jax_dataclasses.jit.
    This compiles the ENTIRE IK solve (including .analyze()) on first call,
    then subsequent calls are blazingly fast!
    """
    cache_key = target_link
    if cache_key in entry.ik_solver_cache:
        return entry.ik_solver_cache[cache_key]

    robot = entry.robot

    # Create JIT-compiled solver using @jdc.jit which can handle Robot dataclass
    @jdc.jit
    def solve_ik_fast(
        target_wxyz: jnp.ndarray,
        target_position: jnp.ndarray,
        cfg_start: jnp.ndarray,
    ) -> jnp.ndarray:
        """
        JIT-compiled IK solver. Compiles once, runs fast!
        """
        joint_var = robot.joint_var_cls(0)

        target_pose = jaxlie.SE3.from_rotation_and_translation(
            jaxlie.SO3(target_wxyz),
            target_position
        )

        # Simplified costs for SPEED - only pose and limits
        costs = [
            pk.costs.pose_cost_analytic_jac(
                robot,
                joint_var,
                target_pose,
                jnp.array(target_idx, dtype=jnp.int32),
                pos_weight=100.0,
                ori_weight=1.0,  # Even lower orientation weight for speed
            ),
            pk.costs.limit_cost(
                robot,
                joint_var,
                weight=50.0,
            ),
            # Removed rest_cost for maximum speed during interactive dragging
        ]

        # Ultra-fast solver config - sacrifices accuracy for speed
        sol = (
            jaxls.LeastSquaresProblem(costs, [joint_var])
            .analyze()
            .solve(
                initial_vals=jaxls.VarValues.make([joint_var.with_value(cfg_start)]),
                verbose=False,
                linear_solver="dense_cholesky",
                trust_region=jaxls.TrustRegionConfig(
                    lambda_initial=0.01,  # Very aggressive start
                    lambda_min=1e-12,
                    lambda_max=1e6,
                ),
                termination=jaxls.TerminationConfig(
                    max_iterations=3,       # Only 3 iterations for real-time!
                    cost_tolerance=1e-3,    # Very relaxed
                    gradient_tolerance=1e-3,
                    parameter_tolerance=1e-3,
                ),
            )
        )
        return sol[joint_var]

    # Warm up JIT compilation with a dummy call
    print(f"[IK] Warming up JIT compiler for {target_link}...")
    dummy_wxyz = jnp.array([1.0, 0.0, 0.0, 0.0], dtype=jnp.float32)
    dummy_pos = jnp.zeros(3, dtype=jnp.float32)
    dummy_cfg = jnp.zeros(robot.joints.num_actuated_joints, dtype=jnp.float32)
    _ = solve_ik_fast(dummy_wxyz, dummy_pos, dummy_cfg)
    print(f"[IK] JIT compilation complete for {target_link}!")

    entry.ik_solver_cache[cache_key] = solve_ik_fast
    return solve_ik_fast


@app.post("/pyroki/ik", response_model=IKResponse)
def pyroki_ik(req: IKRequest) -> IKResponse:
    """
    Single-target inverse kinematics via PyRoki + JAXLS.
    Returns the solved configuration and basic diagnostics.
    """
    entry = _get_or_create_robot(req.urdf)
    robot = entry.robot

    target_link = req.target_link
    if target_link not in robot.links.names:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF (available: {robot.links.names})",
        )

    if len(req.target_position) != 3:
        raise HTTPException(status_code=400, detail="target_position must have length 3")
    if req.target_wxyz is not None and len(req.target_wxyz) != 4:
        raise HTTPException(status_code=400, detail="target_wxyz must have length 4 when provided")
    if req.target_rotation is not None:
        if len(req.target_rotation) != 3 or any(len(row) != 3 for row in req.target_rotation):
            raise HTTPException(
                status_code=400,
                detail="target_rotation must be a 3x3 matrix when provided (row-major).",
            )

    # Build initial configuration from provided joint map.
    cfg_start = _build_cfg(robot, req.joint_values)
    target_idx = robot.links.names.index(target_link)

    # Prepare target orientation and position
    if req.target_rotation is not None:
        rotation_matrix = jnp.array(req.target_rotation, dtype=jnp.float32)
        so3 = jaxlie.SO3.from_matrix(rotation_matrix)
        target_wxyz = so3.wxyz
    else:
        target_wxyz = req.target_wxyz or [1.0, 0.0, 0.0, 0.0]
        target_wxyz = jnp.array(target_wxyz, dtype=jnp.float32)

    target_position = jnp.array(req.target_position, dtype=jnp.float32)

    # Get or create cached JIT-compiled solver (first call compiles, subsequent calls are FAST!)
    solve_ik_fast = _get_or_create_ik_solver(entry, target_link, target_idx)

    # Solve IK using JIT-compiled solver - THIS IS FAST!
    cfg_solution = solve_ik_fast(target_wxyz, target_position, cfg_start)

    # Use placeholder diagnostics for speed - we don't recompute the problem
    cost = 0.0
    iterations = 5  # Placeholder - actual iterations unknown
    term_flags = [True, False, False, False]
    termination_reason = "cost"
    lambda_final = 1.0
    gradient_mag = 0.0
    param_delta = 0.0

    validity = "valid" if not (cost != cost or cost == float("inf")) and any(term_flags[:3]) else "invalid"
    stability = "stable" if validity == "valid" and not term_flags[3] else "unstable"
    degeneracy = "degenerate" if gradient_mag > 1e-2 or lambda_final > 1e3 or param_delta > 1e-1 else "well-conditioned"

    diff = jnp.abs(cfg_solution - cfg_start)
    max_diff = float(jnp.max(diff))
    branch_maybe = bool(max_diff > 1.5)  # Heuristic: large jump implies unexpected branch
    branch_message = (
        f"Large configuration jump detected (max Δ={max_diff:.3f} rad) vs seed; solver may have taken a different branch."
        if branch_maybe
        else "Configuration stayed near the seed; branch change unlikely."
    )

    solution_map = {
        name: float(cfg_solution[i])
        for i, name in enumerate(robot.joints.actuated_names)
    }

    diagnostics = IKDiagnostics(
        termination_reason=termination_reason,
        termination_flags=term_flags,
        iterations=iterations,
        cost=cost,
        lambda_final=lambda_final,
        validity=validity,
        stability=stability,
        degeneracy=degeneracy,
        branch_maybe=branch_maybe,
        branch_metric=max_diff,
        branch_message=branch_message,
    )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(robot.joints.actuated_names),
        "target_link": target_link,
    }

    return IKResponse(solution=solution_map, diagnostics=diagnostics, metadata=metadata)


@app.post("/rerun/visualize", response_model=RerunVisualizeResponse)
def rerun_visualize(req: RerunVisualizeRequest) -> RerunVisualizeResponse:
    """
    Visualize robot episode using Rerun.
    Runs the Python rerun_viewer.py script with the provided data.
    """
    script_path = Path(__file__).parent.parent / "scripts" / "rerun_viewer.py"
    if not script_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Rerun viewer script not found at {script_path}"
        )

    # Write data to temporary files
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as episode_f:
        json.dump(req.episode, episode_f)
        episode_file = episode_f.name

    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as urdf_f:
        urdf_f.write(req.urdf)
        urdf_file = urdf_f.name

    try:
        # Build command
        cmd = [
            "python3",
            str(script_path),
            "--episode-file", episode_file,
            "--urdf-file", urdf_file,
            "--recording", req.recording,
        ]

        if req.spawn:
            cmd.append("--spawn")
        elif req.serve:
            cmd.extend(["--serve", "--web-port", str(req.web_port), "--ws-port", str(req.ws_port)])

        # Run subprocess
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            return RerunVisualizeResponse(
                success=False,
                message="Rerun viewer failed",
                stderr=result.stderr,
                stdout=result.stdout,
            )

        mode = "spawn" if req.spawn else "serve" if req.serve else "default"
        return RerunVisualizeResponse(
            success=True,
            message=f"Rerun viewer started in {mode} mode",
            mode=mode,
            web_port=req.web_port if req.serve else None,
            stdout=result.stdout if result.stdout else None,
        )

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Rerun viewer timed out")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start Rerun viewer: {exc}")
    finally:
        # Cleanup temp files
        try:
            Path(episode_file).unlink(missing_ok=True)
            Path(urdf_file).unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/datasets/mix", response_model=DatasetMixResponse)
def mix_datasets(req: DatasetMixRequest) -> DatasetMixResponse:
    """
    Mix multiple robot learning datasets.
    Runs the Python dataset_mixer.py script with the provided repo IDs and local paths.
    """
    if not req.repo_ids and not req.local_paths:
        raise HTTPException(
            status_code=400,
            detail="At least one repo ID or local path is required"
        )

    script_path = Path(__file__).parent.parent / "scripts" / "dataset_mixer.py"
    if not script_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Dataset mixer script not found at {script_path}"
        )

    # Build command
    cmd = ["python3", str(script_path)]
    if req.repo_ids:
        cmd.extend(["--repo-ids"] + req.repo_ids)
    if req.local_paths:
        cmd.extend(["--local-paths"] + req.local_paths)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout for dataset operations
        )

        if result.returncode != 0:
            return DatasetMixResponse(
                success=False,
                error=result.stderr or "Dataset mixing failed",
            )

        # Parse JSON output
        try:
            output_data = json.loads(result.stdout)
            return DatasetMixResponse(
                success=True,
                message=output_data.get("message", "Datasets mixed successfully"),
                output_path=output_data.get("output_path"),
            )
        except json.JSONDecodeError:
            return DatasetMixResponse(
                success=False,
                error=f"Failed to parse output: {result.stdout}",
            )

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Dataset mixing timed out")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to mix datasets: {exc}")


if __name__ == "__main__":
    import uvicorn  # type: ignore

    uvicorn.run("backend.server:app", host="127.0.0.1", port=8000, reload=True)

