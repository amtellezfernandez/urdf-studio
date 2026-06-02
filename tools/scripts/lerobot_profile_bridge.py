#!/usr/bin/env python3
"""Profile-driven bridge from a LeRobot teleop source to a target action schema."""

from __future__ import annotations

import argparse
import json
import math
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

from lerobot.teleoperators.so_leader import SO100Leader, SO100LeaderConfig


DEFAULT_SOURCE_PROFILE = "so100_leader"
DEFAULT_TARGET_PROFILE = "lekiwi"
DEFAULT_SOURCE_ID = "my_awesome_leader_arm"
DEFAULT_SOURCE_PORT = "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00"
DEFAULT_FPS = 20.0
DEFAULT_DURATION_S = 600.0
DEFAULT_SIM_HTTP_PORT = 8765
DEFAULT_SO100_CALIBRATION_DIR = (
    Path.home() / ".cache/huggingface/lerobot/calibration/teleoperators/so100_leader"
)

HTTP_BIND_HOST = "127.0.0.1"
HTTP_OK = 200
HTTP_NOT_FOUND = 404
HTTP_SHUTDOWN_TIMEOUT_S = 1.0
SIM_CANVAS_WIDTH = 900
SIM_CANVAS_HEIGHT = 560
SIM_ARM_BASE_X = 450
SIM_ARM_BASE_Y = 300
SIM_ARM_SEGMENT_LENGTHS = [94, 86, 74, 58, 42]
SIM_JOINT_ANGLE_SCALE_RAD = math.pi * 0.75
SIM_GRIPPER_MAX_OPEN_PX = 30
SIM_POLL_INTERVAL_MS = 50


@dataclass(frozen=True)
class SourceProfile:
    profile_id: str
    default_calibration_dir: Path
    use_degrees: bool


@dataclass(frozen=True)
class TargetProfile:
    profile_id: str
    label: str
    action_key_by_source_key: dict[str, str]
    default_action: dict[str, float]
    sim_joint_keys: tuple[str, ...]
    sim_gripper_key: str | None


class TeleopSource(Protocol):
    def get_action(self) -> dict[str, float]:
        ...

    def disconnect(self) -> None:
        ...


class ActionTarget(Protocol):
    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        ...

    def disconnect(self) -> None:
        ...


SOURCE_PROFILES = {
    "so100_leader": SourceProfile(
        profile_id="so100_leader",
        default_calibration_dir=DEFAULT_SO100_CALIBRATION_DIR,
        use_degrees=False,
    ),
}

TARGET_PROFILES = {
    "lekiwi": TargetProfile(
        profile_id="lekiwi",
        label="LeKiwi",
        action_key_by_source_key={
            "shoulder_pan.pos": "arm_shoulder_pan.pos",
            "shoulder_lift.pos": "arm_shoulder_lift.pos",
            "elbow_flex.pos": "arm_elbow_flex.pos",
            "wrist_flex.pos": "arm_wrist_flex.pos",
            "wrist_roll.pos": "arm_wrist_roll.pos",
            "gripper.pos": "arm_gripper.pos",
        },
        default_action={
            "x.vel": 0.0,
            "y.vel": 0.0,
            "theta.vel": 0.0,
        },
        sim_joint_keys=(
            "arm_shoulder_pan.pos",
            "arm_shoulder_lift.pos",
            "arm_elbow_flex.pos",
            "arm_wrist_flex.pos",
            "arm_wrist_roll.pos",
        ),
        sim_gripper_key="arm_gripper.pos",
    ),
}


class DryRunTarget:
    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        print(json.dumps(action, sort_keys=True), flush=True)
        return action

    def disconnect(self) -> None:
        return None


class SimulationHttpTarget:
    def __init__(self, *, port: int, target_profile: TargetProfile):
        self._target_profile = target_profile
        self._lock = threading.Lock()
        self._state: dict[str, float] = self._initial_state()
        self._server = ThreadingHTTPServer((HTTP_BIND_HOST, port), self._make_handler())
        self.url = f"http://{HTTP_BIND_HOST}:{port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        print(f"{target_profile.label} simulation: {self.url}", flush=True)

    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        with self._lock:
            self._state = {**self._initial_state(), **action}
        return action

    def disconnect(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=HTTP_SHUTDOWN_TIMEOUT_S)
        self._server.server_close()

    def _initial_state(self) -> dict[str, float]:
        target_keys = set(self._target_profile.action_key_by_source_key.values())
        return {
            **dict.fromkeys(target_keys, 0.0),
            **self._target_profile.default_action,
        }

    def _make_handler(self):
        target = self

        class SimulationRequestHandler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:
                return None

            def do_GET(self) -> None:
                if self.path in {"/", "/index.html"}:
                    self._send_bytes(target._html().encode("utf-8"), "text/html; charset=utf-8")
                    return
                if self.path == "/state":
                    with target._lock:
                        payload = json.dumps(target._state, sort_keys=True).encode("utf-8")
                    self._send_bytes(payload, "application/json")
                    return
                self.send_response(HTTP_NOT_FOUND)
                self.end_headers()

            def _send_bytes(self, payload: bytes, content_type: str) -> None:
                self.send_response(HTTP_OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)

        return SimulationRequestHandler

    def _html(self) -> str:
        display_keys = [
            *self._target_profile.sim_joint_keys,
            *(
                [self._target_profile.sim_gripper_key]
                if self._target_profile.sim_gripper_key is not None
                else []
            ),
            *self._target_profile.default_action.keys(),
        ]
        return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{self._target_profile.label} Simulation</title>
  <style>
    :root {{ font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #161b22; }}
    body {{ margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }}
    header, footer {{ padding: 14px 18px; background: #ffffff; border-bottom: 1px solid #d8dee9; }}
    footer {{ border-top: 1px solid #d8dee9; border-bottom: 0; font-size: 13px; color: #4b5563; }}
    h1 {{ margin: 0; font-size: 18px; font-weight: 650; }}
    main {{ display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; padding: 16px; min-height: 0; }}
    canvas {{ width: 100%; height: 100%; min-height: 420px; background: #ffffff; border: 1px solid #c9d1d9; border-radius: 8px; }}
    aside {{ background: #ffffff; border: 1px solid #c9d1d9; border-radius: 8px; padding: 14px; overflow: auto; }}
    .row {{ display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 7px 0; border-bottom: 1px solid #eef2f7; font-size: 13px; }}
    .row:last-child {{ border-bottom: 0; }}
    .key {{ color: #374151; overflow-wrap: anywhere; }}
    .value {{ font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
    @media (max-width: 800px) {{ main {{ grid-template-columns: 1fr; }} canvas {{ min-height: 360px; }} }}
  </style>
</head>
<body>
  <header><h1>{self._target_profile.label} Simulation</h1></header>
  <main>
    <canvas id="view" width="{SIM_CANVAS_WIDTH}" height="{SIM_CANVAS_HEIGHT}"></canvas>
    <aside id="values"></aside>
  </main>
  <footer>Move the teleop source. The simulated pose updates from the mapped target action dictionary.</footer>
  <script>
    const pollIntervalMs = {SIM_POLL_INTERVAL_MS};
    const baseX = {SIM_ARM_BASE_X};
    const baseY = {SIM_ARM_BASE_Y};
    const lengths = {json.dumps(SIM_ARM_SEGMENT_LENGTHS)};
    const angleScale = {SIM_JOINT_ANGLE_SCALE_RAD};
    const gripperMaxOpenPx = {SIM_GRIPPER_MAX_OPEN_PX};
    const jointKeys = {json.dumps(list(self._target_profile.sim_joint_keys))};
    const gripperKey = {json.dumps(self._target_profile.sim_gripper_key)};
    const displayKeys = {json.dumps(display_keys)};
    const canvas = document.getElementById("view");
    const ctx = canvas.getContext("2d");
    const values = document.getElementById("values");
    let state = {{}};
    const valueToAngle = (value, index) => {{
      const normalized = Math.max(-100, Math.min(100, Number(value) || 0)) / 100;
      const direction = index % 2 === 0 ? 1 : -1;
      return normalized * angleScale * direction;
    }};
    const drawBase = () => {{
      ctx.save();
      ctx.translate(baseX, baseY + 108);
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-112, -52, 224, 104, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111827";
      for (const [x, y] of [[-84, 54], [84, 54], [0, -58]]) {{
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
      }}
      ctx.restore();
    }};
    const drawArm = () => {{
      let x = baseX;
      let y = baseY;
      let theta = -Math.PI / 2;
      const points = [[x, y]];
      jointKeys.forEach((key, index) => {{
        theta += valueToAngle(state[key], index);
        x += Math.cos(theta) * lengths[index];
        y += Math.sin(theta) * lengths[index];
        points.push([x, y]);
      }});
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
      ctx.stroke();
      ctx.fillStyle = "#f59e0b";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 3;
      for (const point of points) {{
        ctx.beginPath();
        ctx.arc(point[0], point[1], 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }}
      if (gripperKey) {{
        const tip = points[points.length - 1];
        const gripper = Math.max(0, Math.min(100, Number(state[gripperKey]) || 0));
        const openPx = 6 + (gripper / 100) * gripperMaxOpenPx;
        ctx.translate(tip[0], tip[1]);
        ctx.rotate(theta);
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, -openPx);
        ctx.lineTo(38, -openPx - 10);
        ctx.moveTo(0, openPx);
        ctx.lineTo(38, openPx + 10);
        ctx.stroke();
      }}
      ctx.restore();
    }};
    const renderValues = () => {{
      values.innerHTML = displayKeys.map((key) => {{
        const raw = Number(state[key] ?? 0);
        return `<div class="row"><span class="key">${{key}}</span><span class="value">${{raw.toFixed(2)}}</span></div>`;
      }}).join("");
    }};
    const render = () => {{
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#e5e7eb";
      for (let x = 0; x < canvas.width; x += 40) {{
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }}
      for (let y = 0; y < canvas.height; y += 40) {{
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }}
      drawBase();
      drawArm();
      renderValues();
    }};
    const poll = async () => {{
      try {{
        const response = await fetch("/state", {{ cache: "no-store" }});
        state = await response.json();
        render();
      }} catch (error) {{
        console.error(error);
      }}
      setTimeout(poll, pollIntervalMs);
    }};
    poll();
  </script>
</body>
</html>
"""


def read_json_object(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return value


def read_float_mapping(path: Path) -> dict[str, float]:
    raw = read_json_object(path)
    result: dict[str, float] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, (int, float)):
            raise ValueError(f"{path} must map string keys to numeric values.")
        result[key] = float(value)
    return result


def read_string_mapping(path: Path) -> dict[str, str]:
    raw = read_json_object(path)
    result: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError(f"{path} must map string keys to string values.")
        result[key] = value
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-profile", default=DEFAULT_SOURCE_PROFILE, choices=sorted(SOURCE_PROFILES))
    parser.add_argument("--target-profile", default=DEFAULT_TARGET_PROFILE, choices=sorted(TARGET_PROFILES))
    parser.add_argument("--source-port", default=DEFAULT_SOURCE_PORT)
    parser.add_argument("--source-id", default=DEFAULT_SOURCE_ID)
    parser.add_argument("--source-calibration-dir", type=Path)
    parser.add_argument("--mapping-json", type=Path, help="Override source-to-target action key mapping.")
    parser.add_argument("--defaults-json", type=Path, help="Override target default action values.")
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS)
    parser.add_argument("--duration-s", type=float, default=DEFAULT_DURATION_S)

    target = parser.add_mutually_exclusive_group()
    target.add_argument("--dry-run", action="store_true")
    target.add_argument("--sim-http-port", type=int, default=DEFAULT_SIM_HTTP_PORT)
    return parser.parse_args()


def resolve_target_profile(args: argparse.Namespace) -> TargetProfile:
    profile = TARGET_PROFILES[args.target_profile]
    mapping = read_string_mapping(args.mapping_json) if args.mapping_json else profile.action_key_by_source_key
    defaults = read_float_mapping(args.defaults_json) if args.defaults_json else profile.default_action
    return TargetProfile(
        profile_id=profile.profile_id,
        label=profile.label,
        action_key_by_source_key=mapping,
        default_action=defaults,
        sim_joint_keys=profile.sim_joint_keys,
        sim_gripper_key=profile.sim_gripper_key,
    )


def connect_source(args: argparse.Namespace) -> TeleopSource:
    profile = SOURCE_PROFILES[args.source_profile]
    if profile.profile_id != "so100_leader":
        raise ValueError(f"Unsupported source profile: {profile.profile_id}")

    calibration_dir = args.source_calibration_dir or profile.default_calibration_dir
    config = SO100LeaderConfig(
        id=args.source_id,
        port=args.source_port,
        calibration_dir=calibration_dir,
        use_degrees=profile.use_degrees,
    )
    source = SO100Leader(config)
    if not source.calibration:
        raise FileNotFoundError(
            f"Missing calibration file: {source.calibration_fpath}. "
            "Pass --source-calibration-dir or calibrate this source first."
        )
    source.bus.connect()
    source.bus.write_calibration(source.calibration)
    source.configure()
    return source


def connect_target(args: argparse.Namespace, target_profile: TargetProfile) -> ActionTarget:
    if args.dry_run:
        return DryRunTarget()
    return SimulationHttpTarget(port=args.sim_http_port, target_profile=target_profile)


def map_action(
    source_action: dict[str, float],
    target_profile: TargetProfile,
) -> dict[str, float]:
    missing = sorted(set(target_profile.action_key_by_source_key) - set(source_action))
    if missing:
        raise KeyError(f"Source action missing expected keys: {missing}")
    mapped = {
        target_key: source_action[source_key]
        for source_key, target_key in target_profile.action_key_by_source_key.items()
    }
    return {**target_profile.default_action, **mapped}


def main() -> None:
    args = parse_args()
    if args.fps <= 0:
        raise ValueError("--fps must be positive")
    if args.duration_s <= 0:
        raise ValueError("--duration-s must be positive")

    target_profile = resolve_target_profile(args)
    source = connect_source(args)
    target = connect_target(args, target_profile)
    period_s = 1.0 / args.fps
    start = time.perf_counter()

    try:
        while time.perf_counter() - start < args.duration_s:
            loop_start = time.perf_counter()
            target.send_action(map_action(source.get_action(), target_profile))
            elapsed_s = time.perf_counter() - loop_start
            time.sleep(max(period_s - elapsed_s, 0.0))
    finally:
        target.disconnect()
        source.disconnect()


if __name__ == "__main__":
    main()
