"""Pytest configuration for integration tests.

This module provides common fixtures and configuration for integration tests.
"""

from __future__ import annotations

import os

import pytest

# Configuration
SERVER_URL = os.environ.get("URDF_STUDIO_URL", "http://localhost:8000")


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )


@pytest.fixture(scope="session")
def server_url():
    """Get the URDF Studio server URL."""
    return SERVER_URL


@pytest.fixture(scope="session")
def event_loop_policy():
    """Use the default event loop policy."""
    import asyncio
    return asyncio.DefaultEventLoopPolicy()


@pytest.fixture
def anyio_backend():
    """Use asyncio backend for anyio."""
    return "asyncio"
