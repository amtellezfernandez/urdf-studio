#!/usr/bin/env python3
"""Identify SO100 physical joints from raw Feetech encoder movement.

This tool deliberately reads raw servo ticks. It does not use LeRobot
normalization, does not command motion, and does not write calibration values to
motors.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Mapping, Sequence


SO100_JOINT_ORDER: tuple[str, ...] = (
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
)
DEFAULT_MOTOR_MODEL = "sts3215"
DEFAULT_BAUDRATE = 1_000_000
DEFAULT_MIN_DELTA_TICKS = 32
DEFAULT_AMBIGUITY_RATIO = 1.5
DEFAULT_CALIBRATION_ID = "my_awesome_follower_arm"
DEFAULT_LEROBOT_CALIBRATION_DIR = (
    Path.home() / ".cache/huggingface/lerobot/calibration/robots/so100_follower"
)
DEFAULT_ENV_PORT_KEY = "URDF_ROBOT_GATEWAY_LEROBOT_PORT"
DEFAULT_RAW_MAP_SUFFIX = ".raw_motor_map.json"
TTY_GLOBS: tuple[str, ...] = (
    "/dev/serial/by-id/*",
    "/dev/ttyUSB*",
    "/dev/ttyACM*",
)
RAW_FULL_RANGE_MIN = 0


@dataclass(frozen=True)
class ChangedMotorMatch:
    motor_id: int
    deltas_by_id: dict[int, int]


@dataclass(frozen=True)
class ChangedMotorAmbiguous:
    reason: str
    deltas_by_id: dict[int, int]


def infer_changed_motor(
    before_positions: Mapping[int, int],
    after_positions: Mapping[int, int],
    *,
    assigned_motor_ids: set[int] | None = None,
    min_delta_ticks: int = DEFAULT_MIN_DELTA_TICKS,
    ambiguity_ratio: float = DEFAULT_AMBIGUITY_RATIO,
) -> ChangedMotorMatch | ChangedMotorAmbiguous:
    assigned_motor_ids = assigned_motor_ids or set()
    deltas_by_id = {
        motor_id: abs(after_positions[motor_id] - before_position)
        for motor_id, before_position in before_positions.items()
        if motor_id in after_positions
    }
    unassigned_deltas = {
        motor_id: delta
        for motor_id, delta in deltas_by_id.items()
        if motor_id not in assigned_motor_ids
    }
    ranked_deltas = sorted(
        unassigned_deltas.items(),
        key=lambda entry: entry[1],
        reverse=True,
    )
    if not ranked_deltas:
        return ChangedMotorAmbiguous(
            reason="No unassigned motor positions were available.",
            deltas_by_id=deltas_by_id,
        )

    top_motor_id, top_delta = ranked_deltas[0]
    if top_delta < min_delta_ticks:
        return ChangedMotorAmbiguous(
            reason=(
                f"Largest movement was {top_delta} ticks, below the "
                f"{min_delta_ticks}-tick threshold."
            ),
            deltas_by_id=deltas_by_id,
        )

    if len(ranked_deltas) > 1:
        _, second_delta = ranked_deltas[1]
        if second_delta > 0 and top_delta < second_delta * ambiguity_ratio:
            return ChangedMotorAmbiguous(
                reason=(
                    "More than one unassigned motor moved enough to be ambiguous."
                ),
                deltas_by_id=deltas_by_id,
            )

    return ChangedMotorMatch(motor_id=top_motor_id, deltas_by_id=deltas_by_id)


def build_raw_motor_map_payload(
    joint_to_motor_id: Mapping[str, int],
    *,
    port: str,
    baudrate: int,
    motor_model: str,
) -> dict[str, object]:
    return {
        "format": "urdf-studio.so100.raw-motor-map.v1",
        "port": port,
        "baudrate": baudrate,
        "motor_model": motor_model,
        "joint_to_motor_id": {
            joint_name: joint_to_motor_id[joint_name]
            for joint_name in SO100_JOINT_ORDER
            if joint_name in joint_to_motor_id
        },
        "notes": [
            "Raw motor ID map only.",
            "This is not an angle calibration and does not define homing offsets.",
            "Do not treat this file as proof that normalized joint angles are correct.",
        ],
    }


def build_lerobot_id_map_calibration_payload(
    joint_to_motor_id: Mapping[str, int],
    *,
    raw_range_max: int,
) -> dict[str, dict[str, int]]:
    return {
        joint_name: {
            "id": joint_to_motor_id[joint_name],
            "drive_mode": 0,
            "homing_offset": 0,
            "range_min": RAW_FULL_RANGE_MIN,
            "range_max": raw_range_max,
        }
        for joint_name in SO100_JOINT_ORDER
    }


def resolve_default_port() -> str:
    env_port = os.environ.get(DEFAULT_ENV_PORT_KEY, "").strip()
    if env_port:
        return env_port
    for tty_glob in TTY_GLOBS:
        matches = sorted(Path(path) for path in Path("/").glob(tty_glob.lstrip("/")))
        if matches:
            return str(matches[0])
    return ""


def load_feetech_bus_classes():
    try:
        from lerobot.motors import Motor, MotorNormMode
        from lerobot.motors.feetech import FeetechMotorsBus
    except ImportError as exc:
        raise RuntimeError(
            "LeRobot is not importable. Run this with .venv-lerobot/bin/python3."
        ) from exc
    return FeetechMotorsBus, Motor, MotorNormMode


def scan_motor_ids(port: str, baudrate: int) -> dict[int, int]:
    FeetechMotorsBus, _, _ = load_feetech_bus_classes()
    bus = FeetechMotorsBus(port, {})
    try:
        bus._connect(handshake=False)
        bus.set_baudrate(baudrate)
        ids_to_models = bus.broadcast_ping(num_retry=2, raise_on_error=True)
        return dict(ids_to_models or {})
    finally:
        try:
            bus.port_handler.closePort()
        except Exception:
            pass


def build_raw_read_bus(
    *,
    port: str,
    baudrate: int,
    motor_ids: Sequence[int],
    motor_model: str,
):
    FeetechMotorsBus, Motor, MotorNormMode = load_feetech_bus_classes()
    motors = {
        motor_name_for_id(motor_id): Motor(motor_id, motor_model, MotorNormMode.DEGREES)
        for motor_id in motor_ids
    }
    bus = FeetechMotorsBus(port, motors)
    bus.connect(handshake=False)
    bus.set_baudrate(baudrate)
    return bus


def motor_name_for_id(motor_id: int) -> str:
    return f"motor_{motor_id}"


def read_raw_positions(bus) -> dict[int, int]:
    positions_by_name = bus.sync_read(
        "Present_Position",
        normalize=False,
        num_retry=2,
    )
    return {
        bus.motors[motor_name].id: int(position)
        for motor_name, position in positions_by_name.items()
    }


def print_delta_table(deltas_by_id: Mapping[int, int]) -> None:
    print("Observed raw encoder movement:")
    for motor_id, delta in sorted(
        deltas_by_id.items(),
        key=lambda entry: entry[1],
        reverse=True,
    ):
        print(f"  id {motor_id}: {delta} ticks")


def choose_motor_id_interactively(
    *,
    joint_name: str,
    before_positions: Mapping[int, int],
    after_positions: Mapping[int, int],
    assigned_motor_ids: set[int],
    min_delta_ticks: int,
    ambiguity_ratio: float,
) -> int | None:
    result = infer_changed_motor(
        before_positions,
        after_positions,
        assigned_motor_ids=assigned_motor_ids,
        min_delta_ticks=min_delta_ticks,
        ambiguity_ratio=ambiguity_ratio,
    )
    print_delta_table(result.deltas_by_id)
    if isinstance(result, ChangedMotorMatch):
        answer = input(
            f"Use motor id {result.motor_id} for {joint_name}? "
            "Press ENTER to accept, type another id, or type r to retry: "
        ).strip()
        if not answer:
            return result.motor_id
    else:
        print(f"Could not identify {joint_name}: {result.reason}")
        answer = input("Type a motor id manually, or type r to retry: ").strip()

    if answer.lower() == "r":
        return None
    try:
        motor_id = int(answer)
    except ValueError:
        print("Invalid motor id; retrying this joint.")
        return None
    if motor_id in assigned_motor_ids:
        print(f"Motor id {motor_id} is already assigned; retrying this joint.")
        return None
    if motor_id not in before_positions:
        print(f"Motor id {motor_id} was not found on the bus; retrying this joint.")
        return None
    return motor_id


def identify_joint_motor_ids(
    bus,
    *,
    min_delta_ticks: int,
    ambiguity_ratio: float,
) -> dict[str, int]:
    joint_to_motor_id: dict[str, int] = {}
    assigned_motor_ids: set[int] = set()
    try:
        bus.disable_torque(num_retry=2)
    except Exception as exc:
        raise RuntimeError(
            "Failed to disable torque. Stop here; raw identification requires a limp arm."
        ) from exc

    print("\nTorque is disabled. Move joints only by hand.")
    for joint_name in SO100_JOINT_ORDER:
        while joint_name not in joint_to_motor_id:
            input(
                f"\nLeave the arm still, then press ENTER to capture baseline for {joint_name}: "
            )
            before_positions = read_raw_positions(bus)
            input(
                f"Move only {joint_name} by hand, then press ENTER to identify its motor: "
            )
            after_positions = read_raw_positions(bus)
            motor_id = choose_motor_id_interactively(
                joint_name=joint_name,
                before_positions=before_positions,
                after_positions=after_positions,
                assigned_motor_ids=assigned_motor_ids,
                min_delta_ticks=min_delta_ticks,
                ambiguity_ratio=ambiguity_ratio,
            )
            if motor_id is None:
                continue
            joint_to_motor_id[joint_name] = motor_id
            assigned_motor_ids.add(motor_id)
            print(f"Assigned {joint_name} -> motor id {motor_id}")
    return joint_to_motor_id


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")


def backup_existing_file(path: Path) -> Path | None:
    if not path.exists():
        return None
    backup_path = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup_path)
    return backup_path


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Identify SO100 motor IDs from raw Feetech encoder movement without "
            "using LeRobot angle calibration."
        )
    )
    parser.add_argument("--port", default=resolve_default_port(), help="Feetech serial port.")
    parser.add_argument("--baudrate", type=int, default=DEFAULT_BAUDRATE)
    parser.add_argument("--motor-model", default=DEFAULT_MOTOR_MODEL)
    parser.add_argument("--calibration-id", default=DEFAULT_CALIBRATION_ID)
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=DEFAULT_LEROBOT_CALIBRATION_DIR,
    )
    parser.add_argument(
        "--raw-map-output",
        type=Path,
        default=None,
        help="Where to write the raw motor map JSON.",
    )
    parser.add_argument(
        "--write-lerobot-id-map",
        action="store_true",
        help=(
            "Also write a LeRobot-compatible JSON with only IDs and full raw ranges. "
            "This is not angle calibration."
        ),
    )
    parser.add_argument("--min-delta-ticks", type=int, default=DEFAULT_MIN_DELTA_TICKS)
    parser.add_argument(
        "--ambiguity-ratio",
        type=float,
        default=DEFAULT_AMBIGUITY_RATIO,
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not args.port:
        print(
            "No serial port found. Pass --port or set URDF_ROBOT_GATEWAY_LEROBOT_PORT.",
            file=sys.stderr,
        )
        return 2

    ids_to_models = scan_motor_ids(args.port, args.baudrate)
    motor_ids = sorted(ids_to_models)
    print(f"Found motor IDs on {args.port}: {motor_ids}")
    if len(motor_ids) != len(SO100_JOINT_ORDER):
        print(
            f"Expected {len(SO100_JOINT_ORDER)} SO100 motors but found {len(motor_ids)}. "
            "Check power and cabling before continuing.",
            file=sys.stderr,
        )
        return 2

    bus = build_raw_read_bus(
        port=args.port,
        baudrate=args.baudrate,
        motor_ids=motor_ids,
        motor_model=args.motor_model,
    )
    try:
        raw_range_max = bus.model_resolution_table[args.motor_model] - 1
        joint_to_motor_id = identify_joint_motor_ids(
            bus,
            min_delta_ticks=args.min_delta_ticks,
            ambiguity_ratio=args.ambiguity_ratio,
        )
    finally:
        try:
            bus.disconnect(disable_torque=True)
        except Exception:
            try:
                bus.port_handler.closePort()
            except Exception:
                pass

    raw_map_output = args.raw_map_output or (
        args.calibration_dir / f"{args.calibration_id}{DEFAULT_RAW_MAP_SUFFIX}"
    )
    raw_payload = build_raw_motor_map_payload(
        joint_to_motor_id,
        port=args.port,
        baudrate=args.baudrate,
        motor_model=args.motor_model,
    )
    write_json(raw_map_output, raw_payload)
    print(f"\nWrote raw motor map: {raw_map_output}")

    if args.write_lerobot_id_map:
        calibration_path = args.calibration_dir / f"{args.calibration_id}.json"
        backup_path = backup_existing_file(calibration_path)
        calibration_payload = build_lerobot_id_map_calibration_payload(
            joint_to_motor_id,
            raw_range_max=raw_range_max,
        )
        write_json(calibration_path, calibration_payload)
        if backup_path is not None:
            print(f"Backed up previous LeRobot calibration: {backup_path}")
        print(f"Wrote LeRobot ID-map-only calibration: {calibration_path}")
        print("This file uses full raw ranges and zero homing offsets.")

    print("\nIdentified mapping:")
    for joint_name in SO100_JOINT_ORDER:
        print(f"  {joint_name}: motor id {joint_to_motor_id[joint_name]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
