from __future__ import annotations

import json
import subprocess

import pytest

from backend.services.dataset_treatment_lineage import cluster_dataset_sources


def test_cluster_dataset_sources_groups_duplicates_without_rust() -> None:
    clusters = cluster_dataset_sources(
        [
            ("repo:0", "hf/demo", None),
            ("repo:1", "hf/demo", None),
            ("local:0", "/safe/local", None),
        ]
    )

    assert [cluster.duplicate_group_size for cluster in clusters] == [2, 2, 1]
    assert clusters[0].duplicate_group_id is not None
    assert clusters[0].duplicate_group_id == clusters[1].duplicate_group_id
    assert clusters[2].duplicate_group_id is None
    assert clusters[0].duplicate_match_kind == "exact"
    assert len(clusters[0].canonical_fingerprint) == 16


def test_cluster_dataset_sources_detects_normalized_duplicates_without_rust() -> None:
    clusters = cluster_dataset_sources(
        [
            ("repo:0", "OpenAI/Demo", None),
            ("repo:1", "openai/demo", None),
        ]
    )

    assert clusters[0].duplicate_match_kind == "normalized"
    assert clusters[1].duplicate_match_kind == "normalized"
    assert clusters[0].duplicate_group_id == clusters[1].duplicate_group_id


def test_cluster_dataset_sources_uses_rust_accelerator_when_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.services.dataset_treatment_lineage.DATASET_TREATMENT_RUST_BIN",
        "/tmp/fake-rust-lineage",
    )

    def _fake_run(*_args, **kwargs):
        payload = json.loads(kwargs["input"])
        assert payload == [
            {"source_id": "repo:0", "canonical_source": "hf/demo", "content_fingerprint": None},
            {"source_id": "repo:1", "canonical_source": "hf/demo", "content_fingerprint": None},
        ]
        return subprocess.CompletedProcess(
            ["/tmp/fake-rust-lineage"],
            0,
            stdout=json.dumps(
                [
                    {
                        "source_id": "repo:0",
                        "canonical_source": "hf/demo",
                        "canonical_fingerprint": "abc123def4567890",
                        "duplicate_group_id": "dup:0",
                        "duplicate_group_size": 2,
                        "duplicate_match_kind": "exact",
                    },
                    {
                        "source_id": "repo:1",
                        "canonical_source": "hf/demo",
                        "canonical_fingerprint": "abc123def4567890",
                        "duplicate_group_id": "dup:0",
                        "duplicate_group_size": 2,
                        "duplicate_match_kind": "exact",
                    },
                ]
            ),
            stderr="",
        )

    monkeypatch.setattr("backend.services.dataset_treatment_lineage.subprocess.run", _fake_run)

    clusters = cluster_dataset_sources(
        [
            ("repo:0", "hf/demo", None),
            ("repo:1", "hf/demo", None),
        ]
    )

    assert clusters[0].duplicate_group_id == "dup:0"
    assert clusters[1].duplicate_group_size == 2
    assert clusters[0].canonical_fingerprint == "abc123def4567890"


def test_cluster_dataset_sources_prefers_content_fingerprint_matches() -> None:
    clusters = cluster_dataset_sources(
        [
            ("repo:0", "OpenAI/Demo", "ABCDEF1234567890"),
            ("repo:1", "openai/demo", "abcdef1234567890"),
            ("repo:2", "openai/demo", "1234567890abcdef"),
        ]
    )

    assert clusters[0].duplicate_group_id == clusters[1].duplicate_group_id
    assert clusters[0].duplicate_match_kind == "exact"
    assert clusters[0].canonical_fingerprint == "abcdef1234567890"
    assert clusters[2].duplicate_group_size == 1


def test_cluster_dataset_sources_ignores_invalid_content_fingerprints() -> None:
    clusters = cluster_dataset_sources(
        [
            ("repo:0", "OpenAI/Demo", None),
            ("repo:1", "openai/demo", "content-1"),
        ]
    )

    assert clusters[0].duplicate_group_id == clusters[1].duplicate_group_id
    assert clusters[0].duplicate_match_kind == "normalized"
