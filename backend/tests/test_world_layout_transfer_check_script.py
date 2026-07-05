from __future__ import annotations

import pytest

from backend.scripts import world_layout_transfer_check


def test_selected_backends_expands_all() -> None:
    assert world_layout_transfer_check._selected_backends("all") == ("mujoco", "genesis")


@pytest.mark.parametrize("backend", ["mujoco", "genesis"])
def test_selected_backends_accepts_single_backend(backend: str) -> None:
    assert world_layout_transfer_check._selected_backends(backend) == (backend,)


def test_selected_backends_rejects_unknown_backend() -> None:
    with pytest.raises(ValueError, match="Unsupported static transfer backend"):
        world_layout_transfer_check._selected_backends("pybullet")


@pytest.mark.parametrize("frame_map", ["auto", "studio-y-up-to-z-up", "identity"])
def test_selected_frame_map_accepts_supported_values(frame_map: str) -> None:
    assert world_layout_transfer_check._selected_frame_map(frame_map) == frame_map


def test_selected_frame_map_rejects_unknown_value() -> None:
    with pytest.raises(ValueError, match="Unsupported static transfer frame map"):
        world_layout_transfer_check._selected_frame_map("sideways")
