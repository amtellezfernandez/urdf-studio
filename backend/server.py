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

