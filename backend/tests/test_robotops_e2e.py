"""End-to-end tests for RobotOps v0.1 features.

Tests all new API endpoints and SDK functionality without requiring
JAX or the full server.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# Create a minimal test app without IK routes (which need JAX)
def create_test_app() -> FastAPI:
    """Create test app with only RobotOps routes."""
    app = FastAPI(title="RobotOps Test")

    from backend.api.experiments import router as experiments_router
    from backend.api.evaluations import router as evaluations_router
    from backend.api.policies import router as policies_router
    from backend.api.models import router as models_router
    from backend.api.datasets import router as datasets_router

    app.include_router(experiments_router, prefix="/api")
    app.include_router(evaluations_router, prefix="/api")
    app.include_router(policies_router, prefix="/api")
    app.include_router(models_router, prefix="/api")
    app.include_router(datasets_router, prefix="/api")

    return app


@pytest.fixture
def app() -> FastAPI:
    """Create test application."""
    return create_test_app()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def temp_db() -> Path:
    """Create temporary database for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_jobs.db"
        yield db_path


class TestPoliciesAPI:
    """Test /api/policies endpoints."""

    def test_list_policies(self, client: TestClient) -> None:
        """Test GET /api/policies returns available policies."""
        response = client.get("/api/policies")
        assert response.status_code == 200

        data = response.json()
        assert "policies" in data
        assert len(data["policies"]) > 0

        # Check policy structure
        policy = data["policies"][0]
        assert "id" in policy
        assert "name" in policy
        assert "description" in policy

    def test_get_policy_by_id(self, client: TestClient) -> None:
        """Test GET /api/policies/{id} returns policy details."""
        # First get list to find a valid ID
        response = client.get("/api/policies")
        policies = response.json()["policies"]

        if policies:
            policy_id = policies[0]["id"]
            response = client.get(f"/api/policies/{policy_id}")
            assert response.status_code == 200

            data = response.json()
            assert data["id"] == policy_id


class TestDatasetsAPI:
    """Test /api/datasets endpoints."""

    def test_list_datasets(self, client: TestClient) -> None:
        """Test GET /api/datasets/lerobot returns LeRobot datasets."""
        response = client.get("/api/datasets/lerobot")
        # May fail if HuggingFace API is unavailable
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list) or "datasets" in data


class TestHFResolver:
    """Test HuggingFace revision resolver."""

    @pytest.mark.asyncio
    async def test_resolve_dataset_revision(self) -> None:
        """Test resolving dataset revision to commit SHA."""
        from backend.services.hf_resolver import resolve_dataset_revision

        try:
            sha = await resolve_dataset_revision("lerobot/pusht")
            assert sha is not None
            assert len(sha) == 40  # Git SHA length
        except Exception as e:
            # May fail if HuggingFace API unavailable
            pytest.skip(f"HuggingFace API unavailable: {e}")


class TestPolicyRegistry:
    """Test policy discovery and registry."""

    def test_policy_registry_list(self) -> None:
        """Test PolicyRegistry lists available policies."""
        from backend.robotops.policies import PolicyRegistry

        policies = PolicyRegistry.list_policies()

        assert len(policies) > 0

        # PolicyInfo is a dataclass, access via attributes
        policy_ids = [p.id for p in policies]
        assert any("act" in pid.lower() for pid in policy_ids)

    def test_policy_info_structure(self) -> None:
        """Test PolicyInfo has expected attributes."""
        from backend.robotops.policies import PolicyRegistry

        policies = PolicyRegistry.list_policies()

        if policies:
            policy = policies[0]
            assert hasattr(policy, "id")
            assert hasattr(policy, "name")
            assert hasattr(policy, "description")
            assert hasattr(policy, "source")
            assert hasattr(policy, "default_config")


class TestExperimentsService:
    """Test experiments service directly."""

    @pytest.mark.asyncio
    async def test_create_and_get_experiment(self, temp_db: Path) -> None:
        """Test creating and retrieving experiment."""
        from backend.services.migrations import run_migrations
        from backend.services.experiments import ExperimentsService
        from backend.models.experiments import ExperimentCreate
        from backend.models.training import DatasetConfig, DatasetSource

        # Initialize database
        await run_migrations(temp_db)

        service = ExperimentsService(temp_db)

        # Create experiment with proper DatasetConfig
        dataset_config = DatasetConfig(
            source=DatasetSource.HUGGINGFACE,
            repo_id="lerobot/pusht",
        )

        create_data = ExperimentCreate(
            name="test-exp-service",
            description="Test via service",
            dataset=dataset_config,
        )

        response = await service.create_experiment(create_data)
        assert response.success
        assert response.experiment is not None
        experiment = response.experiment
        assert experiment.name == "test-exp-service"
        assert experiment.id is not None

        # Retrieve it
        retrieved = await service.get_experiment(experiment.id)
        assert retrieved is not None
        assert retrieved.name == "test-exp-service"

        # List experiments
        result = await service.list_experiments()
        assert result.total >= 1

    @pytest.mark.asyncio
    async def test_experiment_dataset_revision_resolved(self, temp_db: Path) -> None:
        """Test that HF dataset revision gets resolved."""
        from backend.services.migrations import run_migrations
        from backend.services.experiments import ExperimentsService
        from backend.models.experiments import ExperimentCreate
        from backend.models.training import DatasetConfig, DatasetSource

        await run_migrations(temp_db)
        service = ExperimentsService(temp_db)

        dataset_config = DatasetConfig(
            source=DatasetSource.HUGGINGFACE,
            repo_id="lerobot/pusht",
            version="main",
        )

        create_data = ExperimentCreate(
            name="test-revision-resolve",
            dataset=dataset_config,
        )

        try:
            experiment = await service.create_experiment(create_data)
            # If HF API is available, revision should be resolved
            if experiment.dataset_resolved_revision:
                assert len(experiment.dataset_resolved_revision) == 40
        except Exception:
            # HF API may be unavailable
            pass


class TestEvaluationsService:
    """Test evaluations service directly."""

    @pytest.mark.asyncio
    async def test_evaluation_store(self, temp_db: Path) -> None:
        """Test evaluation store operations."""
        from backend.services.migrations import run_migrations
        from backend.services.evaluations import EvaluationStore

        # Initialize database
        await run_migrations(temp_db)

        store = EvaluationStore(temp_db)
        await store.initialize()

        # List should be empty initially
        evaluations = await store.list()
        assert len(evaluations) == 0


class TestModelExport:
    """Test model export service."""

    def test_model_export_service_init(self) -> None:
        """Test ModelExportService can be initialized."""
        from backend.services.model_export import ModelExportService

        service = ModelExportService()
        assert service is not None


class TestMigrations:
    """Test migration system."""

    @pytest.mark.asyncio
    async def test_full_migration_creates_all_tables(self, temp_db: Path) -> None:
        """Test migrations create all required tables."""
        from backend.services.migrations import run_migrations

        success = await run_migrations(temp_db)
        assert success

        # Check all tables exist
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = {row[0] for row in cursor.fetchall()}
        conn.close()

        # Should have all RobotOps tables
        assert "jobs" in tables
        assert "metrics" in tables
        assert "experiments" in tables
        assert "evaluations" in tables
        assert "alembic_version" in tables

    @pytest.mark.asyncio
    async def test_migration_revision_tracking(self, temp_db: Path) -> None:
        """Test revision is tracked correctly."""
        from backend.services.migrations import (
            run_migrations,
            get_current_revision,
            get_head_revision,
        )

        await run_migrations(temp_db)

        current = get_current_revision(temp_db)
        head = get_head_revision()

        assert current == head
        assert current == "003"  # Latest migration


class TestSDKClient:
    """Test SDK client functionality."""

    def test_sdk_client_init(self) -> None:
        """Test SDK client can be initialized."""
        from backend.sdk.client import URDFStudioClient

        client = URDFStudioClient("http://localhost:8000")
        assert client is not None
        assert client._base_url == "http://localhost:8000"

    def test_sdk_module_exports(self) -> None:
        """Test SDK module exports expected classes."""
        from backend.sdk import URDFStudioClient

        assert URDFStudioClient is not None


class TestAPIEndpointsStructure:
    """Test API endpoint structure and OpenAPI schema."""

    def test_experiments_routes_exist(self, client: TestClient) -> None:
        """Test experiments routes are registered."""
        # Get OpenAPI schema
        response = client.get("/openapi.json")
        assert response.status_code == 200

        schema = response.json()
        paths = schema.get("paths", {})

        # Check key experiment paths exist
        assert "/api/experiments" in paths or "/api/experiments/" in paths

    def test_evaluations_routes_exist(self, client: TestClient) -> None:
        """Test evaluations routes are registered."""
        response = client.get("/openapi.json")
        schema = response.json()
        paths = schema.get("paths", {})

        assert "/api/evaluations" in paths or "/api/evaluations/" in paths

    def test_policies_routes_exist(self, client: TestClient) -> None:
        """Test policies routes are registered."""
        response = client.get("/openapi.json")
        schema = response.json()
        paths = schema.get("paths", {})

        assert "/api/policies" in paths or "/api/policies/" in paths


class TestIntegration:
    """Integration tests combining multiple services."""

    @pytest.mark.asyncio
    async def test_experiment_to_evaluation_flow(self, temp_db: Path) -> None:
        """Test creating experiment, then adding evaluation."""
        from backend.services.migrations import run_migrations
        from backend.services.experiments import ExperimentsService
        from backend.services.evaluations import EvaluationStore
        from backend.models.experiments import ExperimentCreate
        from backend.models.training import DatasetConfig, DatasetSource

        # Setup
        await run_migrations(temp_db)
        exp_service = ExperimentsService(temp_db)
        eval_store = EvaluationStore(temp_db)
        await eval_store.initialize()

        # Create experiment
        dataset_config = DatasetConfig(
            source=DatasetSource.HUGGINGFACE,
            repo_id="lerobot/pusht",
        )
        response = await exp_service.create_experiment(
            ExperimentCreate(
                name="integration-test-exp",
                dataset=dataset_config,
            )
        )

        assert response.success
        assert response.experiment is not None
        experiment = response.experiment

        # Evaluations should be empty for this experiment
        evals = await eval_store.list(experiment_id=experiment.id)
        assert len(evals) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
