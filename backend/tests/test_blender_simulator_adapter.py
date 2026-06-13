from __future__ import annotations

import ast
import json
import math
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SIMULATOR_BLENDER_ID
from backend.scripts import blender_workspace_prepare as blender_prepare
from backend.scripts.blender_workspace_prepare import prepare_blender_workspace_scene
from backend.services.simulator_adapters import blender as blender_adapter
from backend.services.simulator_adapters.blender_runtime import resolve_blender_executable
from backend.services.simulator_adapters.params import BLENDER_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.blender_workspace import (
    BLENDER_CHANGE_SET_SCHEMA,
    BLENDER_EDIT_SESSION_SCHEMA,
    BLENDER_ROBOT_GLB_FILENAME,
    BLENDER_ROBOT_USD_FILENAME,
    apply_blender_layout_change_set,
    apply_blender_layout_change_set_with_summary,
    build_blender_change_set_source,
    write_blender_workspace_artifacts,
)
from backend.services.simulator_adapters.world_scene import prepare_simulator_scene
from backend.tests.simulator_adapter_test_utils import make_world_package


def _write_scene_inputs(tmp_path: Path):
    urdf_xml = """
<robot name="blender_demo">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="0.1 0.2 0.3"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
            }
        ],
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "scene camera",
            "parent_joint": "base_link",
            "pose": {"xyz": [0.0, 0.0, 1.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 60},
        }
    ]
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    world_package_path.write_text(
        json.dumps(world_package.model_dump(mode="json")),
        encoding="utf-8",
    )
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    return world_package, world_package_path, robot_urdf_path


def _blender_change_set(world_package, *, changes, review_only=None):
    return {
        "schema": BLENDER_CHANGE_SET_SCHEMA,
        "source": build_blender_change_set_source(world_package),
        "changes": changes,
        "review_only": review_only or [],
    }


def test_blender_workspace_artifacts_preserve_round_trip_ids(tmp_path: Path) -> None:
    _world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )

    artifacts = write_blender_workspace_artifacts(
        scene,
        artifact_dir=tmp_path / "artifacts",
        robot_urdf_path=robot_urdf_path,
        blend_path=tmp_path / "layout.blend",
    )
    edit_session = json.loads(artifacts.edit_session_path.read_text(encoding="utf-8"))

    assert edit_session["schema"] == BLENDER_EDIT_SESSION_SCHEMA
    assert edit_session["source"] == build_blender_change_set_source(
        _world_package,
        frame_map="identity",
        world_object_ids=("crate",),
        camera_ids=("cam-1",),
    )
    assert edit_session["robot"]["locked"] is True
    assert Path(edit_session["robot"]["visual_glb_path"]).name == BLENDER_ROBOT_GLB_FILENAME
    assert edit_session["robot"]["visual_glb_stats"]["geometry_count"] == 1
    assert Path(edit_session["robot"]["visual_usd_path"]).name == BLENDER_ROBOT_USD_FILENAME
    assert edit_session["robot"]["visual_usd_stats"]["links_converted"] == 1
    assert edit_session["objects"][0]["stable_id"] == "crate"
    assert edit_session["cameras"][0]["stable_id"] == "cam-1"
    assert "robot.kinematics" in edit_session["round_trip"]["locked"]
    assert artifacts.robot_glb_path is not None
    assert artifacts.robot_glb_path.exists()
    assert artifacts.robot_usd_path.exists()
    assert artifacts.robot_usd_path.read_text(encoding="utf-8").startswith("#usda")
    assert artifacts.open_script_path.exists()
    assert artifacts.export_script_path.exists()


def test_blender_change_set_applies_world_object_layout_only(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[
            {
                "entity_type": "world_object",
                "stable_id": "crate",
                "position_xyz": [1.0, 2.0, 3.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "size_xyz": [0.5, 0.6, 0.7],
            },
        ],
        review_only=[
            {
                "entity_type": "camera",
                "stable_id": "cam-1",
                "position_xyz": [9.0, 9.0, 9.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "reason": "camera round-trip requires camera-frame review before apply",
            },
        ],
    )

    updated = apply_blender_layout_change_set(world_package, change_set)
    updated_object = updated.world_snapshot.objects[0]

    assert updated_object["position_xyz"] == [1.0, 2.0, 3.0]
    assert updated_object["size_xyz"] == [0.5, 0.6, 0.7]
    assert all(math.isclose(value, 0.0, abs_tol=1e-9) for value in updated_object["rotation_rpy_rad"])
    assert updated.world_snapshot.cameras == world_package.world_snapshot.cameras


def test_blender_change_set_reports_applied_and_review_only_counts(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        _blender_change_set(
            world_package,
            changes=[
                {
                    "entity_type": "world_object",
                    "stable_id": "crate",
                    "position_xyz": [1.0, 2.0, 3.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.5, 0.6, 0.7],
                }
            ],
            review_only=[
                {
                    "entity_type": "camera",
                    "stable_id": "cam-1",
                    "position_xyz": [0.0, 0.0, 1.0],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "reason": "camera round-trip requires camera-frame review before apply",
                },
                {
                    "entity_type": "new_world_object",
                    "sim_name": "Added cube",
                    "position_xyz": [0.2, 0.3, 0.4],
                    "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    "size_xyz": [0.1, 0.2, 0.3],
                    "reason": "new Blender objects require Studio review before import",
                }
            ],
        ),
    )

    assert result.applied_change_count == 1
    assert result.review_only_count == 2


def test_blender_change_set_counts_deleted_world_object_review_only(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_world_object",
                "stable_id": "crate",
                "reason": "deleted Studio world objects require Studio review before removal",
            }
        ],
    )
    change_set["source"]["world_object_ids"] = ["crate"]

    result = apply_blender_layout_change_set_with_summary(
        world_package,
        change_set,
    )

    assert result.applied_change_count == 0
    assert result.review_only_count == 1


def test_blender_change_set_accepts_source_camera_review(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "camera",
                "stable_id": "cam-1",
                "position_xyz": [0.0, 0.0, 1.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "reason": "camera round-trip requires camera-frame review before apply",
            }
        ],
    )
    change_set["source"]["camera_ids"] = ["cam-1"]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 0
    assert result.review_only_count == 1


def test_blender_change_set_counts_deleted_camera_review_only(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Studio cameras require Studio review before removal",
            }
        ],
    )
    change_set["source"]["camera_ids"] = ["cam-1"]

    result = apply_blender_layout_change_set_with_summary(world_package, change_set)

    assert result.applied_change_count == 0
    assert result.review_only_count == 1


def test_blender_change_set_rejects_missing_source_object_coverage(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate"]

    with pytest.raises(ValueError, match="missing update or deletion review"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_updates_outside_source_object_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[
            {
                "entity_type": "world_object",
                "stable_id": "crate",
                "position_xyz": [1.0, 2.0, 3.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "size_xyz": [0.5, 0.6, 0.7],
            },
        ],
    )
    change_set["source"]["world_object_ids"] = []

    with pytest.raises(ValueError, match="outside source world_object_ids"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_deletions_outside_source_object_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_world_object",
                "stable_id": "crate",
                "reason": "deleted Studio world objects require Studio review before removal",
            }
        ],
    )
    change_set["source"]["world_object_ids"] = []

    with pytest.raises(ValueError, match="deletes object id\\(s\\) outside source"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_missing_source_camera_coverage(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["camera_ids"] = ["cam-1"]

    with pytest.raises(ValueError, match="missing camera review"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_camera_reviews_outside_source_camera_ids(
    tmp_path: Path,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "camera",
                "stable_id": "cam-1",
                "position_xyz": [0.0, 0.0, 1.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "reason": "camera round-trip requires camera-frame review before apply",
            }
        ],
    )
    change_set["source"]["camera_ids"] = []

    with pytest.raises(ValueError, match="outside source camera_ids"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_deleted_cameras_outside_source_camera_ids(
    tmp_path: Path,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Studio cameras require Studio review before removal",
            }
        ],
    )
    change_set["source"]["camera_ids"] = []

    with pytest.raises(ValueError, match="deletes camera id\\(s\\) outside source"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_review_and_delete_for_same_camera(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(
        world_package,
        changes=[],
        review_only=[
            {
                "entity_type": "camera",
                "stable_id": "cam-1",
                "position_xyz": [0.0, 0.0, 1.0],
                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                "reason": "camera round-trip requires camera-frame review before apply",
            },
            {
                "entity_type": "deleted_camera",
                "stable_id": "cam-1",
                "reason": "deleted Studio cameras require Studio review before removal",
            },
        ],
    )

    with pytest.raises(ValueError, match="both review and delete camera"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_camera_edits_in_apply_list(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="must be 'world_object'"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "camera",
                        "stable_id": "cam-1",
                        "position_xyz": [0.0, 0.0, 1.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_unknown_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="unknown world object"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "world_object",
                        "stable_id": "missing",
                        "position_xyz": [1.0, 2.0, 3.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.5, 0.6, 0.7],
                    }
                ],
            ),
        )


@pytest.mark.parametrize(
    ("field_name", "value", "message"),
    [
        ("position_xyz", [1.0, 2.0], "3-number list"),
        ("position_xyz", [1.0, True, 3.0], "finite numbers"),
        ("quat_wxyz", [0.0, 0.0, 0.0, 0.0], "non-zero quaternion"),
        ("size_xyz", [0.5, 0.0, 0.7], "positive dimensions"),
    ],
)
def test_blender_change_set_rejects_invalid_transform_values(
    tmp_path: Path,
    field_name: str,
    value: list[object],
    message: str,
) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = {
        "entity_type": "world_object",
        "stable_id": "crate",
        "position_xyz": [1.0, 2.0, 3.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.5, 0.6, 0.7],
    }
    change[field_name] = value

    with pytest.raises(ValueError, match=message):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(world_package, changes=[change]),
        )


def test_blender_change_set_rejects_duplicate_stable_ids(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change = {
        "entity_type": "world_object",
        "stable_id": "crate",
        "position_xyz": [1.0, 2.0, 3.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.5, 0.6, 0.7],
    }

    with pytest.raises(ValueError, match="duplicate stable_id"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(world_package, changes=[change, dict(change)]),
        )


def test_blender_change_set_rejects_update_and_delete_for_same_object(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="both update and delete"):
        apply_blender_layout_change_set(
            world_package,
            _blender_change_set(
                world_package,
                changes=[
                    {
                        "entity_type": "world_object",
                        "stable_id": "crate",
                        "position_xyz": [1.0, 2.0, 3.0],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.5, 0.6, 0.7],
                    }
                ],
                review_only=[
                    {
                        "entity_type": "deleted_world_object",
                        "stable_id": "crate",
                        "reason": "deleted Studio world objects require Studio review before removal",
                    }
                ],
            ),
        )


def test_blender_change_set_rejects_missing_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)

    with pytest.raises(ValueError, match="source must be an object"):
        apply_blender_layout_change_set(
            world_package,
            {
                "schema": BLENDER_CHANGE_SET_SCHEMA,
                "changes": [],
                "review_only": [],
            },
        )


def test_blender_change_set_rejects_stale_world_snapshot_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    stale_world_package = world_package.model_copy(deep=True)
    stale_world_package.world_snapshot.objects = []
    change_set = _blender_change_set(stale_world_package, changes=[])

    with pytest.raises(ValueError, match="world snapshot does not match"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_non_identity_frame_map_source(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["frame_map"] = "studio-y-up-to-z-up"

    with pytest.raises(ValueError, match="frame_map is not supported"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_unknown_source_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate", "missing"]

    with pytest.raises(ValueError, match="unknown world object"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_duplicate_source_world_object_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["world_object_ids"] = ["crate", "crate"]

    with pytest.raises(ValueError, match="duplicate id"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_unknown_source_camera_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["camera_ids"] = ["cam-1", "missing"]

    with pytest.raises(ValueError, match="unknown camera id"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_change_set_rejects_duplicate_source_camera_id(tmp_path: Path) -> None:
    world_package, _world_package_path, _robot_urdf_path = _write_scene_inputs(tmp_path)
    change_set = _blender_change_set(world_package, changes=[])
    change_set["source"]["camera_ids"] = ["cam-1", "cam-1"]

    with pytest.raises(ValueError, match="source camera_ids contains duplicate"):
        apply_blender_layout_change_set(world_package, change_set)


def test_blender_workspace_prepare_no_viewer_writes_report_and_scripts(tmp_path: Path) -> None:
    _world_package, world_package_path, robot_urdf_path = _write_scene_inputs(tmp_path)
    report_path = tmp_path / "artifacts" / "report.json"

    prepare_blender_workspace_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        duration_sec=0.0,
        include_hidden=False,
        no_viewer=True,
        report_path=report_path,
        blender_executable=None,
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["simulator"]["id"] == SIMULATOR_BLENDER_ID
    assert report["primitive_count"] == 1
    assert report["camera_count"] == 1
    assert Path(report["artifacts"]["edit_session_path"]).exists()
    assert Path(report["artifacts"]["open_script_path"]).exists()
    assert Path(report["artifacts"]["export_script_path"]).exists()
    assert Path(report["artifacts"]["robot_glb_path"]).exists()
    assert Path(report["artifacts"]["robot_usd_path"]).exists()
    open_script = Path(report["artifacts"]["open_script_path"]).read_text(encoding="utf-8")
    export_script = Path(report["artifacts"]["export_script_path"]).read_text(encoding="utf-8")
    ast.parse(open_script)
    ast.parse(export_script)
    assert "new_world_object" in export_script
    assert "deleted_world_object" in export_script
    assert "deleted_camera" in export_script


class _FakeBlenderProcess:
    def __init__(self, lines: list[str], returncode: int = 0):
        self.stdout = iter(lines)
        self.returncode = returncode
        self.terminated = False

    def wait(self) -> int:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True


def test_blender_workspace_runner_reports_ready_after_edit_session_load(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return _FakeBlenderProcess(
            [
                "Blender booting\n",
                f"{blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER} /tmp/session.json\n",
                "[urdf-studio-blender] blend written: /tmp/layout.blend\n",
            ]
        )

    monkeypatch.setattr(blender_prepare.subprocess, "Popen", fake_popen)

    blender_prepare._run_blender_workspace_until_ready(
        blender_executable="/usr/bin/blender",
        open_script_path=tmp_path / "open_blender_scene.py",
        cwd=tmp_path,
    )

    output = capsys.readouterr().out
    assert captured["command"] == [
        "/usr/bin/blender",
        "--python",
        str(tmp_path / "open_blender_scene.py"),
    ]
    assert blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER in output
    assert BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker in output
    assert output.index(blender_prepare.BLENDER_EDIT_SESSION_LOADED_MARKER) < output.index(
        BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker
    )


def test_blender_workspace_runner_rejects_exit_before_edit_session_load(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        blender_prepare.subprocess,
        "Popen",
        lambda _command, **_kwargs: _FakeBlenderProcess(["Blender booting\n"], returncode=0),
    )

    with pytest.raises(RuntimeError, match="before loading the URDF Studio edit session"):
        blender_prepare._run_blender_workspace_until_ready(
            blender_executable="/usr/bin/blender",
            open_script_path=tmp_path / "open_blender_scene.py",
            cwd=tmp_path,
        )

    assert BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker not in capsys.readouterr().out


def test_blender_runtime_status_reports_missing_executable(monkeypatch) -> None:
    monkeypatch.setattr(blender_adapter, "resolve_blender_executable", lambda: None)

    status = blender_adapter.BLENDER_SIMULATOR_ADAPTER.runtime_status()

    assert status.runtime_name == SIMULATOR_BLENDER_ID
    assert status.available is False
    assert status.dependencies[0].name == "blender"
    assert status.dependencies[0].available is False


def test_blender_runtime_resolves_configured_app_bundle(tmp_path: Path) -> None:
    app_binary = tmp_path / "Blender.app" / "Contents" / "MacOS" / "Blender"
    app_binary.parent.mkdir(parents=True)
    app_binary.write_text("#!/bin/sh\n", encoding="utf-8")
    app_binary.chmod(0o755)

    assert resolve_blender_executable(str(tmp_path / "Blender.app")) == str(app_binary)
