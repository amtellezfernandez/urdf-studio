from __future__ import annotations

from pathlib import Path

from backend.services.butterclaw_runtime_objects import ButterClawRuntimeObjectsService


def test_list_objects_parses_butterclaw_clusters(tmp_path: Path) -> None:
    current_map = tmp_path / "current_map.md"
    current_map.write_text(
        "## Known object clusters\n"
        "- mug#1: class=mug pos=(1.42, 0.95) yaw=270 count=3 best=0.91 @ 2026-03-08T12:00:00Z\n",
        encoding="utf-8",
    )

    service = ButterClawRuntimeObjectsService(str(current_map))
    response = service.list_objects()

    assert response.source_path == str(current_map)
    assert len(response.objects) == 1
    first = response.objects[0]
    assert first.object_id == "butterclaw-mug#1"
    assert first.class_label == "mug"
    assert first.cluster_id == "mug#1"
    assert first.position_xyz == (1.42, 0.06, 0.95)
    assert first.size_xyz == (0.12, 0.12, 0.12)
    assert first.observation_count == 3
    assert first.best_confidence == 0.91
