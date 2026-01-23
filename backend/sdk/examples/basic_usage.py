#!/usr/bin/env python3
"""Basic SDK usage examples for AI agents.

This script demonstrates common SDK operations that AI agents
would use when interacting with URDF Studio programmatically.

Run with:
    python -m backend.sdk.examples.basic_usage
"""

import asyncio
from pathlib import Path

# Add project root to path for running as script
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from backend.sdk import URDFStudioClient


async def example_health_check(client: URDFStudioClient):
    """Check if the server is healthy."""
    print("\n=== Health Check ===")
    health = await client.health.check()
    print(f"Server status: {health['status']}")
    print(f"PyRoki available: {health.get('pyroki', False)}")
    print(f"Rerun available: {health.get('rerun', False)}")


async def example_list_samples(client: URDFStudioClient):
    """List available robot samples."""
    print("\n=== Available Samples ===")
    samples = await client.samples.list()
    for sample in samples[:5]:  # Show first 5
        print(f"  - {sample.id}: {sample.label}")


async def example_list_models(client: URDFStudioClient):
    """List available training models."""
    print("\n=== Available Models ===")
    models = await client.training.list_models()
    for model in models:
        print(f"  - {model.name}: {model.display_name}")
        print(f"    {model.description[:60]}...")


async def example_start_training(client: URDFStudioClient):
    """Start a training job and wait for completion."""
    print("\n=== Training Example ===")

    # Start training
    print("Starting training job...")
    job = await client.training.start(
        dataset="lerobot/pusht",
        model="act",
        epochs=2,  # Just 2 epochs for demo
        batch_size=8,
        compute="local",
        device="cpu",
        output_dir="./sdk_test_outputs",
    )

    print(f"Job started: {job.job_id}")
    print(f"Success: {job.success}")
    print(f"Message: {job.message}")

    if job.lineage:
        print(f"Dataset: {job.lineage.dataset_id}")
        print(f"Model: {job.lineage.model_architecture}")

    # Wait for completion with progress updates
    def on_progress(status):
        if status.progress:
            pct = status.progress.percent_complete
            print(f"  Progress: {pct:.1f}% (epoch {status.progress.current_epoch}/{status.progress.total_epochs})")
        if status.metrics and status.metrics.loss:
            print(f"  Loss: {status.metrics.loss:.4f}")

    print("\nWaiting for completion...")
    final_status = await client.training.wait_for_completion(
        job.job_id,
        poll_interval=1.0,
        on_progress=on_progress,
    )

    print(f"\nFinal status: {final_status.status.value}")
    if final_status.error:
        print(f"Error: {final_status.error}")


async def example_list_jobs(client: URDFStudioClient):
    """List recent training jobs."""
    print("\n=== Recent Jobs ===")
    jobs = await client.training.list_jobs(limit=5)
    for job in jobs:
        print(f"  - {job['job_id']}: {job['status']} ({job['model_architecture']})")


async def main():
    """Run all examples."""
    print("URDF Studio SDK Examples")
    print("=" * 50)

    # Connect to local server
    async with URDFStudioClient("http://localhost:8001") as client:
        await example_health_check(client)
        await example_list_samples(client)
        await example_list_models(client)
        await example_start_training(client)
        await example_list_jobs(client)

    print("\n" + "=" * 50)
    print("Examples completed!")


if __name__ == "__main__":
    asyncio.run(main())
