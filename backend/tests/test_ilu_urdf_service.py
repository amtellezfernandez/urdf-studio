from __future__ import annotations

import json
import subprocess

import pytest

from backend.models.xacro import GitHubXacroExpandRequest
from backend.services import ilu_urdf
from backend.services.ilu_urdf import (
    IluUrdfBridgeError,
    _read_env_str,
    _read_float_env,
    bundle_mesh_assets_for_urdf_file,
    convert_urdf_to_mjcf,
    convert_urdf_to_usd,
    expand_github_xacro,
)


def test_read_float_env_accepts_positive_finite_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URDF_TEST_ILU_FLOAT", "12.5")

    assert _read_float_env("URDF_TEST_ILU_FLOAT", 3.0, minimum=0.0) == 12.5


@pytest.mark.parametrize("raw_value", ["bad", "inf", "-inf", "-1"])
def test_read_float_env_rejects_invalid_non_finite_or_below_minimum_values(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str,
) -> None:
    monkeypatch.setenv("URDF_TEST_ILU_FLOAT", raw_value)

    assert _read_float_env("URDF_TEST_ILU_FLOAT", 3.0, minimum=0.0) == 3.0


def test_read_float_env_rejects_non_string_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ilu_urdf.os,
        "getenv",
        lambda name: object() if name == "URDF_TEST_ILU_FLOAT" else None,
    )

    assert _read_float_env("URDF_TEST_ILU_FLOAT", 3.0, minimum=0.0) == 3.0


def test_read_env_str_returns_default_for_non_string_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ilu_urdf.os,
        "getenv",
        lambda name: object() if name == "URDF_TEST_ILU_TEXT" else None,
    )

    assert _read_env_str("URDF_TEST_ILU_TEXT", "fallback") == "fallback"


def test_read_env_str_returns_default_for_blank_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URDF_TEST_ILU_TEXT", "   ")

    assert _read_env_str("URDF_TEST_ILU_TEXT", "fallback") == "fallback"


def test_expand_github_xacro_uses_load_source_bridge(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("backend.services.ilu_urdf.resolve_server_github_token", lambda token=None: "server-token")

    def _fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        payload = {
            "urdf": "<robot name=\"demo\"/>",
            "ref": "main",
            "entryPath": "urdf/demo.xacro",
            "runtime": "python-xacro",
        }
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("backend.services.ilu_urdf.subprocess.run", _fake_run)

    urdf, stderr = expand_github_xacro(
        GitHubXacroExpandRequest(
            owner="acme",
            repo="demo_robot",
            target_path="urdf/demo.xacro",
            branch="main",
            access_token="token",
        )
    )

    assert calls[0][-1] == "load-source-github"
    assert urdf == "<robot name=\"demo\"/>"
    assert stderr is None


def test_analyze_robot_morphology_ignores_non_string_family_entries(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "primaryFamily": " mobile ",
            "families": [" mobile ", 2, None, "manipulator", "mobile"],
            "linkCount": 1,
            "jointCount": 2,
            "controllableJointCount": 1,
            "dofCount": 1,
            "armCount": 0,
            "legCount": 0,
            "wheelCount": 2,
        },
    )

    result = ilu_urdf.analyze_robot_morphology("<robot name=\"demo\"/>")

    assert result.primary_family == "mobile"
    assert result.families == ("mobile", "manipulator", "mobile")


def test_expand_xacro_rejects_non_string_or_blank_urdf(monkeypatch) -> None:
    monkeypatch.setattr("backend.services.ilu_urdf._run_bridge", lambda command, payload: {"urdf": 123})

    with pytest.raises(IluUrdfBridgeError, match="invalid xacro expansion response"):
        ilu_urdf.expand_xacro(
            ilu_urdf.XacroExpandRequest(
                target_path="robot.xacro",
                files=[],
                args={},
                use_inorder=False,
            )
        )

    monkeypatch.setattr("backend.services.ilu_urdf._run_bridge", lambda command, payload: {"urdf": "   "})

    with pytest.raises(IluUrdfBridgeError, match="invalid xacro expansion response"):
        ilu_urdf.expand_xacro(
            ilu_urdf.XacroExpandRequest(
                target_path="robot.xacro",
                files=[],
                args={},
                use_inorder=False,
            )
        )


def test_expand_github_xacro_trims_urdf_response(monkeypatch) -> None:
    monkeypatch.setattr("backend.services.ilu_urdf.resolve_server_github_token", lambda token=None: "server-token")
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {"urdf": "  <robot name=\"demo\"/>  "},
    )

    urdf, stderr = expand_github_xacro(
        GitHubXacroExpandRequest(
            owner="acme",
            repo="demo_robot",
            target_path="urdf/demo.xacro",
            branch="main",
            access_token="token",
        )
    )

    assert urdf == "<robot name=\"demo\"/>"
    assert stderr is None


def test_run_bridge_rejects_non_object_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf.subprocess.run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            0,
            stdout="[]",
            stderr="",
        ),
    )

    with pytest.raises(IluUrdfBridgeError) as exc_info:
        ilu_urdf._run_bridge("fingerprint", {"urdfXml": "<robot />"})

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "ilu bridge returned an invalid JSON object."


def test_run_bridge_maps_process_execution_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf.subprocess.run",
        lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError("node")),
    )

    with pytest.raises(IluUrdfBridgeError) as exc_info:
        ilu_urdf._run_bridge("fingerprint", {"urdfXml": "<robot />"})

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Failed to execute ilu bridge: node"


def test_bundle_mesh_assets_for_urdf_file_maps_bridge_response(monkeypatch) -> None:
    def _fake_run_bridge(command, payload):
        assert command == "bundle-mesh-assets"
        assert payload["urdfPath"] == "/tmp/demo/robot.urdf"
        assert payload["outPath"] == "/tmp/out/robot.urdf"
        assert payload["extraSearchRoots"] == ["/tmp/demo"]
        return {
            "success": True,
            "content": "<robot name=\"demo\"/>",
            "outPath": "/tmp/out/robot.urdf",
            "assetsRoot": "/tmp/out/assets",
            "copiedFiles": 1,
            "bundled": [
                {
                    "original": "package://demo/meshes/link.stl",
                    "rewritten": "assets/demo/meshes/link.stl",
                    "sourcePath": "/tmp/demo/meshes/link.stl",
                    "targetPath": "/tmp/out/assets/demo/meshes/link.stl",
                }
            ],
            "unresolved": [],
        }

    monkeypatch.setattr("backend.services.ilu_urdf._run_bridge", _fake_run_bridge)

    result = bundle_mesh_assets_for_urdf_file(
        urdf_path="/tmp/demo/robot.urdf",
        urdf_xml="<robot name=\"demo\"/>",
        out_path="/tmp/out/robot.urdf",
        extra_search_roots=["/tmp/demo"],
    )

    assert result.success is True
    assert result.copied_files == 1
    assert result.unresolved == ()
    assert result.bundled[0].original == "package://demo/meshes/link.stl"
    assert result.bundled[0].rewritten == "assets/demo/meshes/link.stl"


def test_bundle_mesh_assets_for_urdf_file_trims_string_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "success": True,
            "content": "  <robot name=\"demo\"/>  ",
            "outPath": " /tmp/out/robot.urdf ",
            "assetsRoot": " /tmp/out/assets ",
            "copiedFiles": 1,
            "bundled": [
                {
                    "original": " package://demo/meshes/link.stl ",
                    "rewritten": " assets/demo/meshes/link.stl ",
                    "sourcePath": " /tmp/demo/meshes/link.stl ",
                    "targetPath": " /tmp/out/assets/demo/meshes/link.stl ",
                }
            ],
            "unresolved": [" meshes/missing.stl "],
            "error": " warning ",
        },
    )

    result = bundle_mesh_assets_for_urdf_file(
        urdf_path="/tmp/demo/robot.urdf",
        urdf_xml="<robot name=\"demo\"/>",
        out_path="/tmp/out/robot.urdf",
        extra_search_roots=["/tmp/demo"],
    )

    assert result.content == "<robot name=\"demo\"/>"
    assert result.out_path == "/tmp/out/robot.urdf"
    assert result.assets_root == "/tmp/out/assets"
    assert result.unresolved == ("meshes/missing.stl",)
    assert result.error == "warning"
    assert result.bundled[0].source_path == "/tmp/demo/meshes/link.stl"


def test_bundle_mesh_assets_for_urdf_file_rejects_blank_string_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "success": True,
            "content": "   ",
            "outPath": "/tmp/out/robot.urdf",
            "assetsRoot": "/tmp/out/assets",
            "copiedFiles": 1,
            "bundled": [],
            "unresolved": [],
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid mesh bundle response"):
        bundle_mesh_assets_for_urdf_file(
            urdf_path="/tmp/demo/robot.urdf",
            urdf_xml="<robot name=\"demo\"/>",
            out_path="/tmp/out/robot.urdf",
            extra_search_roots=["/tmp/demo"],
        )

    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "success": True,
            "content": "<robot name=\"demo\"/>",
            "outPath": "   ",
            "assetsRoot": "/tmp/out/assets",
            "copiedFiles": 1,
            "bundled": [],
            "unresolved": [],
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid mesh bundle path"):
        bundle_mesh_assets_for_urdf_file(
            urdf_path="/tmp/demo/robot.urdf",
            urdf_xml="<robot name=\"demo\"/>",
            out_path="/tmp/out/robot.urdf",
            extra_search_roots=["/tmp/demo"],
        )

    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "success": True,
            "content": "<robot name=\"demo\"/>",
            "outPath": "/tmp/out/robot.urdf",
            "assetsRoot": "/tmp/out/assets",
            "copiedFiles": 1,
            "bundled": [{"original": " ", "rewritten": "ok", "sourcePath": "ok", "targetPath": "ok"}],
            "unresolved": [],
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid bundled mesh entry"):
        bundle_mesh_assets_for_urdf_file(
            urdf_path="/tmp/demo/robot.urdf",
            urdf_xml="<robot name=\"demo\"/>",
            out_path="/tmp/out/robot.urdf",
            extra_search_roots=["/tmp/demo"],
        )

    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "success": True,
            "content": "<robot name=\"demo\"/>",
            "outPath": "/tmp/out/robot.urdf",
            "assetsRoot": "/tmp/out/assets",
            "copiedFiles": 1,
            "bundled": [],
            "unresolved": [" "],
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid unresolved mesh entry"):
        bundle_mesh_assets_for_urdf_file(
            urdf_path="/tmp/demo/robot.urdf",
            urdf_xml="<robot name=\"demo\"/>",
            out_path="/tmp/out/robot.urdf",
            extra_search_roots=["/tmp/demo"],
        )


def test_convert_urdf_to_mjcf_maps_bridge_response(monkeypatch) -> None:
    def _fake_run_bridge(command, payload):
        assert command == "convert-mjcf"
        assert payload["urdfXml"] == "<robot name=\"demo\"/>"
        return {
            "mjcfContent": "<mujoco model=\"demo\"/>",
            "warnings": ["mesh converted by basename"],
            "diagnostics": [
                {
                    "code": "mjcf.inertial.regularized",
                    "severity": "warning",
                    "linkName": "arm_link",
                    "message": "Regularized invalid inertial for link \"arm_link\" during MJCF export.",
                }
            ],
            "stats": {
                "bodiesCreated": 1,
                "jointsConverted": 0,
                "geometriesConverted": 2,
            },
        }

    monkeypatch.setattr("backend.services.ilu_urdf._run_bridge", _fake_run_bridge)

    result = convert_urdf_to_mjcf("<robot name=\"demo\"/>")

    assert result.mjcf_content == "<mujoco model=\"demo\"/>"
    assert result.warnings == ("mesh converted by basename",)
    assert result.diagnostics[0].code == "mjcf.inertial.regularized"
    assert result.diagnostics[0].link_name == "arm_link"
    assert result.stats.bodies_created == 1
    assert result.stats.geometries_converted == 2


def test_convert_urdf_to_mjcf_trims_string_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "mjcfContent": "  <mujoco model=\"demo\"/>  ",
            "warnings": [" mesh converted by basename "],
            "diagnostics": [
                {
                    "code": " mjcf.inertial.regularized ",
                    "severity": " warning ",
                    "linkName": " arm_link ",
                    "message": " trimmed message ",
                }
            ],
            "stats": {
                "bodiesCreated": 1,
                "jointsConverted": 0,
                "geometriesConverted": 2,
            },
        },
    )

    result = convert_urdf_to_mjcf("<robot name=\"demo\"/>")

    assert result.mjcf_content == "<mujoco model=\"demo\"/>"
    assert result.warnings == ("mesh converted by basename",)
    assert result.diagnostics[0].code == "mjcf.inertial.regularized"
    assert result.diagnostics[0].severity == "warning"
    assert result.diagnostics[0].link_name == "arm_link"
    assert result.diagnostics[0].message == "trimmed message"


def test_convert_urdf_to_mjcf_rejects_blank_warning_or_diagnostic_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "mjcfContent": "<mujoco model=\"demo\"/>",
            "warnings": ["   "],
            "diagnostics": [],
            "stats": {
                "bodiesCreated": 1,
                "jointsConverted": 0,
                "geometriesConverted": 2,
            },
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid MJCF conversion warning"):
        convert_urdf_to_mjcf("<robot name=\"demo\"/>")

    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "mjcfContent": "<mujoco model=\"demo\"/>",
            "warnings": [],
            "diagnostics": [
                {
                    "code": " ",
                    "severity": "warning",
                    "linkName": "arm_link",
                    "message": "message",
                }
            ],
            "stats": {
                "bodiesCreated": 1,
                "jointsConverted": 0,
                "geometriesConverted": 2,
            },
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid MJCF conversion diagnostic"):
        convert_urdf_to_mjcf("<robot name=\"demo\"/>")


def test_convert_urdf_to_usd_maps_bridge_response(monkeypatch) -> None:
    def _fake_run_bridge(command, payload):
        assert command == "convert-usd"
        assert payload["urdfXml"] == "<robot name=\"demo\"/>"
        return {
            "usdContent": "#usda 1.0\n",
            "warnings": ["Skipped unsupported visual mesh meshes/base.stl on link base."],
            "stats": {
                "linksConverted": 1,
                "jointsConverted": 0,
                "visualsConverted": 1,
                "collisionsConverted": 0,
                "inlineMeshesConverted": 0,
                "unsupportedMeshes": 1,
            },
        }

    monkeypatch.setattr("backend.services.ilu_urdf._run_bridge", _fake_run_bridge)

    result = convert_urdf_to_usd("<robot name=\"demo\"/>")

    assert result.usd_content == "#usda 1.0"
    assert result.warnings == ("Skipped unsupported visual mesh meshes/base.stl on link base.",)
    assert result.stats.links_converted == 1
    assert result.stats.visuals_converted == 1
    assert result.stats.unsupported_meshes == 1


def test_convert_urdf_to_usd_trims_string_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "usdContent": "  #usda 1.0\n  ",
            "warnings": [" Skipped unsupported visual mesh meshes/base.stl on link base. "],
            "stats": {
                "linksConverted": 1,
                "jointsConverted": 0,
                "visualsConverted": 1,
                "collisionsConverted": 0,
                "inlineMeshesConverted": 0,
                "unsupportedMeshes": 1,
            },
        },
    )

    result = convert_urdf_to_usd("<robot name=\"demo\"/>")

    assert result.usd_content == "#usda 1.0"
    assert result.warnings == ("Skipped unsupported visual mesh meshes/base.stl on link base.",)


def test_convert_urdf_to_usd_rejects_blank_warning_or_content(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "usdContent": "   ",
            "warnings": [],
            "stats": {
                "linksConverted": 1,
                "jointsConverted": 0,
                "visualsConverted": 1,
                "collisionsConverted": 0,
                "inlineMeshesConverted": 0,
                "unsupportedMeshes": 1,
            },
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid USD conversion response"):
        convert_urdf_to_usd("<robot name=\"demo\"/>")

    monkeypatch.setattr(
        "backend.services.ilu_urdf._run_bridge",
        lambda command, payload: {
            "usdContent": "#usda 1.0\n",
            "warnings": [" "],
            "stats": {
                "linksConverted": 1,
                "jointsConverted": 0,
                "visualsConverted": 1,
                "collisionsConverted": 0,
                "inlineMeshesConverted": 0,
                "unsupportedMeshes": 1,
            },
        },
    )

    with pytest.raises(IluUrdfBridgeError, match="invalid USD conversion warning"):
        convert_urdf_to_usd("<robot name=\"demo\"/>")
