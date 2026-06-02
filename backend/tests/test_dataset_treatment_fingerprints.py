from __future__ import annotations

from backend.models.datasets import DatasetContentSignature
from backend.services.dataset_treatment_fingerprints import (
    compute_content_fingerprint_from_signature,
    fingerprint_text,
    normalize_content_fingerprint,
)
from backend.services.dataset_treatments_params import (
    CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
)


def test_fingerprint_text_returns_stable_16_char_hex_value() -> None:
    assert fingerprint_text("openai/demo") == fingerprint_text("openai/demo")
    assert len(fingerprint_text("openai/demo")) == 16


def test_normalize_content_fingerprint_canonicalizes_valid_hex_payload() -> None:
    assert (
        normalize_content_fingerprint(
            " ABCDEF1234567890 ",
            CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
        )
        == "abcdef1234567890"
    )


def test_normalize_content_fingerprint_rejects_invalid_values() -> None:
    assert (
        normalize_content_fingerprint(
            "content-1",
            CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
        )
        is None
    )


def test_compute_content_fingerprint_from_signature_matches_expected_shape() -> None:
    fingerprint, kind = compute_content_fingerprint_from_signature(
        DatasetContentSignature.model_validate(
            {
                "kind": CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1,
                "episodes": [
                    {
                        "episode_index": 1,
                        "frames": [
                            {
                                "timestamp": 20,
                                "joints": {"shoulder": 0.3, "elbow": 0.4},
                            }
                        ],
                    },
                    {
                        "episode_index": 0,
                        "frames": [
                            {
                                "timestamp": 0,
                                "joints": {"elbow": -0.2, "shoulder": 0.1},
                            }
                        ],
                    },
                ],
            }
        )
    )

    assert fingerprint is not None
    assert len(fingerprint) == 16
    assert kind == CONTENT_FINGERPRINT_KIND_EPISODE_SERIES_V1
    assert (
        normalize_content_fingerprint(
            "abcdef1234567890",
            None,
        )
        is None
    )
