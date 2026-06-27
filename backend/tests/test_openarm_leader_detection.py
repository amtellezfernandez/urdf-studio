from __future__ import annotations

from pathlib import Path

import backend.robot_gateway.openarm_leader_detection as leader_detection
from backend.robot_gateway.openarm_leader_detection import (
    OpenArmLeaderMotorProbe,
    _build_leader_control_parts,
    _probe_leader_motors_cached,
    _resolve_configured_port_status,
    detect_openarm_leaders,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING,
    ROBOT_GATEWAY_OPENARM_LEADER_RECOMMENDED_ENV,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_LEADER_CANDIDATE,
    ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOB_SOURCE,
)

_CACHE_TEST_TIME_ORIGIN_SEC = 0.0


def test_detect_openarm_leaders_prefers_stable_serial_by_id_path(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_5A46082861-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2, 3, 4, 5, 6, 7, 8],
        ),
    )

    assert result.preferred_leader_port == str(stable_path)
    assert len(result.leaders) == 1
    leader = result.leaders[0]
    assert leader.path == str(stable_path)
    assert leader.device_path == str(device)
    assert leader.identity_key == "serial-by-id:1a86_USB_Single_Serial_5A46082861"
    assert leader.identity_stable is True
    assert leader.serial == "5A46082861"
    assert leader.source == ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE
    assert leader.leader_type == ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_LEADER_CANDIDATE
    assert leader.hardware_family == "arm_controller"
    assert leader.motor_bus == "feetech"
    assert leader.motor_ids == [1, 2, 3, 4, 5, 6, 7, 8]
    assert leader.motor_count == 8
    assert len(leader.control_parts) == 1
    assert leader.control_parts[0].kind == "arm"
    assert leader.control_parts[0].actuator_count == 8
    assert leader.control_parts[0].motor_ids == [1, 2, 3, 4, 5, 6, 7, 8]
    assert leader.recommended_env == ROBOT_GATEWAY_OPENARM_LEADER_RECOMMENDED_ENV
    assert leader.available is True
    assert [provider.id for provider in result.runtime_providers] == [
        "lerobot",
        "dora",
    ]
    assert result.runtime_providers[0].connectable is True


def test_detect_openarm_leaders_falls_back_to_tty_candidates(
    tmp_path: Path,
) -> None:
    dev_root = tmp_path / "dev"
    dev_root.mkdir()
    device = dev_root / "ttyUSB0"
    device.touch()

    result = detect_openarm_leaders(dev_root)

    assert result.preferred_leader_port is None
    assert len(result.leaders) == 1
    leader = result.leaders[0]
    assert leader.path == str(device)
    assert leader.device_path == str(device)
    assert leader.identity_key == "path:ttyUSB0"
    assert leader.identity_stable is False
    assert leader.serial is None
    assert leader.source == ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOB_SOURCE


def test_detect_openarm_leaders_classifies_generic_six_motor_arm(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_58FA095368-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2, 3, 4, 5, 6],
        ),
    )

    assert result.preferred_leader_port == str(stable_path)
    assert len(result.leaders) == 1
    leader = result.leaders[0]
    assert leader.hardware_family == "arm_controller"
    assert leader.motor_ids == [1, 2, 3, 4, 5, 6]
    assert leader.motor_count == 6
    assert len(leader.control_parts) == 1
    assert leader.control_parts[0].kind == "arm"
    assert leader.control_parts[0].actuator_count == 6
    assert leader.control_parts[0].motor_ids == [1, 2, 3, 4, 5, 6]


def test_detect_openarm_leaders_uses_lerobot_calibration_joint_order(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_dir = (
        tmp_path
        / "home"
        / ".cache"
        / "huggingface"
        / "lerobot"
        / "calibration"
        / "teleoperators"
        / "so100_leader"
    )
    calibration_dir.mkdir(parents=True)
    calibration_path = calibration_dir / "my_leader.json"
    calibration_path.write_text(
        """
        {
          "shoulder_pan": {"id": 1},
          "shoulder_lift": {"id": 2},
          "elbow_flex": {"id": 3},
          "wrist_flex": {"id": 4},
          "wrist_roll": {"id": 5},
          "gripper": {"id": 6}
        }
        """,
        encoding="utf-8",
    )
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_58FA095368-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2, 3, 4, 5, 6],
            motor_models={1: "777", 2: "777", 3: "777"},
        ),
    )

    leader = result.leaders[0]
    assert len(leader.control_parts) == 1
    control_part = leader.control_parts[0]
    assert control_part.label == "so100_leader · my_leader"
    assert control_part.calibration_profile == "so100_leader"
    assert control_part.calibration_id == "my_leader"
    assert control_part.configured_port is None
    assert control_part.configured_port_matches is False
    assert control_part.configured_port_status == "none"
    assert control_part.calibration_mtime_ns == calibration_path.stat().st_mtime_ns
    assert control_part.joint_names == [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
    ]
    assert control_part.zero_positions_rad == {
        "shoulder_pan": 0.0,
        "shoulder_lift": 0.0,
        "elbow_flex": 0.0,
        "wrist_flex": 0.0,
        "wrist_roll": 0.0,
        "gripper": 0.0,
    }
    assert control_part.motor_ids == [1, 2, 3, 4, 5, 6]


def test_detect_openarm_leaders_splits_side_specific_lerobot_calibration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_dir = (
        tmp_path
        / "home"
        / ".cache"
        / "huggingface"
        / "lerobot"
        / "calibration"
        / "teleoperators"
        / "openarm_mini"
    )
    calibration_dir.mkdir(parents=True)
    (calibration_dir / "my_leader.json").write_text(
        """
        {
          "right_joint_1": {"id": 1},
          "right_joint_2": {"id": 2},
          "left_joint_1": {"id": 1},
          "left_joint_2": {"id": 2}
        }
        """,
        encoding="utf-8",
    )
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_openarm-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2],
        ),
    )

    labels = [part.label for part in result.leaders[0].control_parts]
    ids = [part.id for part in result.leaders[0].control_parts]
    assert labels == [
        "openarm_mini · my_leader · left",
        "openarm_mini · my_leader · right",
    ]
    assert ids == [
        "feetech:openarm_mini:my_leader:left:1-2",
        "feetech:openarm_mini:my_leader:right:1-2",
    ]
    assert result.leaders[0].control_parts[0].joint_names == [
        "left_joint_1",
        "left_joint_2",
    ]


def test_detect_openarm_leaders_ranks_matching_device_port_calibration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_root = (
        tmp_path / "home" / ".cache" / "huggingface" / "lerobot" / "calibration"
    )
    calibration_dir = calibration_root / "teleoperators" / "so100_leader"
    calibration_dir.mkdir(parents=True)
    for calibration_id in ("arm_a", "arm_b"):
        (calibration_dir / f"{calibration_id}.json").write_text(
            """
            {
              "shoulder_pan": {"id": 1},
              "shoulder_lift": {"id": 2}
            }
            """,
            encoding="utf-8",
        )
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_so100-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))
    (calibration_root / "device_ports.json").write_text(
        f"""
        {{
          "teleop": {{
            "so100_leader": {{
              "arm_a": "/dev/ttyOTHER",
              "arm_b": "{device}"
            }}
          }}
        }}
        """,
        encoding="utf-8",
    )

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2],
        ),
    )

    control_parts = result.leaders[0].control_parts
    assert [part.calibration_id for part in control_parts] == ["arm_b", "arm_a"]
    assert control_parts[0].configured_port == str(device)
    assert control_parts[0].configured_port_matches is True
    assert control_parts[0].configured_port_status == "matched"
    assert control_parts[1].configured_port == "/dev/ttyOTHER"
    assert control_parts[1].configured_port_matches is False
    assert control_parts[1].configured_port_status == "stale"


def test_lerobot_configured_port_status_matches_serial_port_aliases() -> None:
    tty_path = Path("/dev/tty.usbmodem58760433331")
    cu_path = Path("/dev/cu.usbmodem58760433331")

    assert (
        _resolve_configured_port_status(
            "/dev/cu.usbmodem58760433331",
            path=tty_path,
            resolved_path=tty_path,
        )
        == "matched"
    )
    assert (
        _resolve_configured_port_status(
            "/dev/tty.usbmodem58760433331",
            path=cu_path,
            resolved_path=cu_path,
        )
        == "matched"
    )


def test_lerobot_control_parts_rank_matching_configured_serial_port(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_root = (
        tmp_path / "home" / ".cache" / "huggingface" / "lerobot" / "calibration"
    )
    calibration_dir = calibration_root / "teleoperators" / "so100_leader"
    calibration_dir.mkdir(parents=True)
    for calibration_id in ("arm_a", "arm_b"):
        (calibration_dir / f"{calibration_id}.json").write_text(
            """
            {
              "shoulder_pan": {"id": 1},
              "shoulder_lift": {"id": 2}
            }
            """,
            encoding="utf-8",
        )
    (calibration_root / "device_ports.json").write_text(
        """
        {
          "teleop": {
            "so100_leader": {
              "arm_a": "/dev/cu.usbmodem58760433331",
              "arm_b": "/dev/cu.usbmodemOTHER"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    control_parts = _build_leader_control_parts(
        OpenArmLeaderMotorProbe(bus="feetech", motor_ids=[1, 2]),
        path=Path("/dev/tty.usbmodem58760433331"),
        resolved_path=Path("/dev/tty.usbmodem58760433331"),
    )

    assert [part.calibration_id for part in control_parts] == ["arm_a", "arm_b"]
    assert control_parts[0].configured_port == "/dev/cu.usbmodem58760433331"
    assert control_parts[0].configured_port_matches is True
    assert control_parts[0].configured_port_status == "matched"
    assert control_parts[1].configured_port == "/dev/cu.usbmodemOTHER"
    assert control_parts[1].configured_port_matches is False
    assert control_parts[1].configured_port_status == "stale"


def test_so101_leader_calibration_uses_serial_port_alias_matching(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_root = (
        tmp_path / "home" / ".cache" / "huggingface" / "lerobot" / "calibration"
    )
    calibration_dir = calibration_root / "teleoperators" / "so101_leader"
    calibration_dir.mkdir(parents=True)
    (calibration_dir / "desk_leader.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1},
          "shoulder_lift": {"id": 2},
          "elbow_flex": {"id": 3},
          "wrist_flex": {"id": 4},
          "wrist_roll": {"id": 5},
          "gripper": {"id": 6}
        }
        """,
        encoding="utf-8",
    )
    (calibration_root / "device_ports.json").write_text(
        """
        {
          "teleop": {
            "so101_leader": {
              "desk_leader": "/dev/cu.usbmodem58760433331"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    control_parts = _build_leader_control_parts(
        OpenArmLeaderMotorProbe(bus="feetech", motor_ids=[1, 2, 3, 4, 5, 6]),
        path=Path("/dev/tty.usbmodem58760433331"),
        resolved_path=Path("/dev/tty.usbmodem58760433331"),
    )

    assert len(control_parts) == 1
    control_part = control_parts[0]
    assert control_part.label == "so101_leader · desk_leader"
    assert control_part.calibration_profile == "so101_leader"
    assert control_part.calibration_id == "desk_leader"
    assert control_part.configured_port == "/dev/cu.usbmodem58760433331"
    assert control_part.configured_port_matches is True
    assert control_part.configured_port_status == "matched"


def test_detect_openarm_leaders_matches_robot_calibration_for_reusable_arm_config(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_root = (
        tmp_path / "home" / ".cache" / "huggingface" / "lerobot" / "calibration"
    )
    calibration_dir = calibration_root / "robots" / "so100_follower"
    calibration_dir.mkdir(parents=True)
    (calibration_dir / "shared_arm.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1},
          "shoulder_lift": {"id": 2},
          "elbow_flex": {"id": 3},
          "wrist_flex": {"id": 4},
          "wrist_roll": {"id": 5},
          "gripper": {"id": 6}
        }
        """,
        encoding="utf-8",
    )
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_shared-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))
    (calibration_root / "device_ports.json").write_text(
        f"""
        {{
          "robots": {{
            "so100_follower": {{
              "shared_arm": "{stable_path}"
            }}
          }}
        }}
        """,
        encoding="utf-8",
    )

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2, 3, 4, 5, 6],
        ),
    )

    control_part = result.leaders[0].control_parts[0]
    assert control_part.label == "so100_follower · shared_arm"
    assert control_part.calibration_profile == "so100_follower"
    assert control_part.calibration_id == "shared_arm"
    assert control_part.configured_port == str(stable_path)
    assert control_part.configured_port_matches is True
    assert control_part.configured_port_status == "matched"


def test_detect_openarm_leaders_keeps_stale_tty_port_advisory(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    calibration_root = (
        tmp_path / "home" / ".cache" / "huggingface" / "lerobot" / "calibration"
    )
    calibration_dir = calibration_root / "teleoperators" / "so100_leader"
    calibration_dir.mkdir(parents=True)
    (calibration_dir / "my_leader.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1},
          "shoulder_lift": {"id": 2}
        }
        """,
        encoding="utf-8",
    )
    dev_root = tmp_path / "dev"
    serial_by_id = dev_root / "serial" / "by-id"
    serial_by_id.mkdir(parents=True)
    device = dev_root / "ttyACM0"
    device.touch()
    stable_path = serial_by_id / "usb-1a86_USB_Single_Serial_so100-if00"
    stable_path.symlink_to(Path("../../ttyACM0"))
    (calibration_root / "device_ports.json").write_text(
        f"""
        {{
          "teleop": {{
            "so100_leader": {{
              "my_leader": "{dev_root / "ttyACM1"}"
            }}
          }}
        }}
        """,
        encoding="utf-8",
    )

    result = detect_openarm_leaders(
        dev_root,
        motor_probe=lambda _path: OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[1, 2],
        ),
    )

    control_part = result.leaders[0].control_parts[0]
    assert control_part.calibration_id == "my_leader"
    assert control_part.configured_port == str(dev_root / "ttyACM1")
    assert control_part.configured_port_matches is False
    assert control_part.configured_port_status == "stale"


def test_detect_openarm_leaders_supports_macos_usbmodem_leaders(
    tmp_path: Path,
) -> None:
    dev_root = tmp_path / "dev"
    dev_root.mkdir()
    device = dev_root / "tty.usbmodem58760433331"
    device.touch()

    result = detect_openarm_leaders(dev_root)

    assert result.preferred_leader_port is None
    assert len(result.leaders) == 1
    leader = result.leaders[0]
    assert leader.path == str(device)
    assert leader.device_path == str(device)
    assert leader.identity_key == "path:tty.usbmodem58760433331"
    assert leader.identity_stable is False
    assert leader.serial is None
    assert leader.source == ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOB_SOURCE


def test_detect_openarm_leaders_reports_configured_dora_provider(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    dataflow_path = tmp_path / "teleop.yml"
    dataflow_path.write_text("nodes: []\n", encoding="utf-8")
    dora_bin = tmp_path / "dora"
    dora_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    dora_bin.chmod(0o755)
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_DORA_BIN", str(dora_bin))
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_DORA_DATAFLOW", str(dataflow_path))
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_DORA_NODE_ID", "robot_control")
    dev_root = tmp_path / "dev"
    dev_root.mkdir()

    result = detect_openarm_leaders(dev_root)

    dora_provider = next(
        provider for provider in result.runtime_providers if provider.id == "dora"
    )
    assert dora_provider.status == "available"
    assert dora_provider.connectable is True
    assert dora_provider.config_ref == str(dataflow_path)
    assert dora_provider.node_id == "robot_control"


def test_motor_probe_cache_outlasts_frontend_detection_refresh(monkeypatch) -> None:
    # Regression guard for slow hardware-teleop leader connect: if the probe
    # cache TTL drops to or below the frontend's detection refresh interval,
    # every refresh misses the cache and re-runs the per-port motor probe.
    assert (
        ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING.motor_probe_cache_ttl_sec
        > ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING.frontend_refresh_interval_sec
    )

    leader_detection._motor_probe_cache.clear()
    probe_calls = {"count": 0}

    def fake_probe(_path: Path) -> OpenArmLeaderMotorProbe:
        probe_calls["count"] += 1
        return OpenArmLeaderMotorProbe(bus="feetech", motor_ids=[1, 2, 3, 4, 5, 6])

    fake_time = {"now": _CACHE_TEST_TIME_ORIGIN_SEC}
    monkeypatch.setattr(leader_detection, "_probe_leader_motors", fake_probe)
    monkeypatch.setattr(leader_detection, "monotonic", lambda: fake_time["now"])

    port = Path("/dev/ttyUSB0")
    _probe_leader_motors_cached(port)  # cold probe at t=0
    fake_time["now"] = (
        ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING.frontend_refresh_interval_sec
    )
    _probe_leader_motors_cached(port)  # frontend refresh -> must hit cache
    assert probe_calls["count"] == 1

    fake_time["now"] = (
        ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING.motor_probe_cache_ttl_sec
        + ROBOT_GATEWAY_OPENARM_LEADER_DETECTION_TIMING.frontend_refresh_interval_sec
    )
    _probe_leader_motors_cached(port)  # past TTL -> re-probe
    assert probe_calls["count"] == 2

    leader_detection._motor_probe_cache.clear()
