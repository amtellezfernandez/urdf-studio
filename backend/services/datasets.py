from __future__ import annotations

import json
import subprocess

from fastapi import HTTPException

from backend.core.paths import SCRIPTS_DIR
from backend.models.datasets import DatasetMixRequest, DatasetMixResponse


def mix_datasets(req: DatasetMixRequest) -> DatasetMixResponse:
    """Mix multiple robot learning datasets."""
    if not req.repo_ids and not req.local_paths:
        raise HTTPException(
            status_code=400,
            detail="At least one repo ID or local path is required"
        )

    script_path = SCRIPTS_DIR / "dataset_mixer.py"
    if not script_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Dataset mixer script not found at {script_path}"
        )

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
            timeout=300,
        )

        if result.returncode != 0:
            return DatasetMixResponse(
                success=False,
                error=result.stderr or "Dataset mixing failed",
            )

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
