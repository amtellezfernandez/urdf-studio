"""URDF Studio CLI - Command-line interface for URDF Studio.

This module provides a CLI using click for interacting with URDF Studio
from the command line, supporting training, datasets, artifacts, and evaluation.

Usage:
    urdf-studio train --dataset lerobot/pusht --model act --epochs 1
    urdf-studio status JOB_ID
    urdf-studio cancel JOB_ID
    urdf-studio list --status running

    urdf-studio datasets browse
    urdf-studio datasets search "aloha"
    urdf-studio datasets info lerobot/aloha

    urdf-studio artifacts list JOB_ID
    urdf-studio artifacts download JOB_ID checkpoint.pt ./local/

    urdf-studio eval --checkpoint path/to/checkpoint.pt --episodes 1
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Optional

import click

from backend.sdk.client import URDFStudioClient, APIError, ConnectionError as SDKConnectionError


def run_async(coro):
    """Run an async coroutine synchronously."""
    return asyncio.get_event_loop().run_until_complete(coro)


def output_result(data: dict, as_json: bool = False, indent: int = 2) -> None:
    """Output result as JSON or formatted text."""
    if as_json:
        click.echo(json.dumps(data, indent=indent, default=str))
    else:
        # Pretty print for human consumption
        for key, value in data.items():
            if isinstance(value, dict):
                click.echo(f"{key}:")
                for k, v in value.items():
                    click.echo(f"  {k}: {v}")
            elif isinstance(value, list):
                click.echo(f"{key}:")
                for item in value:
                    if isinstance(item, dict):
                        click.echo(f"  - {item}")
                    else:
                        click.echo(f"  - {item}")
            else:
                click.echo(f"{key}: {value}")


def format_progress_bar(progress: float, width: int = 40) -> str:
    """Format a progress bar string."""
    filled = int(width * progress)
    bar = "=" * filled + "-" * (width - filled)
    return f"[{bar}] {progress * 100:.1f}%"


# ============================================================================
# Main CLI Group
# ============================================================================


@click.group()
@click.option(
    "--base-url",
    default="http://localhost:8000",
    envvar="URDF_STUDIO_URL",
    help="URDF Studio server URL",
)
@click.option(
    "--timeout",
    default=30.0,
    type=float,
    help="Request timeout in seconds",
)
@click.option(
    "--json",
    "output_json",
    is_flag=True,
    help="Output results as JSON",
)
@click.pass_context
def cli(ctx, base_url: str, timeout: float, output_json: bool):
    """URDF Studio CLI - Train and evaluate robot learning policies.

    Use --json flag for programmatic output.

    Examples:
        urdf-studio train --dataset lerobot/pusht --model act --epochs 1
        urdf-studio status JOB_ID
        urdf-studio datasets browse
        urdf-studio eval --checkpoint ./outputs/checkpoint.pt
    """
    ctx.ensure_object(dict)
    ctx.obj["base_url"] = base_url
    ctx.obj["timeout"] = timeout
    ctx.obj["output_json"] = output_json


# ============================================================================
# Training Commands
# ============================================================================


@cli.command()
@click.option(
    "--dataset",
    required=True,
    help="Dataset repo ID (e.g., lerobot/pusht) or local path",
)
@click.option(
    "--model",
    default="act",
    type=click.Choice(["act", "diffusion_policy", "tdmpc", "vq_bet"]),
    help="Model architecture",
)
@click.option(
    "--epochs",
    default=100,
    type=int,
    help="Number of training epochs",
)
@click.option(
    "--batch-size",
    default=32,
    type=int,
    help="Training batch size",
)
@click.option(
    "--learning-rate",
    default=1e-4,
    type=float,
    help="Learning rate",
)
@click.option(
    "--compute",
    default="local",
    type=click.Choice(["local", "modal", "runpod"]),
    help="Compute backend",
)
@click.option(
    "--device",
    default="cuda",
    type=click.Choice(["cuda", "cpu", "mps"]),
    help="Device for local training",
)
@click.option(
    "--gpu",
    default=None,
    help="GPU type for cloud training (e.g., T4, A100-40GB)",
)
@click.option(
    "--tracker",
    default="none",
    type=click.Choice(["none", "mlflow", "wandb"]),
    help="Experiment tracker",
)
@click.option(
    "--tracker-project",
    default=None,
    help="Project name for tracker",
)
@click.option(
    "--output-dir",
    default="./outputs",
    help="Output directory for checkpoints",
)
@click.option(
    "--run-name",
    default=None,
    help="Name for this training run",
)
@click.option(
    "--wait",
    is_flag=True,
    help="Wait for training to complete",
)
@click.pass_context
def train(
    ctx,
    dataset: str,
    model: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    compute: str,
    device: str,
    gpu: Optional[str],
    tracker: str,
    tracker_project: Optional[str],
    output_dir: str,
    run_name: Optional[str],
    wait: bool,
):
    """Start a training job.

    Examples:
        urdf-studio train --dataset lerobot/pusht --model act --epochs 1
        urdf-studio train --dataset lerobot/aloha_sim_insertion --model diffusion_policy
        urdf-studio train --dataset ./local/data --model act --compute modal --gpu T4
    """
    output_json = ctx.obj.get("output_json", False)

    async def _train():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                if not output_json:
                    click.echo(f"Starting training job...")
                    click.echo(f"  Dataset: {dataset}")
                    click.echo(f"  Model: {model}")
                    click.echo(f"  Epochs: {epochs}")
                    click.echo(f"  Compute: {compute}")

                job = await client.training.start(
                    dataset=dataset,
                    model=model,
                    epochs=epochs,
                    batch_size=batch_size,
                    learning_rate=learning_rate,
                    compute=compute,
                    device=device,
                    gpu=gpu,
                    tracker=tracker,
                    tracker_project=tracker_project,
                    output_dir=output_dir,
                    run_name=run_name,
                )

                if output_json:
                    output_result({
                        "job_id": job.job_id,
                        "success": job.success,
                        "message": job.message,
                        "tracker_url": job.tracker_url,
                    }, as_json=True)
                else:
                    if job.success:
                        click.echo(click.style(f"\nJob started: {job.job_id}", fg="green"))
                        if job.tracker_url:
                            click.echo(f"Tracker URL: {job.tracker_url}")
                    else:
                        click.echo(click.style(f"\nFailed: {job.message}", fg="red"))
                        sys.exit(1)

                if wait and job.success:
                    if not output_json:
                        click.echo("\nWaiting for completion...")

                    def on_progress(status):
                        if not output_json and status.progress:
                            progress_bar = format_progress_bar(status.progress.overall_progress)
                            click.echo(
                                f"\r{progress_bar} Epoch {status.progress.current_epoch}/{status.progress.total_epochs}",
                                nl=False,
                            )

                    final_status = await client.training.wait_for_completion(
                        job.job_id,
                        poll_interval=5.0,
                        on_progress=on_progress,
                    )

                    if output_json:
                        output_result({
                            "job_id": final_status.job_id,
                            "status": final_status.status.value,
                            "error": final_status.error,
                        }, as_json=True)
                    else:
                        click.echo()  # Newline after progress bar
                        if final_status.is_complete:
                            click.echo(click.style("\nTraining completed!", fg="green"))
                        else:
                            click.echo(click.style(f"\nTraining {final_status.status.value}", fg="yellow"))
                            if final_status.error:
                                click.echo(f"Error: {final_status.error}")

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)
        except APIError as e:
            if output_json:
                output_result({"error": str(e), "type": "api_error", "status_code": e.status_code}, as_json=True)
            else:
                click.echo(click.style(f"API error: {e}", fg="red"))
            sys.exit(1)

    run_async(_train())


@cli.command()
@click.argument("job_id")
@click.option(
    "--watch",
    is_flag=True,
    help="Continuously watch status",
)
@click.pass_context
def status(ctx, job_id: str, watch: bool):
    """Get status of a training job.

    Examples:
        urdf-studio status train_abc123
        urdf-studio status train_abc123 --watch
    """
    output_json = ctx.obj.get("output_json", False)

    async def _status():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                if watch:
                    # Continuous watching
                    import time
                    try:
                        while True:
                            status = await client.training.get_status(job_id)

                            if output_json:
                                output_result({
                                    "job_id": status.job_id,
                                    "status": status.status.value,
                                    "progress": {
                                        "current_epoch": status.progress.current_epoch if status.progress else 0,
                                        "total_epochs": status.progress.total_epochs if status.progress else 0,
                                        "overall_progress": status.progress.overall_progress if status.progress else 0,
                                    } if status.progress else None,
                                    "metrics": {
                                        "loss": status.metrics.loss if status.metrics else None,
                                    } if status.metrics else None,
                                }, as_json=True)
                            else:
                                click.clear()
                                click.echo(f"Job: {status.job_id}")
                                click.echo(f"Status: {status.status.value}")
                                if status.progress:
                                    progress_bar = format_progress_bar(status.progress.overall_progress)
                                    click.echo(f"Progress: {progress_bar}")
                                    click.echo(f"Epoch: {status.progress.current_epoch}/{status.progress.total_epochs}")
                                if status.metrics and status.metrics.loss:
                                    click.echo(f"Loss: {status.metrics.loss:.4f}")
                                if status.tracker_url:
                                    click.echo(f"Tracker: {status.tracker_url}")

                            if status.is_terminal:
                                break

                            await asyncio.sleep(5)
                    except KeyboardInterrupt:
                        click.echo("\nStopped watching")
                else:
                    # Single status check
                    status = await client.training.get_status(job_id)

                    if output_json:
                        output_result({
                            "job_id": status.job_id,
                            "status": status.status.value,
                            "progress": {
                                "current_epoch": status.progress.current_epoch,
                                "total_epochs": status.progress.total_epochs,
                                "current_step": status.progress.current_step,
                                "total_steps": status.progress.total_steps,
                                "overall_progress": status.progress.overall_progress,
                            } if status.progress else None,
                            "metrics": {
                                "loss": status.metrics.loss,
                                "learning_rate": status.metrics.learning_rate,
                            } if status.metrics else None,
                            "compute_backend": status.compute_backend,
                            "tracker_url": status.tracker_url,
                            "error": status.error,
                        }, as_json=True)
                    else:
                        click.echo(f"Job ID: {status.job_id}")

                        status_color = {
                            "running": "blue",
                            "completed": "green",
                            "failed": "red",
                            "cancelled": "yellow",
                        }.get(status.status.value, "white")

                        click.echo(f"Status: {click.style(status.status.value, fg=status_color)}")
                        click.echo(f"Compute: {status.compute_backend}")

                        if status.progress:
                            progress_bar = format_progress_bar(status.progress.overall_progress)
                            click.echo(f"Progress: {progress_bar}")
                            click.echo(f"Epoch: {status.progress.current_epoch}/{status.progress.total_epochs}")
                            click.echo(f"Step: {status.progress.current_step}/{status.progress.total_steps}")

                        if status.metrics:
                            click.echo("Metrics:")
                            if status.metrics.loss is not None:
                                click.echo(f"  Loss: {status.metrics.loss:.4f}")
                            if status.metrics.learning_rate is not None:
                                click.echo(f"  LR: {status.metrics.learning_rate:.2e}")

                        if status.tracker_url:
                            click.echo(f"Tracker: {status.tracker_url}")

                        if status.error:
                            click.echo(click.style(f"Error: {status.error}", fg="red"))

                        if status.logs_tail:
                            click.echo("\nRecent logs:")
                            click.echo(status.logs_tail)

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_status())


@cli.command()
@click.argument("job_id")
@click.option(
    "--reason",
    default=None,
    help="Reason for cancellation",
)
@click.pass_context
def cancel(ctx, job_id: str, reason: Optional[str]):
    """Cancel a running training job.

    Examples:
        urdf-studio cancel train_abc123
        urdf-studio cancel train_abc123 --reason "Wrong hyperparameters"
    """
    output_json = ctx.obj.get("output_json", False)

    async def _cancel():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                cancelled = await client.training.cancel(job_id, reason)

                if output_json:
                    output_result({
                        "job_id": job_id,
                        "cancelled": cancelled,
                    }, as_json=True)
                else:
                    if cancelled:
                        click.echo(click.style(f"Job {job_id} cancelled", fg="green"))
                    else:
                        click.echo(click.style(f"Failed to cancel job {job_id}", fg="red"))
                        sys.exit(1)

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_cancel())


@cli.command(name="list")
@click.option(
    "--status",
    "status_filter",
    default=None,
    type=click.Choice(["pending", "queued", "running", "completed", "failed", "cancelled"]),
    help="Filter by status",
)
@click.option(
    "--limit",
    default=10,
    type=int,
    help="Maximum jobs to return",
)
@click.pass_context
def list_jobs(ctx, status_filter: Optional[str], limit: int):
    """List training jobs.

    Examples:
        urdf-studio list
        urdf-studio list --status running
        urdf-studio list --limit 5
    """
    output_json = ctx.obj.get("output_json", False)

    async def _list():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                from backend.sdk.models import JobStatus as SDKJobStatus

                status = None
                if status_filter:
                    status = SDKJobStatus(status_filter)

                jobs = await client.training.list_jobs(limit=limit, status=status)

                if output_json:
                    output_result({
                        "jobs": jobs,
                        "count": len(jobs),
                    }, as_json=True)
                else:
                    if not jobs:
                        click.echo("No jobs found")
                        return

                    click.echo(f"Found {len(jobs)} job(s):\n")
                    for job in jobs:
                        status_color = {
                            "running": "blue",
                            "completed": "green",
                            "failed": "red",
                            "cancelled": "yellow",
                        }.get(job.get("status", ""), "white")

                        click.echo(f"  {job.get('job_id', 'unknown')}")
                        click.echo(f"    Status: {click.style(job.get('status', 'unknown'), fg=status_color)}")
                        click.echo(f"    Model: {job.get('model_architecture', 'unknown')}")
                        click.echo(f"    Dataset: {job.get('dataset_id', 'unknown')}")
                        click.echo(f"    Started: {job.get('started_at', 'unknown')}")
                        click.echo()

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_list())


# ============================================================================
# Datasets Commands
# ============================================================================


@cli.group()
def datasets():
    """Dataset management commands.

    Browse, search, and get info about LeRobot datasets.
    """
    pass


@datasets.command(name="browse")
@click.option(
    "--limit",
    default=20,
    type=int,
    help="Maximum datasets to return",
)
@click.pass_context
def datasets_browse(ctx, limit: int):
    """Browse available LeRobot datasets.

    Examples:
        urdf-studio datasets browse
        urdf-studio datasets browse --limit 50
    """
    output_json = ctx.obj.get("output_json", False)

    async def _browse():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                datasets_list = await client.datasets.browse(limit=limit)

                if output_json:
                    output_result({
                        "datasets": [
                            {
                                "repo_id": d.repo_id,
                                "description": d.description,
                                "downloads": d.downloads,
                                "likes": d.likes,
                                "robot_type": d.robot_type,
                            }
                            for d in datasets_list
                        ],
                        "count": len(datasets_list),
                    }, as_json=True)
                else:
                    if not datasets_list:
                        click.echo("No datasets found")
                        return

                    click.echo(f"Found {len(datasets_list)} dataset(s):\n")
                    for ds in datasets_list:
                        click.echo(f"  {click.style(ds.repo_id, fg='cyan')}")
                        if ds.description:
                            click.echo(f"    {ds.description[:60]}...")
                        if ds.robot_type:
                            click.echo(f"    Robot: {ds.robot_type}")
                        click.echo(f"    Downloads: {ds.downloads or 0} | Likes: {ds.likes or 0}")
                        click.echo()

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_browse())


@datasets.command(name="search")
@click.argument("query")
@click.option(
    "--limit",
    default=20,
    type=int,
    help="Maximum datasets to return",
)
@click.pass_context
def datasets_search(ctx, query: str, limit: int):
    """Search for datasets by query.

    Examples:
        urdf-studio datasets search "aloha"
        urdf-studio datasets search "pusht" --limit 5
    """
    output_json = ctx.obj.get("output_json", False)

    async def _search():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                datasets_list = await client.datasets.search(query, limit=limit)

                if output_json:
                    output_result({
                        "query": query,
                        "datasets": [
                            {
                                "repo_id": d.repo_id,
                                "description": d.description,
                                "downloads": d.downloads,
                                "likes": d.likes,
                                "robot_type": d.robot_type,
                            }
                            for d in datasets_list
                        ],
                        "count": len(datasets_list),
                    }, as_json=True)
                else:
                    if not datasets_list:
                        click.echo(f"No datasets found matching '{query}'")
                        return

                    click.echo(f"Found {len(datasets_list)} dataset(s) matching '{query}':\n")
                    for ds in datasets_list:
                        click.echo(f"  {click.style(ds.repo_id, fg='cyan')}")
                        if ds.description:
                            click.echo(f"    {ds.description[:60]}...")
                        if ds.robot_type:
                            click.echo(f"    Robot: {ds.robot_type}")
                        click.echo()

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_search())


@datasets.command(name="info")
@click.argument("repo_id")
@click.pass_context
def datasets_info(ctx, repo_id: str):
    """Get detailed info about a dataset.

    Examples:
        urdf-studio datasets info lerobot/aloha_sim_insertion
        urdf-studio datasets info lerobot/pusht
    """
    output_json = ctx.obj.get("output_json", False)

    async def _info():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                info = await client.datasets.info(repo_id)

                if info is None:
                    if output_json:
                        output_result({"error": f"Dataset {repo_id} not found"}, as_json=True)
                    else:
                        click.echo(click.style(f"Dataset {repo_id} not found", fg="red"))
                    sys.exit(1)

                if output_json:
                    output_result({
                        "repo_id": info.repo_id,
                        "description": info.description,
                        "downloads": info.downloads,
                        "likes": info.likes,
                        "robot_type": info.robot_type,
                        "num_episodes": info.num_episodes,
                        "total_frames": info.total_frames,
                        "fps": info.fps,
                        "features": info.features,
                        "created_at": info.created_at,
                        "updated_at": info.updated_at,
                    }, as_json=True)
                else:
                    click.echo(f"\n{click.style(info.repo_id, fg='cyan', bold=True)}")
                    if info.description:
                        click.echo(f"\n{info.description}")
                    click.echo()
                    if info.robot_type:
                        click.echo(f"Robot Type: {info.robot_type}")
                    if info.num_episodes:
                        click.echo(f"Episodes: {info.num_episodes}")
                    if info.total_frames:
                        click.echo(f"Total Frames: {info.total_frames}")
                    if info.fps:
                        click.echo(f"FPS: {info.fps}")
                    click.echo(f"Downloads: {info.downloads or 0}")
                    click.echo(f"Likes: {info.likes or 0}")
                    if info.features:
                        click.echo(f"Features: {', '.join(info.features)}")
                    if info.created_at:
                        click.echo(f"Created: {info.created_at}")
                    if info.updated_at:
                        click.echo(f"Updated: {info.updated_at}")

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_info())


# ============================================================================
# Artifacts Commands
# ============================================================================


@cli.group()
def artifacts():
    """Artifact management commands.

    List, download, and upload training artifacts.
    """
    pass


@artifacts.command(name="list")
@click.argument("job_id")
@click.pass_context
def artifacts_list(ctx, job_id: str):
    """List artifacts for a job.

    Examples:
        urdf-studio artifacts list train_abc123
    """
    output_json = ctx.obj.get("output_json", False)

    async def _list():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                artifacts_list = await client.artifacts.list(job_id)

                if output_json:
                    output_result({
                        "job_id": job_id,
                        "artifacts": [
                            {
                                "name": a.name,
                                "path": a.path,
                                "size_bytes": a.size_bytes,
                                "artifact_type": a.artifact_type,
                                "created_at": a.created_at,
                            }
                            for a in artifacts_list
                        ],
                        "count": len(artifacts_list),
                    }, as_json=True)
                else:
                    if not artifacts_list:
                        click.echo(f"No artifacts found for job {job_id}")
                        return

                    click.echo(f"Artifacts for job {job_id}:\n")
                    for artifact in artifacts_list:
                        size_str = _format_size(artifact.size_bytes) if artifact.size_bytes else "unknown"
                        click.echo(f"  {click.style(artifact.name, fg='cyan')}")
                        click.echo(f"    Type: {artifact.artifact_type or 'unknown'}")
                        click.echo(f"    Size: {size_str}")
                        click.echo(f"    Path: {artifact.path}")
                        click.echo()

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_list())


@artifacts.command(name="download")
@click.argument("job_id")
@click.argument("artifact_path")
@click.argument("dest", type=click.Path())
@click.pass_context
def artifacts_download(ctx, job_id: str, artifact_path: str, dest: str):
    """Download an artifact.

    Examples:
        urdf-studio artifacts download train_abc123 checkpoint.pt ./local/
        urdf-studio artifacts download train_abc123 checkpoints/epoch_10.pt .
    """
    output_json = ctx.obj.get("output_json", False)

    async def _download():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"] * 10,  # Longer timeout for downloads
            ) as client:
                if not output_json:
                    click.echo(f"Downloading {artifact_path}...")

                dest_path = await client.artifacts.download(job_id, artifact_path, dest)

                if output_json:
                    output_result({
                        "job_id": job_id,
                        "artifact_path": artifact_path,
                        "destination": str(dest_path),
                        "success": True,
                    }, as_json=True)
                else:
                    click.echo(click.style(f"Downloaded to {dest_path}", fg="green"))

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)
        except APIError as e:
            if output_json:
                output_result({"error": str(e), "type": "api_error"}, as_json=True)
            else:
                click.echo(click.style(f"Download failed: {e}", fg="red"))
            sys.exit(1)

    run_async(_download())


@artifacts.command(name="upload")
@click.argument("job_id")
@click.argument("artifact_path")
@click.argument("src", type=click.Path(exists=True))
@click.pass_context
def artifacts_upload(ctx, job_id: str, artifact_path: str, src: str):
    """Upload an artifact.

    Examples:
        urdf-studio artifacts upload train_abc123 custom_checkpoint.pt ./my_checkpoint.pt
    """
    output_json = ctx.obj.get("output_json", False)

    async def _upload():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"] * 10,  # Longer timeout for uploads
            ) as client:
                if not output_json:
                    click.echo(f"Uploading {src}...")

                artifact = await client.artifacts.upload(job_id, artifact_path, src)

                if output_json:
                    output_result({
                        "job_id": job_id,
                        "artifact": {
                            "name": artifact.name,
                            "path": artifact.path,
                            "size_bytes": artifact.size_bytes,
                        },
                        "success": True,
                    }, as_json=True)
                else:
                    click.echo(click.style(f"Uploaded {artifact.name}", fg="green"))

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)
        except APIError as e:
            if output_json:
                output_result({"error": str(e), "type": "api_error"}, as_json=True)
            else:
                click.echo(click.style(f"Upload failed: {e}", fg="red"))
            sys.exit(1)

    run_async(_upload())


def _format_size(size_bytes: int) -> str:
    """Format file size in human-readable form."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ============================================================================
# Evaluation Commands
# ============================================================================


@cli.command(name="eval")
@click.option(
    "--checkpoint",
    required=True,
    type=click.Path(exists=True),
    help="Path to checkpoint file",
)
@click.option(
    "--episodes",
    default=1,
    type=int,
    help="Number of episodes to run",
)
@click.option(
    "--max-steps",
    default=1000,
    type=int,
    help="Maximum steps per episode",
)
@click.option(
    "--urdf",
    default=None,
    type=click.Path(exists=True),
    help="Path to URDF file for visualization",
)
@click.option(
    "--output",
    default=None,
    type=click.Path(),
    help="Output file for evaluation results (JSON)",
)
@click.pass_context
def evaluate(
    ctx,
    checkpoint: str,
    episodes: int,
    max_steps: int,
    urdf: Optional[str],
    output: Optional[str],
):
    """Evaluate a trained policy.

    Examples:
        urdf-studio eval --checkpoint ./outputs/checkpoint.pt
        urdf-studio eval --checkpoint ./outputs/checkpoint.pt --episodes 5
        urdf-studio eval --checkpoint ./outputs/checkpoint.pt --urdf robot.urdf
    """
    output_json = ctx.obj.get("output_json", False)

    async def _eval():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"] * 10,  # Longer timeout for evaluation
            ) as client:
                if not output_json:
                    click.echo(f"Evaluating checkpoint: {checkpoint}")
                    click.echo(f"Episodes: {episodes}")
                    click.echo(f"Max steps: {max_steps}")
                    click.echo()

                urdf_content = None
                if urdf:
                    urdf_content = Path(urdf).read_text()

                result = await client.training.evaluate(
                    checkpoint_path=checkpoint,
                    num_episodes=episodes,
                    max_steps=max_steps,
                    urdf=urdf_content,
                )

                result_dict = {
                    "success": result.success,
                    "num_episodes": result.num_episodes,
                    "metrics": result.metrics,
                    "episodes": [
                        {
                            "episode_index": ep.episode_index,
                            "num_steps": ep.num_steps,
                            "actions": ep.actions[:5],  # First 5 actions for preview
                        }
                        for ep in result.episodes
                    ],
                    "error": result.error,
                }

                if output_json:
                    output_result(result_dict, as_json=True)
                else:
                    if result.success:
                        click.echo(click.style("Evaluation completed!", fg="green"))
                        click.echo(f"\nEpisodes: {result.num_episodes}")

                        if result.metrics:
                            click.echo("\nMetrics:")
                            for key, value in result.metrics.items():
                                click.echo(f"  {key}: {value}")

                        for ep in result.episodes:
                            click.echo(f"\nEpisode {ep.episode_index}:")
                            click.echo(f"  Steps: {ep.num_steps}")
                            if ep.actions:
                                click.echo(f"  First action: {ep.actions[0]}")
                    else:
                        click.echo(click.style(f"Evaluation failed: {result.error}", fg="red"))
                        sys.exit(1)

                # Save to file if requested
                if output:
                    full_result = {
                        "success": result.success,
                        "num_episodes": result.num_episodes,
                        "metrics": result.metrics,
                        "episodes": [
                            {
                                "episode_index": ep.episode_index,
                                "actions": ep.actions,
                                "observations": ep.observations,
                                "timestamps": ep.timestamps,
                            }
                            for ep in result.episodes
                        ],
                        "error": result.error,
                    }
                    Path(output).write_text(json.dumps(full_result, indent=2))
                    if not output_json:
                        click.echo(f"\nResults saved to {output}")

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)
        except APIError as e:
            if output_json:
                output_result({"error": str(e), "type": "api_error"}, as_json=True)
            else:
                click.echo(click.style(f"API error: {e}", fg="red"))
            sys.exit(1)

    run_async(_eval())


# ============================================================================
# Health Check
# ============================================================================


@cli.command()
@click.pass_context
def health(ctx):
    """Check server health.

    Examples:
        urdf-studio health
    """
    output_json = ctx.obj.get("output_json", False)

    async def _health():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                health_status = await client.health.check()

                if output_json:
                    output_result(health_status, as_json=True)
                else:
                    click.echo(f"Server: {ctx.obj['base_url']}")
                    status = health_status.get("status", "unknown")
                    color = "green" if status == "ok" else "red"
                    click.echo(f"Status: {click.style(status, fg=color)}")

                    if "components" in health_status:
                        click.echo("\nComponents:")
                        for comp, state in health_status["components"].items():
                            comp_color = "green" if state else "red"
                            click.echo(f"  {comp}: {click.style('ok' if state else 'unavailable', fg=comp_color)}")

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error", "healthy": False}, as_json=True)
            else:
                click.echo(click.style(f"Cannot connect to {ctx.obj['base_url']}", fg="red"))
            sys.exit(1)

    run_async(_health())


# ============================================================================
# Models Commands
# ============================================================================


@cli.command(name="models")
@click.pass_context
def list_models(ctx):
    """List available model architectures.

    Examples:
        urdf-studio models
    """
    output_json = ctx.obj.get("output_json", False)

    async def _models():
        try:
            async with URDFStudioClient(
                ctx.obj["base_url"],
                timeout=ctx.obj["timeout"],
            ) as client:
                models = await client.training.list_models()

                if output_json:
                    output_result({
                        "models": [
                            {
                                "name": m.name,
                                "display_name": m.display_name,
                                "description": m.description,
                                "recommended_for": m.recommended_for,
                            }
                            for m in models
                        ],
                    }, as_json=True)
                else:
                    click.echo("Available model architectures:\n")
                    for model in models:
                        click.echo(f"  {click.style(model.name, fg='cyan', bold=True)}")
                        click.echo(f"    {model.display_name}")
                        click.echo(f"    {model.description}")
                        if model.recommended_for:
                            click.echo(f"    Recommended for: {', '.join(model.recommended_for)}")
                        click.echo()

        except SDKConnectionError as e:
            if output_json:
                output_result({"error": str(e), "type": "connection_error"}, as_json=True)
            else:
                click.echo(click.style(f"Connection error: {e}", fg="red"))
            sys.exit(1)

    run_async(_models())


# ============================================================================
# Entry Point
# ============================================================================


def main():
    """Main entry point for CLI."""
    cli(obj={})


if __name__ == "__main__":
    main()
