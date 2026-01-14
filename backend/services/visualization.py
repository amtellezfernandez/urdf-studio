from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from fastapi import HTTPException

from backend.core.paths import SCRIPTS_DIR
from backend.models.visualization import RerunVisualizeRequest, RerunVisualizeResponse


def run_rerun_visualization(req: RerunVisualizeRequest) -> RerunVisualizeResponse:
    """Visualize robot episode using Rerun."""
    script_path = SCRIPTS_DIR / "rerun_viewer.py"
    if not script_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Rerun viewer script not found at {script_path}"
        )

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as episode_f:
        json.dump(req.episode, episode_f)
        episode_file = episode_f.name

    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as urdf_f:
        urdf_f.write(req.urdf)
        urdf_file = urdf_f.name

    try:
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
        try:
            Path(episode_file).unlink(missing_ok=True)
            Path(urdf_file).unlink(missing_ok=True)
        except Exception:
            pass
