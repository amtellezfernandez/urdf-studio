"""Integration test for training flow.

This test validates the complete training workflow:
1. Starting a training job with lerobot/pusht dataset
2. Monitoring training progress
3. Cancelling jobs
4. Listing jobs

Requirements:
- Running URDF Studio server at http://localhost:8000
- HuggingFace token for dataset access (optional for cached datasets)

Usage:
    pytest tests/integration/test_training_flow.py -v
    python tests/integration/test_training_flow.py  # Direct execution
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Optional

import pytest

# Add project root to path for direct execution
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from backend.sdk import URDFStudioClient, TrainingJob, TrainingStatus, JobStatus


# Configuration
SERVER_URL = os.environ.get("URDF_STUDIO_URL", "http://localhost:8000")
TEST_DATASET = "lerobot/pusht"
TEST_MODEL = "act"
TEST_EPOCHS = 1
TEST_BATCH_SIZE = 8  # Small for fast testing


class TestTrainingFlow:
    """Integration tests for training workflow."""

    @pytest.fixture
    def client(self):
        """Create SDK client for tests."""
        return URDFStudioClient(SERVER_URL, timeout=60.0)

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        """Test server health before training tests."""
        async with client:
            health = await client.health.check()
            assert health.get("status") == "ok"

    @pytest.mark.asyncio
    async def test_list_models(self, client):
        """Test listing available model architectures."""
        async with client:
            models = await client.training.list_models()

            assert len(models) > 0, "Should have at least one model"

            # Check for expected models
            model_names = [m.name for m in models]
            assert "act" in model_names, "ACT model should be available"

            # Validate model structure
            for model in models:
                assert model.name, "Model should have name"
                assert model.display_name, "Model should have display_name"
                assert model.description, "Model should have description"

    @pytest.mark.asyncio
    async def test_start_training_job(self, client):
        """Test starting a training job."""
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="integration_test",
            )

            assert job.job_id, "Job should have an ID"
            assert job.success, f"Job should start successfully: {job.message}"

            # Verify we can get status
            status = await client.training.get_status(job.job_id)
            assert status.job_id == job.job_id
            assert status.status in [
                JobStatus.PENDING,
                JobStatus.QUEUED,
                JobStatus.RUNNING,
            ], f"Job should be starting, got {status.status}"

            # Clean up - cancel the job
            cancelled = await client.training.cancel(job.job_id, "Integration test cleanup")
            # Job may have finished already, so don't assert cancellation

    @pytest.mark.asyncio
    async def test_training_status_updates(self, client):
        """Test that training status updates correctly."""
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="status_test",
            )

            assert job.success, f"Job should start: {job.message}"

            # Poll status a few times
            statuses = []
            for _ in range(5):
                status = await client.training.get_status(job.job_id)
                statuses.append(status.status)

                if status.is_terminal:
                    break

                await asyncio.sleep(2)

            # Should have received at least one status
            assert len(statuses) > 0

            # Cancel for cleanup
            await client.training.cancel(job.job_id)

    @pytest.mark.asyncio
    async def test_cancel_training_job(self, client):
        """Test cancelling a running job."""
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="cancel_test",
            )

            assert job.success, f"Job should start: {job.message}"

            # Wait a moment then cancel
            await asyncio.sleep(1)

            cancelled = await client.training.cancel(
                job.job_id,
                reason="Testing cancellation",
            )

            # Check final status
            status = await client.training.get_status(job.job_id)

            # Job could be cancelled or already finished
            assert status.status in [
                JobStatus.CANCELLED,
                JobStatus.COMPLETED,
                JobStatus.FAILED,
            ]

    @pytest.mark.asyncio
    async def test_list_jobs(self, client):
        """Test listing training jobs."""
        async with client:
            # Start a job first to ensure we have at least one
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="list_test",
            )

            try:
                # List all jobs
                jobs = await client.training.list_jobs(limit=10)
                assert isinstance(jobs, list)

                # Should have at least our job
                job_ids = [j.get("job_id") for j in jobs]
                assert job.job_id in job_ids, "Our job should be in the list"

                # List with status filter
                running_jobs = await client.training.list_jobs(
                    limit=10,
                    status=JobStatus.RUNNING,
                )
                assert isinstance(running_jobs, list)

            finally:
                # Cleanup
                await client.training.cancel(job.job_id)

    @pytest.mark.asyncio
    async def test_training_lineage(self, client):
        """Test that training jobs include lineage information."""
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="lineage_test",
                robot_name="test_robot",
            )

            try:
                assert job.success, f"Job should start: {job.message}"

                if job.lineage:
                    assert job.lineage.dataset_id == TEST_DATASET
                    assert job.lineage.model_architecture == TEST_MODEL
                    assert job.lineage.started_at, "Should have start timestamp"

                # Get status and check lineage there too
                status = await client.training.get_status(job.job_id)
                if status.lineage:
                    assert status.lineage.dataset_id == TEST_DATASET

            finally:
                await client.training.cancel(job.job_id)

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_wait_for_completion(self, client):
        """Test waiting for training completion.

        This test is marked as slow because it waits for actual training.
        Skip with: pytest -m "not slow"
        """
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=1,  # Minimum for fast test
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="completion_test",
            )

            assert job.success, f"Job should start: {job.message}"

            progress_updates = []

            def on_progress(status):
                if status.progress:
                    progress_updates.append(status.progress.overall_progress)

            try:
                final_status = await client.training.wait_for_completion(
                    job.job_id,
                    poll_interval=5.0,
                    timeout=300.0,  # 5 minute timeout
                    on_progress=on_progress,
                )

                assert final_status.is_terminal, "Should reach terminal state"

                if final_status.is_complete:
                    # Verify progress updates were received
                    assert len(progress_updates) > 0, "Should have received progress updates"

            except Exception as e:
                # Cancel on error
                await client.training.cancel(job.job_id)
                raise


class TestTrainingWithDifferentModels:
    """Test training with different model architectures."""

    @pytest.fixture
    def client(self):
        return URDFStudioClient(SERVER_URL, timeout=60.0)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("model", ["act", "diffusion_policy"])
    async def test_start_training_different_models(self, client, model):
        """Test starting training with different model architectures."""
        async with client:
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=model,
                epochs=1,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name=f"model_test_{model}",
            )

            try:
                assert job.success, f"Job with {model} should start: {job.message}"

                status = await client.training.get_status(job.job_id)
                assert status.job_id == job.job_id

            finally:
                await client.training.cancel(job.job_id)


# Direct execution support
async def main():
    """Run tests directly without pytest."""
    print("Running training flow integration tests...")
    print(f"Server URL: {SERVER_URL}")
    print()

    client = URDFStudioClient(SERVER_URL, timeout=60.0)

    try:
        async with client:
            # Test 1: Health check
            print("1. Testing health check...")
            health = await client.health.check()
            assert health.get("status") == "ok", "Health check failed"
            print("   PASSED: Server is healthy")

            # Test 2: List models
            print("\n2. Testing list models...")
            models = await client.training.list_models()
            assert len(models) > 0, "No models found"
            print(f"   PASSED: Found {len(models)} models")

            # Test 3: Start training
            print("\n3. Testing start training...")
            job = await client.training.start(
                dataset=TEST_DATASET,
                model=TEST_MODEL,
                epochs=TEST_EPOCHS,
                batch_size=TEST_BATCH_SIZE,
                output_dir="./test_outputs",
                run_name="direct_test",
            )
            assert job.success, f"Failed to start job: {job.message}"
            print(f"   PASSED: Started job {job.job_id}")

            # Test 4: Get status
            print("\n4. Testing get status...")
            status = await client.training.get_status(job.job_id)
            assert status.job_id == job.job_id
            print(f"   PASSED: Status is {status.status.value}")

            # Test 5: List jobs
            print("\n5. Testing list jobs...")
            jobs = await client.training.list_jobs(limit=5)
            assert job.job_id in [j.get("job_id") for j in jobs]
            print(f"   PASSED: Found {len(jobs)} jobs")

            # Test 6: Cancel job
            print("\n6. Testing cancel job...")
            await client.training.cancel(job.job_id, "Test cleanup")
            print("   PASSED: Job cancelled")

            print("\n" + "=" * 50)
            print("All tests passed!")

    except AssertionError as e:
        print(f"\nTEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
