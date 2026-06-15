from __future__ import annotations

from pathlib import Path
from typing import Sequence

from backend.services.world_layout_static_transfer import resolve_world_layout_asset_path
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutTransferError


def resolve_declared_mesh_asset_path(
    primitive: SimPrimitive,
    asset_roots: Sequence[Path],
    *,
    simulator_label: str,
) -> Path | None:
    if primitive.asset_ref is None:
        if primitive.source_type == "mesh":
            raise WorldLayoutTransferError(
                f"{simulator_label} mesh object '{primitive.source_id}' is missing asset_ref."
            )
        return None

    asset_path = resolve_world_layout_asset_path(primitive.asset_ref, asset_roots)
    if asset_path is None:
        raise WorldLayoutTransferError(
            f"{simulator_label} mesh object '{primitive.source_id}' asset_ref "
            f"does not resolve under asset_roots: {primitive.asset_ref}"
        )
    return asset_path
