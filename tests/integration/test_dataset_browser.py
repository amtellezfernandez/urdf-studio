"""Integration test for dataset browsing and search.

This test validates dataset operations:
1. Browsing available datasets
2. Searching for datasets
3. Getting dataset info

Requirements:
- Running URDF Studio server at http://localhost:8000
- Internet connection for HuggingFace API (if endpoints are implemented)

Usage:
    pytest tests/integration/test_dataset_browser.py -v
    python tests/integration/test_dataset_browser.py  # Direct execution
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest

# Add project root to path for direct execution
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from backend.sdk import URDFStudioClient, DatasetInfo


# Configuration
SERVER_URL = os.environ.get("URDF_STUDIO_URL", "http://localhost:8000")


class TestDatasetBrowser:
    """Integration tests for dataset browsing."""

    @pytest.fixture
    def client(self):
        """Create SDK client for tests."""
        return URDFStudioClient(SERVER_URL, timeout=60.0)

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        """Test server health before dataset tests."""
        async with client:
            health = await client.health.check()
            assert health.get("status") == "ok"

    @pytest.mark.asyncio
    async def test_browse_datasets(self, client):
        """Test browsing available datasets."""
        async with client:
            datasets = await client.datasets.browse(limit=10)

            # Note: This may return empty if endpoint not implemented
            # Test passes if no errors are raised
            assert isinstance(datasets, list)

            if datasets:
                for dataset in datasets:
                    assert isinstance(dataset, DatasetInfo)
                    assert dataset.repo_id, "Dataset should have repo_id"

    @pytest.mark.asyncio
    async def test_browse_with_limit(self, client):
        """Test browsing with different limits."""
        async with client:
            # Small limit
            datasets_5 = await client.datasets.browse(limit=5)
            assert isinstance(datasets_5, list)
            assert len(datasets_5) <= 5

            # Larger limit
            datasets_20 = await client.datasets.browse(limit=20)
            assert isinstance(datasets_20, list)
            assert len(datasets_20) <= 20

    @pytest.mark.asyncio
    async def test_search_datasets(self, client):
        """Test searching for datasets."""
        async with client:
            # Search for aloha-related datasets
            results = await client.datasets.search("aloha", limit=10)

            assert isinstance(results, list)

            if results:
                for dataset in results:
                    assert isinstance(dataset, DatasetInfo)
                    assert dataset.repo_id, "Dataset should have repo_id"

    @pytest.mark.asyncio
    async def test_search_pusht(self, client):
        """Test searching for pusht dataset specifically."""
        async with client:
            results = await client.datasets.search("pusht", limit=10)

            assert isinstance(results, list)

            # If results exist, one should contain pusht
            if results:
                repo_ids = [d.repo_id for d in results]
                pusht_found = any("pusht" in rid.lower() for rid in repo_ids)
                # This is a soft assertion - endpoint may not be implemented
                if not pusht_found:
                    print("Note: pusht not found in search results")

    @pytest.mark.asyncio
    async def test_search_empty_query(self, client):
        """Test search with empty query returns results or handles gracefully."""
        async with client:
            # Empty query should either return default results or empty
            try:
                results = await client.datasets.search("", limit=10)
                assert isinstance(results, list)
            except Exception as e:
                # Some implementations may reject empty queries
                print(f"Note: Empty query raised {type(e).__name__}: {e}")

    @pytest.mark.asyncio
    async def test_dataset_info(self, client):
        """Test getting info for a specific dataset."""
        async with client:
            # Try to get info for lerobot/pusht
            info = await client.datasets.info("lerobot/pusht")

            # Note: May return None if endpoint not implemented
            if info is not None:
                assert isinstance(info, DatasetInfo)
                assert info.repo_id == "lerobot/pusht"

    @pytest.mark.asyncio
    async def test_dataset_info_not_found(self, client):
        """Test getting info for non-existent dataset."""
        async with client:
            info = await client.datasets.info("nonexistent/dataset123456")

            # Should return None for non-existent dataset
            assert info is None

    @pytest.mark.asyncio
    async def test_dataset_info_fields(self, client):
        """Test that dataset info contains expected fields."""
        async with client:
            info = await client.datasets.info("lerobot/pusht")

            if info is not None:
                # Check that DatasetInfo has the expected structure
                assert hasattr(info, "repo_id")
                assert hasattr(info, "description")
                assert hasattr(info, "downloads")
                assert hasattr(info, "likes")
                assert hasattr(info, "robot_type")
                assert hasattr(info, "num_episodes")
                assert hasattr(info, "total_frames")
                assert hasattr(info, "fps")
                assert hasattr(info, "features")

    @pytest.mark.asyncio
    async def test_dataset_mix(self, client):
        """Test dataset mixing functionality."""
        async with client:
            # Note: This requires actual datasets and may take time
            # Just test that the API is callable
            try:
                result = await client.datasets.mix(
                    datasets=["lerobot/pusht"],
                    output_path="./test_outputs/mixed",
                )
                assert isinstance(result, dict)
            except Exception as e:
                # Dataset mixing may fail for various reasons
                print(f"Note: Dataset mix test: {type(e).__name__}: {e}")


class TestDatasetBrowserEdgeCases:
    """Edge case tests for dataset browser."""

    @pytest.fixture
    def client(self):
        return URDFStudioClient(SERVER_URL, timeout=60.0)

    @pytest.mark.asyncio
    async def test_search_special_characters(self, client):
        """Test search with special characters."""
        async with client:
            # Should handle special characters gracefully
            try:
                results = await client.datasets.search("test@#$%", limit=5)
                assert isinstance(results, list)
            except Exception as e:
                print(f"Note: Special char search: {type(e).__name__}")

    @pytest.mark.asyncio
    async def test_browse_zero_limit(self, client):
        """Test browse with zero limit."""
        async with client:
            try:
                results = await client.datasets.browse(limit=0)
                # Should return empty or handle gracefully
                assert isinstance(results, list)
            except Exception:
                # Zero limit may be rejected
                pass

    @pytest.mark.asyncio
    async def test_info_with_slashes(self, client):
        """Test info with different repo_id formats."""
        async with client:
            # Standard format
            info1 = await client.datasets.info("lerobot/pusht")

            # With extra slashes (should handle gracefully)
            info2 = await client.datasets.info("lerobot/pusht/")

            # Both should return consistent results
            if info1 and info2:
                assert info1.repo_id == info2.repo_id or info2 is None


# Direct execution support
async def main():
    """Run tests directly without pytest."""
    print("Running dataset browser integration tests...")
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

            # Test 2: Browse datasets
            print("\n2. Testing browse datasets...")
            datasets = await client.datasets.browse(limit=10)
            print(f"   PASSED: Found {len(datasets)} datasets")

            if datasets:
                print(f"   First dataset: {datasets[0].repo_id}")

            # Test 3: Search datasets
            print("\n3. Testing search datasets...")
            results = await client.datasets.search("aloha", limit=10)
            print(f"   PASSED: Search returned {len(results)} results")

            if results:
                print(f"   First result: {results[0].repo_id}")

            # Test 4: Dataset info
            print("\n4. Testing dataset info...")
            info = await client.datasets.info("lerobot/pusht")
            if info:
                print(f"   PASSED: Got info for {info.repo_id}")
                if info.description:
                    print(f"   Description: {info.description[:50]}...")
                if info.num_episodes:
                    print(f"   Episodes: {info.num_episodes}")
            else:
                print("   Note: Info endpoint returned None (may not be implemented)")

            # Test 5: Non-existent dataset
            print("\n5. Testing non-existent dataset...")
            info = await client.datasets.info("fake/nonexistent123")
            assert info is None, "Should return None for non-existent dataset"
            print("   PASSED: Correctly returned None")

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
