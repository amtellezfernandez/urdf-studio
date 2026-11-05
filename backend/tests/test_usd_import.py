from __future__ import annotations

import pytest

from backend.api.usd_import import parse_huggingface_source


def test_parse_huggingface_usd_file_preserves_dataset_revision_and_folder() -> None:
    source = parse_huggingface_source(
        "https://huggingface.co/datasets/agibot-assets/simready-assets/blob/"
        "b0628c2800bb1d64559489d6b2b8643b0d502fcc/"
        "g2_omnipicker/simready_usd/g2_omnipicker.usda"
    )

    assert source.dataset == "agibot-assets/simready-assets"
    assert source.revision == "b0628c2800bb1d64559489d6b2b8643b0d502fcc"
    assert source.root_path == "g2_omnipicker/simready_usd"
    assert source.usd_path.endswith("g2_omnipicker.usda")


def test_parse_huggingface_tree_selects_folder_without_inventing_revision() -> None:
    source = parse_huggingface_source(
        "https://huggingface.co/datasets/agibot-assets/simready-assets/tree/"
        "b0628c2800bb1d64559489d6b2b8643b0d502fcc/g2_omnipicker"
    )

    assert source.root_path == "g2_omnipicker"
    assert source.usd_path == ""


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/robot.usda",
        "https://huggingface.co/models/foo/blob/main/robot.usda",
        "https://huggingface.co/datasets/foo/bar/blob/main/robot.urdf",
    ],
)
def test_parse_huggingface_source_rejects_non_openusd_sources(url: str) -> None:
    with pytest.raises(ValueError):
        parse_huggingface_source(url)
