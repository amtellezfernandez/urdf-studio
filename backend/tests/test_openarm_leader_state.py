import math
import threading
from dataclasses import dataclass
from time import monotonic

from backend.robot_gateway.openarm_leader_state import (
    OpenArmLeaderStateService,
    _LeaderCalibrationRef,
    _LeaderReaderLease,
    _LeRobotTeleoperatorLeaderReader,
    _build_lerobot_teleoperator_config_payload,
    _extract_lerobot_action_positions,
    _load_lerobot_axis_calibration_group,
    _load_lerobot_axis_calibration,
    _resolve_lerobot_motor_norm_mode,
    _should_use_lerobot_teleoperator_reader,
    map_generic_leader_positions_to_axes,
    map_lerobot_action_positions_to_joints,
    map_openarm_mini_positions_to_joints,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_OPEN_RAD,
)


@dataclass(frozen=True)
class _LeaderReadConcurrencyTiming:
    idle_timeout_sec: float
    reader_hold_timeout_sec: float
    start_wait_timeout_sec: float
    serialization_probe_timeout_sec: float


_LEADER_READ_CONCURRENCY_TIMING = _LeaderReadConcurrencyTiming(
    idle_timeout_sec=60.0,
    reader_hold_timeout_sec=2.0,
    start_wait_timeout_sec=2.0,
    serialization_probe_timeout_sec=0.3,
)

LEADER_JOINT1_DEG = 10.0
LEADER_JOINT2_DEG = 15.0
LEADER_JOINT3_DEG = 25.0
LEADER_JOINT6_DEG = 20.0
LEADER_JOINT7_DEG = 30.0
LEADER_GRIPPER_PERCENT = 40.0
OPENARM_MINI_GRIPPER_DEG = -26.0


class _FakeLeaderReader:
    def __init__(self) -> None:
        self.disconnected = False

    def read(self) -> dict[str, float]:
        return {}

    def disconnect(self) -> None:
        self.disconnected = True


class _FakeTeleoperator:
    def __init__(self) -> None:
        self.is_connected = False
        self.connect_calibrate_args: list[bool] = []
        self.disconnected = False

    def connect(self, *, calibrate: bool = True) -> None:
        self.connect_calibrate_args.append(calibrate)
        self.is_connected = True

    def get_action(self) -> dict[str, float]:
        return {
            "shoulder_pan.pos": LEADER_JOINT1_DEG,
            "gripper.pos": LEADER_GRIPPER_PERCENT,
            "shoulder_pan.vel": 3.0,
        }

    def disconnect(self) -> None:
        self.disconnected = True
        self.is_connected = False


def test_maps_single_openarm_mini_leader_to_virtual_bimanual_joints() -> None:
    joints = map_openarm_mini_positions_to_joints(
        {
            "joint_1": LEADER_JOINT1_DEG,
            "joint_6": LEADER_JOINT6_DEG,
            "joint_7": LEADER_JOINT7_DEG,
            "gripper": LEADER_GRIPPER_PERCENT,
        },
        side="both",
    )

    assert joints["openarm_left_joint1"].position_rad == math.radians(-LEADER_JOINT1_DEG)
    assert joints["openarm_right_joint1"].position_rad == math.radians(-LEADER_JOINT1_DEG)
    assert joints["openarm_left_joint7"].position_rad == math.radians(-LEADER_JOINT6_DEG)
    assert joints["openarm_right_joint7"].position_rad == math.radians(LEADER_JOINT6_DEG)
    assert joints["openarm_left_joint6"].position_rad == math.radians(-LEADER_JOINT7_DEG)
    assert joints["openarm_right_joint6"].position_rad == math.radians(-LEADER_JOINT7_DEG)
    assert joints["openarm_left_finger_joint1"].position_rad == math.radians(OPENARM_MINI_GRIPPER_DEG)
    assert joints["openarm_right_finger_joint1"].position_rad == math.radians(OPENARM_MINI_GRIPPER_DEG)


def test_maps_assigned_openarm_mini_leader_to_one_side_only() -> None:
    joints = map_openarm_mini_positions_to_joints(
        {
            "joint_2": LEADER_JOINT2_DEG,
            "joint_3": LEADER_JOINT3_DEG,
        },
        side="right",
    )

    assert set(joints) == {"openarm_right_joint2", "openarm_right_joint3"}
    assert joints["openarm_right_joint2"].position_rad == math.radians(-LEADER_JOINT2_DEG)
    assert joints["openarm_right_joint3"].position_rad == math.radians(-LEADER_JOINT3_DEG)


def test_maps_generic_feetech_leader_positions_to_ordered_axes() -> None:
    joints = map_generic_leader_positions_to_axes(
        {
            "leader_axis_1": LEADER_JOINT1_DEG,
            "leader_axis_2": LEADER_JOINT2_DEG,
            "ignored": float("nan"),
        },
    )

    assert set(joints) == {"leader_axis_1", "leader_axis_2"}
    assert joints["leader_axis_1"].position_rad == math.radians(LEADER_JOINT1_DEG)
    assert joints["leader_axis_2"].position_rad == math.radians(LEADER_JOINT2_DEG)


def test_extracts_lerobot_action_position_keys_only() -> None:
    positions = _extract_lerobot_action_positions(
        {
            "shoulder_pan.pos": LEADER_JOINT1_DEG,
            "shoulder_pan.vel": 2.0,
            "gripper.pos": LEADER_GRIPPER_PERCENT,
            "ignored.pos": float("nan"),
        },
    )

    assert positions == {
        "shoulder_pan": LEADER_JOINT1_DEG,
        "gripper": LEADER_GRIPPER_PERCENT,
    }


def test_maps_lerobot_gripper_action_units_to_model_rad() -> None:
    joints = map_lerobot_action_positions_to_joints(
        {
            "shoulder_pan": LEADER_JOINT1_DEG,
            "gripper": LEADER_GRIPPER_PERCENT,
        },
    )

    assert joints["shoulder_pan"].position_rad == math.radians(LEADER_JOINT1_DEG)
    expected_gripper_rad = ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD + (
        LEADER_GRIPPER_PERCENT / 100.0
    ) * (ROBOT_GATEWAY_LEROBOT_GRIPPER_OPEN_RAD - ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD)
    assert joints["gripper"].position_rad == expected_gripper_rad


def test_maps_lerobot_gripper_endpoints_across_full_model_range() -> None:
    closed = map_lerobot_action_positions_to_joints({"gripper": 0.0})
    open_ = map_lerobot_action_positions_to_joints({"gripper": 100.0})

    assert closed["gripper"].position_rad == ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD
    assert open_["gripper"].position_rad == ROBOT_GATEWAY_LEROBOT_GRIPPER_OPEN_RAD


def test_maps_so_style_lerobot_shoulder_pan_to_urdf_direction() -> None:
    joints = map_lerobot_action_positions_to_joints(
        {
            "shoulder_pan": LEADER_JOINT1_DEG,
            "shoulder_lift": LEADER_JOINT2_DEG,
        },
        calibration_profile="so100_leader",
    )

    assert joints["shoulder_pan"].position_rad == -math.radians(LEADER_JOINT1_DEG)
    assert joints["shoulder_lift"].position_rad == math.radians(LEADER_JOINT2_DEG)


def test_lerobot_teleoperator_reader_uses_official_action_interface() -> None:
    fake_teleoperator = _FakeTeleoperator()
    calibration_ref = _LeaderCalibrationRef(
        category="teleoperators",
        profile_id="so100_leader",
        calibration_id="my_leader",
        group_id="all",
    )
    reader = _LeRobotTeleoperatorLeaderReader(
        "/dev/ttyACM0",
        calibration_ref,
        teleoperator_factory=lambda _port, _ref: fake_teleoperator,
    )

    positions = reader.read()
    reader.disconnect()

    assert positions == {
        "shoulder_pan": LEADER_JOINT1_DEG,
        "gripper": LEADER_GRIPPER_PERCENT,
    }
    assert fake_teleoperator.connect_calibrate_args == [False]
    assert fake_teleoperator.disconnected


def test_uses_lerobot_teleoperator_reader_for_supported_teleop_profiles() -> None:
    assert _should_use_lerobot_teleoperator_reader(
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="so100_leader",
            calibration_id="my_leader",
            group_id="all",
        )
    )
    assert _should_use_lerobot_teleoperator_reader(
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="so101_leader",
            calibration_id="my_leader",
            group_id="all",
        )
    )
    assert _should_use_lerobot_teleoperator_reader(
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="openarm_mini",
            calibration_id="mini_leader",
            group_id="left",
        )
    )
    assert not _should_use_lerobot_teleoperator_reader(
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="openarm_mini",
            calibration_id="mini_leader",
            group_id="all",
        )
    )
    assert not _should_use_lerobot_teleoperator_reader(
        _LeaderCalibrationRef(
            category="robots",
            profile_id="so100_follower",
            calibration_id="my_follower",
            group_id="all",
        )
    )


def test_builds_single_port_lerobot_teleoperator_payload(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "backend.robot_gateway.openarm_leader_state.ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT",
        str(tmp_path / "calibration"),
    )

    payload = _build_lerobot_teleoperator_config_payload(
        "/dev/ttyACM0",
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="so101_leader",
            calibration_id="leader_blue",
            group_id="all",
        ),
    )

    assert payload == {
        "type": "so101_leader",
        "id": "leader_blue",
        "calibration_dir": tmp_path / "calibration" / "teleoperators" / "so101_leader",
        "use_degrees": True,
        "port": "/dev/ttyACM0",
    }


def test_builds_openarm_mini_side_lerobot_teleoperator_payload(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(
        "backend.robot_gateway.openarm_leader_state.ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT",
        str(tmp_path / "calibration"),
    )

    payload = _build_lerobot_teleoperator_config_payload(
        "/dev/serial/by-id/openarm-left",
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="openarm_mini",
            calibration_id="mini_leader",
            group_id="left",
        ),
    )

    assert payload == {
        "type": "openarm_mini",
        "id": "mini_leader",
        "calibration_dir": tmp_path / "calibration" / "teleoperators" / "openarm_mini",
        "port_left": "/dev/serial/by-id/openarm-left",
        "port_right": "zero://urdf-studio/right",
    }


def test_releases_matching_cached_leader_reader() -> None:
    service = OpenArmLeaderStateService()
    matching_reader = _FakeLeaderReader()
    other_reader = _FakeLeaderReader()
    service._readers[("/dev/ttyACM0", (1, 2), "sts3215", None)] = (
        _LeaderReaderLease(matching_reader, 1.0)
    )
    service._readers[("/dev/ttyACM1", (1, 2), "sts3215", None)] = (
        _LeaderReaderLease(other_reader, 1.0)
    )

    result = service.release(
        port="/dev/ttyACM0",
        motor_ids=[1, 2],
        motor_model="sts3215",
    )

    assert result.released == 1
    assert matching_reader.disconnected
    assert not other_reader.disconnected
    assert list(service._readers) == [("/dev/ttyACM1", (1, 2), "sts3215", None)]


def test_release_all_cached_leader_readers() -> None:
    service = OpenArmLeaderStateService()
    first_reader = _FakeLeaderReader()
    second_reader = _FakeLeaderReader()
    service._readers[("/dev/ttyACM0", (1,), None, None)] = _LeaderReaderLease(
        first_reader,
        1.0,
    )
    service._readers[("/dev/ttyACM1", (2,), None, None)] = _LeaderReaderLease(
        second_reader,
        1.0,
    )

    result = service.release_all()

    assert result.released == 2
    assert first_reader.disconnected
    assert second_reader.disconnected
    assert service._readers == {}


def test_releases_idle_cached_leader_readers() -> None:
    service = OpenArmLeaderStateService(idle_timeout_sec=2.0)
    idle_reader = _FakeLeaderReader()
    active_reader = _FakeLeaderReader()
    service._readers[("/dev/ttyACM0", (1,), None, None)] = _LeaderReaderLease(
        idle_reader,
        10.0,
    )
    service._readers[("/dev/ttyACM1", (2,), None, None)] = _LeaderReaderLease(
        active_reader,
        13.5,
    )

    idle_leases = service._collect_idle_leases_locked(15.0)

    # Collection drops idle leases from the dict but defers serial disconnect to
    # outside the service lock (each under its own port lock).
    assert [port for port, _ in idle_leases] == ["/dev/ttyACM0"]
    assert not idle_reader.disconnected
    assert list(service._readers) == [("/dev/ttyACM1", (2,), None, None)]

    for port, lease in idle_leases:
        service._disconnect_lease(port, lease)

    assert idle_reader.disconnected
    assert not active_reader.disconnected


def test_loads_lerobot_calibration_for_generic_axes(tmp_path, monkeypatch) -> None:
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
    (calibration_dir / "my_leader.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1, "drive_mode": 0, "homing_offset": 515, "range_min": 731, "range_max": 3422},
          "shoulder_lift": {"id": 2, "drive_mode": 0, "homing_offset": 137, "range_min": 901, "range_max": 3294}
        }
        """,
        encoding="utf-8",
    )

    class Calibration:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    calibration = _load_lerobot_axis_calibration(
        (1, 2),
        motor_names=("leader_axis_1", "leader_axis_2"),
        motor_calibration_cls=Calibration,
        calibration_ref=_LeaderCalibrationRef(
            category="teleoperators",
            profile_id="so100_leader",
            calibration_id="my_leader",
            group_id="all",
        ),
    )

    assert calibration is not None
    assert calibration["leader_axis_1"].homing_offset == 515
    assert calibration["leader_axis_2"].range_min == 901


def test_loads_lerobot_calibration_group_joint_names(tmp_path, monkeypatch) -> None:
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
    (calibration_dir / "my_leader.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1, "drive_mode": 0, "homing_offset": 515, "range_min": 731, "range_max": 3422},
          "shoulder_lift": {"id": 2, "drive_mode": 0, "homing_offset": 137, "range_min": 901, "range_max": 3294},
          "elbow_flex": {"id": 3, "drive_mode": 0, "homing_offset": 100, "range_min": 700, "range_max": 3300},
          "wrist_flex": {"id": 4, "drive_mode": 0, "homing_offset": 100, "range_min": 700, "range_max": 3300},
          "wrist_roll": {"id": 5, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
          "gripper": {"id": 6, "drive_mode": 0, "homing_offset": 200, "range_min": 1000, "range_max": 3000}
        }
        """,
        encoding="utf-8",
    )

    group = _load_lerobot_axis_calibration_group(
        (1, 2, 3, 4, 5, 6),
        _LeaderCalibrationRef(
            category="teleoperators",
            profile_id="so100_leader",
            calibration_id="my_leader",
            group_id="all",
        ),
    )

    assert group is not None
    assert group.joint_names == (
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
    )


def test_resolves_lerobot_gripper_motor_norm_mode() -> None:
    class NormMode:
        DEGREES = "degrees"
        RANGE_0_100 = "range_0_100"

    assert _resolve_lerobot_motor_norm_mode("gripper", NormMode) == "range_0_100"
    assert _resolve_lerobot_motor_norm_mode("arm_gripper", NormMode) == "range_0_100"
    assert _resolve_lerobot_motor_norm_mode("shoulder_pan", NormMode) == "degrees"


def test_loads_lerobot_robot_calibration_for_reusable_axes(
    tmp_path,
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
        / "robots"
        / "so100_follower"
    )
    calibration_dir.mkdir(parents=True)
    (calibration_dir / "shared_arm.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1, "drive_mode": 0, "homing_offset": 612, "range_min": 700, "range_max": 3300},
          "shoulder_lift": {"id": 2, "drive_mode": 0, "homing_offset": 144, "range_min": 800, "range_max": 3200}
        }
        """,
        encoding="utf-8",
    )

    class Calibration:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    calibration = _load_lerobot_axis_calibration(
        (1, 2),
        motor_names=("leader_axis_1", "leader_axis_2"),
        motor_calibration_cls=Calibration,
        calibration_ref=_LeaderCalibrationRef(
            category="robots",
            profile_id="so100_follower",
            calibration_id="shared_arm",
            group_id="all",
        ),
    )

    assert calibration is not None
    assert calibration["leader_axis_1"].homing_offset == 612
    assert calibration["leader_axis_2"].range_max == 3200


def test_does_not_load_lerobot_calibration_without_explicit_ref(
    tmp_path,
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
    (calibration_dir / "my_leader.json").write_text(
        """
        {
          "shoulder_pan": {"id": 1, "homing_offset": 515},
          "shoulder_lift": {"id": 2, "homing_offset": 137}
        }
        """,
        encoding="utf-8",
    )

    class Calibration:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    assert (
        _load_lerobot_axis_calibration(
            (1, 2),
            motor_names=("leader_axis_1", "leader_axis_2"),
            motor_calibration_cls=Calibration,
        )
        is None
    )


class _TimedLeaderReader:
    """Fake reader that records when its blocking read overlaps another."""

    def __init__(self, started: "threading.Event", hold: "threading.Event") -> None:
        self._started = started
        self._hold = hold
        self.disconnected = False

    def read(self) -> dict[str, float]:
        self._started.set()
        # Block until released so the test can observe whether a second read on
        # a different port proceeds concurrently (parallel) or waits (serial).
        self._hold.wait(
            timeout=_LEADER_READ_CONCURRENCY_TIMING.reader_hold_timeout_sec
        )
        return {}

    def disconnect(self) -> None:
        self.disconnected = True


def test_reads_on_different_ports_run_in_parallel() -> None:
    # Seed leases with a fresh timestamp so the idle reaper does not drop them.
    fresh = monotonic()
    service = OpenArmLeaderStateService(
        idle_timeout_sec=_LEADER_READ_CONCURRENCY_TIMING.idle_timeout_sec
    )
    a_started, a_hold = threading.Event(), threading.Event()
    b_started, b_hold = threading.Event(), threading.Event()
    service._readers[("/dev/ttyACM0", None, None, None)] = _LeaderReaderLease(
        _TimedLeaderReader(a_started, a_hold), fresh
    )
    service._readers[("/dev/ttyACM1", None, None, None)] = _LeaderReaderLease(
        _TimedLeaderReader(b_started, b_hold), fresh
    )

    t_a = threading.Thread(target=lambda: service.read_state(port="/dev/ttyACM0"))
    t_b = threading.Thread(target=lambda: service.read_state(port="/dev/ttyACM1"))
    t_a.start()
    t_b.start()
    try:
        # Both reads must enter their blocking section concurrently. If the
        # service serialized them (old global lock / service lock around I/O),
        # the second read would never start until the first is released.
        assert a_started.wait(
            timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec
        )
        assert b_started.wait(
            timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec
        )
    finally:
        a_hold.set()
        b_hold.set()
        t_a.join(timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec)
        t_b.join(timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec)


def test_reads_on_same_port_are_serialized() -> None:
    fresh = monotonic()
    service = OpenArmLeaderStateService(
        idle_timeout_sec=_LEADER_READ_CONCURRENCY_TIMING.idle_timeout_sec
    )
    first_started, first_hold = threading.Event(), threading.Event()
    second_started, second_hold = threading.Event(), threading.Event()

    # Distinct reader keys but the same serial port, so both calls contend for
    # one per-port lock and must not run their I/O concurrently.
    service._readers[("/dev/ttyACM0", (1,), None, None)] = _LeaderReaderLease(
        _TimedLeaderReader(first_started, first_hold), fresh
    )
    service._readers[("/dev/ttyACM0", (2,), None, None)] = _LeaderReaderLease(
        _TimedLeaderReader(second_started, second_hold), fresh
    )

    t_first = threading.Thread(
        target=lambda: service.read_state(port="/dev/ttyACM0", motor_ids=[1])
    )
    t_second = threading.Thread(
        target=lambda: service.read_state(port="/dev/ttyACM0", motor_ids=[2])
    )
    t_first.start()
    try:
        assert first_started.wait(
            timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec
        )
        t_second.start()
        # The first read still holds this port's lock, so the second read must
        # be blocked from starting until the first releases.
        assert not second_started.wait(
            timeout=_LEADER_READ_CONCURRENCY_TIMING.serialization_probe_timeout_sec
        )
    finally:
        first_hold.set()
        second_hold.set()
        t_first.join(timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec)
        t_second.join(timeout=_LEADER_READ_CONCURRENCY_TIMING.start_wait_timeout_sec)
    assert second_started.is_set()
