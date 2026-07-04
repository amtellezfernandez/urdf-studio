from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi import HTTPException

import backend.services.samples as samples_service
from backend.services.samples import SampleDefinition, list_samples, load_sample_files

TEST_SAMPLE_ID = "safe-arm"
TEST_SAMPLE_LABEL = "Safe Arm"
TEST_REPO_PATH = "third_party/safe-arm"
TEST_URDF_PATH = "robots/safe.urdf"
TEST_MESH_PATH = "robots/meshes/link.STL"
TEST_URDF_CONTENT = """
<robot name="safe">
  <link name="base">
    <visual>
      <geometry>
        <mesh filename="meshes/link.STL" />
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
TEST_MESH_CONTENT = b"solid link\nendsolid link\n"


def install_sample_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    (repo_root / "third_party").mkdir(parents=True)
    monkeypatch.setattr(samples_service, "REPO_ROOT", repo_root)
    return repo_root


def install_config(
    monkeypatch: pytest.MonkeyPatch,
    items: dict[str, object],
    *,
    quickstart_id: str | None = TEST_SAMPLE_ID,
) -> None:
    monkeypatch.setattr(
        samples_service,
        "read_app_config",
        lambda: {
            "samples": {
                "quickStartId": quickstart_id,
                "items": items,
            }
        },
    )


def write_safe_sample(repo_root: Path) -> None:
    urdf_path = repo_root / TEST_REPO_PATH / TEST_URDF_PATH
    mesh_path = repo_root / TEST_REPO_PATH / TEST_MESH_PATH
    mesh_path.parent.mkdir(parents=True)
    urdf_path.parent.mkdir(parents=True, exist_ok=True)
    urdf_path.write_text(TEST_URDF_CONTENT, encoding="utf-8")
    mesh_path.write_bytes(TEST_MESH_CONTENT)


def test_list_samples_filters_unsafe_public_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    install_sample_root(monkeypatch, tmp_path)
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            },
            "absolute": {
                "label": "Absolute",
                "repoPath": "/etc",
                "urdfPath": "passwd",
            },
            "traversal": {
                "label": "Traversal",
                "repoPath": "third_party/../config",
                "urdfPath": "app.config.json",
            },
            "outside-sample-root": {
                "label": "Outside",
                "repoPath": "config",
                "urdfPath": "app.config.json",
            },
            "bundled-public-demo": {
                "label": "Bundled",
                "repoPath": "web/public/demo",
                "urdfPath": "robot.urdf",
            },
        },
    )

    quickstart_id, entries = list_samples()

    assert quickstart_id == TEST_SAMPLE_ID
    assert [entry.id for entry in entries] == [TEST_SAMPLE_ID, "bundled-public-demo"]
    assert entries[0].urdf_path == TEST_URDF_PATH


def test_list_samples_drops_quickstart_when_configured_sample_is_unsafe(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    install_sample_root(monkeypatch, tmp_path)
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": "/etc",
                "urdfPath": "passwd",
            }
        },
    )

    quickstart_id, entries = list_samples()

    assert quickstart_id is None
    assert entries == []


def test_list_samples_uses_sample_id_when_label_is_not_a_non_empty_string(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    install_sample_root(monkeypatch, tmp_path)
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": "  ",
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            },
            "numeric-label": {
                "label": 42,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            },
        },
    )

    _quickstart_id, entries = list_samples()

    assert [entry.label for entry in entries] == [TEST_SAMPLE_ID, "numeric-label"]


def test_load_sample_files_rejects_symlink_escape(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo_root = install_sample_root(monkeypatch, tmp_path)
    escaped_root = tmp_path / "escaped"
    escaped_root.mkdir()
    repo_link = repo_root / TEST_REPO_PATH
    repo_link.symlink_to(escaped_root, target_is_directory=True)
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            }
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        load_sample_files(TEST_SAMPLE_ID)

    assert exc_info.value.status_code == 400
    assert "Invalid sample repoPath configuration" in str(exc_info.value.detail)


def test_load_sample_files_skips_mesh_symlinks_outside_sample_repo(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    repo_root = install_sample_root(monkeypatch, tmp_path)
    write_safe_sample(repo_root)
    escaped_mesh = tmp_path / "escaped.STL"
    escaped_mesh.write_bytes(b"solid escaped\nendsolid escaped\n")
    mesh_link = repo_root / TEST_REPO_PATH / "robots" / "meshes" / "escaped.STL"
    mesh_link.symlink_to(escaped_mesh)
    (repo_root / TEST_REPO_PATH / TEST_URDF_PATH).write_text(
        """
<robot name="safe">
  <link name="base">
    <visual>
      <geometry>
        <mesh filename="meshes/link.STL" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="meshes/escaped.STL" />
      </geometry>
    </collision>
  </link>
</robot>
""".strip(),
        encoding="utf-8",
    )
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            }
        },
    )

    response = load_sample_files(TEST_SAMPLE_ID)

    assert {sample_file.path for sample_file in response.files} == {
        TEST_URDF_PATH,
        TEST_MESH_PATH,
    }


def test_load_sample_files_skips_non_file_mesh_candidates(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    repo_root = install_sample_root(monkeypatch, tmp_path)
    write_safe_sample(repo_root)
    directory_candidate = repo_root / TEST_REPO_PATH / "robots" / "meshes" / "not-a-file.STL"
    directory_candidate.mkdir()
    (repo_root / TEST_REPO_PATH / TEST_URDF_PATH).write_text(
        """
<robot name="safe">
  <link name="base">
    <visual>
      <geometry>
        <mesh filename="meshes/link.STL" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="meshes/not-a-file.STL" />
      </geometry>
    </collision>
  </link>
</robot>
""".strip(),
        encoding="utf-8",
    )
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            }
        },
    )

    response = load_sample_files(TEST_SAMPLE_ID)

    assert {sample_file.path for sample_file in response.files} == {
        TEST_URDF_PATH,
        TEST_MESH_PATH,
    }


def test_load_sample_files_returns_only_sample_repo_relative_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    repo_root = install_sample_root(monkeypatch, tmp_path)
    write_safe_sample(repo_root)
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            }
        },
    )

    response = load_sample_files(TEST_SAMPLE_ID)

    assert response.id == TEST_SAMPLE_ID
    assert {sample_file.path for sample_file in response.files} == {
        TEST_URDF_PATH,
        TEST_MESH_PATH,
    }
    encoded_urdf = next(
        sample_file for sample_file in response.files if sample_file.path == TEST_URDF_PATH
    )
    assert base64.b64decode(encoded_urdf.content_base64).decode("utf-8") == TEST_URDF_CONTENT


def test_load_sample_files_returns_only_referenced_meshes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    repo_root = install_sample_root(monkeypatch, tmp_path)
    write_safe_sample(repo_root)
    unreferenced_mesh = repo_root / TEST_REPO_PATH / "robots" / "meshes" / "unreferenced.STL"
    unreferenced_mesh.write_bytes(b"solid unused\nendsolid unused\n")
    install_config(
        monkeypatch,
        {
            TEST_SAMPLE_ID: {
                "label": TEST_SAMPLE_LABEL,
                "repoPath": TEST_REPO_PATH,
                "urdfPath": TEST_URDF_PATH,
            }
        },
    )

    response = load_sample_files(TEST_SAMPLE_ID)

    assert {sample_file.path for sample_file in response.files} == {
        TEST_URDF_PATH,
        TEST_MESH_PATH,
    }


def test_resolve_sample_path_redacts_absolute_host_paths(tmp_path: Path) -> None:
    missing_root = tmp_path / "missing-repo"
    sample = SampleDefinition(
        id=TEST_SAMPLE_ID,
        label=TEST_SAMPLE_LABEL,
        repo_path=str(missing_root),
        urdf_path=TEST_URDF_PATH,
    )

    with pytest.raises(HTTPException) as exc_info:
        samples_service._resolve_sample_path(sample)

    assert exc_info.value.status_code == 400
    assert str(tmp_path) not in str(exc_info.value.detail)
