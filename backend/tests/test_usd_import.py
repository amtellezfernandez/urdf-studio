from __future__ import annotations

import pytest

from backend.api.usd_import import _download_package, parse_huggingface_source


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


def test_download_package_uses_pinned_huggingface_snapshot_for_usd_robot(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = parse_huggingface_source(
        "https://huggingface.co/datasets/agibot-assets/simready-assets/blob/"
        "b0628c2800bb1d64559489d6b2b8643b0d502fcc/"
        "g2_omnipicker/simready_usd/g2_omnipicker.usda"
    )
    captured: dict[str, object] = {}

    def fake_snapshot_download(**kwargs):
        captured.update(kwargs)
        usd_path = tmp_path / "g2_omnipicker/simready_usd/g2_omnipicker.usda"
        usd_path.parent.mkdir(parents=True)
        usd_path.write_text("#usda 1.0", encoding="utf-8")
        return str(tmp_path)

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)
    usd_path, file_count = _download_package(source, tmp_path)

    assert usd_path == tmp_path / source.usd_path
    assert file_count == 1
    assert captured["repo_id"] == "agibot-assets/simready-assets"
    assert captured["repo_type"] == "dataset"
    assert captured["revision"] == source.revision


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
