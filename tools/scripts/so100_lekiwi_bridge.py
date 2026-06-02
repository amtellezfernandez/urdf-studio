#!/usr/bin/env python3
"""Bridge an SO100 leader to a LeKiwi action stream.

The stock LeRobot teleoperate loop does not rename SO100 leader joints to
LeKiwi arm joints or add base velocity fields. This script keeps that adapter
small and explicit for hardware/debug sessions.
"""

from __future__ import annotations

import argparse
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

from lerobot.robots.lekiwi import LeKiwi, LeKiwiClient, LeKiwiClientConfig, LeKiwiConfig
from lerobot.teleoperators.so_leader import SO100Leader, SO100LeaderConfig


DEFAULT_LEADER_ID = "my_awesome_leader_arm"
DEFAULT_LEADER_CALIBRATION_DIR = (
    Path.home() / ".cache/huggingface/lerobot/calibration/teleoperators/so100_leader"
)
DEFAULT_FPS = 10.0
DEFAULT_DURATION_S = 30.0
DEFAULT_SIM_HTTP_PORT = 8765
SIM_HTTP_BIND_HOST = "127.0.0.1"
SIM_CANVAS_WIDTH = 900
SIM_CANVAS_HEIGHT = 560
SIM_ARM_BASE_X = 450
SIM_ARM_BASE_Y = 300
SIM_ARM_SEGMENT_LENGTHS = [94, 86, 74, 58, 42]
SIM_JOINT_ANGLE_SCALE_RAD = math.pi * 0.75
SIM_GRIPPER_MAX_OPEN_PX = 30
SIM_POLL_INTERVAL_MS = 50
SIM_HTTP_OK = 200
SIM_HTTP_NOT_FOUND = 404
SIM_HTTP_SHUTDOWN_TIMEOUT_S = 1.0

LEKIWI_KEY_BY_SO100_KEY = {
    "shoulder_pan.pos": "arm_shoulder_pan.pos",
    "shoulder_lift.pos": "arm_shoulder_lift.pos",
    "elbow_flex.pos": "arm_elbow_flex.pos",
    "wrist_flex.pos": "arm_wrist_flex.pos",
    "wrist_roll.pos": "arm_wrist_roll.pos",
    "gripper.pos": "arm_gripper.pos",
}

ZERO_BASE_ACTION = {
    "x.vel": 0.0,
    "y.vel": 0.0,
    "theta.vel": 0.0,
}


class LeKiwiActionTarget(Protocol):
    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        ...

    def disconnect(self) -> None:
        ...


class DryRunTarget:
    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        print(json.dumps(action, sort_keys=True), flush=True)
        return action

    def disconnect(self) -> None:
        return None


class SimulationHttpTarget:
    def __init__(self, port: int):
        self._lock = threading.Lock()
        self._state: dict[str, float] = {
            **dict.fromkeys(LEKIWI_KEY_BY_SO100_KEY.values(), 0.0),
            **ZERO_BASE_ACTION,
        }
        self._server = ThreadingHTTPServer(
            (SIM_HTTP_BIND_HOST, port),
            self._make_handler(),
        )
        self.url = f"http://{SIM_HTTP_BIND_HOST}:{port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        print(f"SO100 LeKiwi simulation: {self.url}", flush=True)

    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        with self._lock:
            self._state = dict(action)
        return action

    def disconnect(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=SIM_HTTP_SHUTDOWN_TIMEOUT_S)
        self._server.server_close()

    def _make_handler(self):
        target = self

        class SimulationRequestHandler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:
                return None

            def do_GET(self) -> None:
                if self.path in {"/", "/index.html"}:
                    self._send_html(SIMULATION_HTML)
                    return
                if self.path == "/state":
                    with target._lock:
                        payload = json.dumps(target._state, sort_keys=True).encode("utf-8")
                    self._send_bytes(payload, "application/json")
                    return
                self.send_response(SIM_HTTP_NOT_FOUND)
                self.end_headers()

            def _send_html(self, html: str) -> None:
                self._send_bytes(html.encode("utf-8"), "text/html; charset=utf-8")

            def _send_bytes(self, payload: bytes, content_type: str) -> None:
                self.send_response(SIM_HTTP_OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)

        return SimulationRequestHandler


SIMULATION_HTML = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SO100 LeKiwi Simulation</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f7fb;
      color: #161b22;
    }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }}
    header, footer {{
      padding: 14px 18px;
      background: #ffffff;
      border-bottom: 1px solid #d8dee9;
    }}
    footer {{
      border-top: 1px solid #d8dee9;
      border-bottom: 0;
      font-size: 13px;
      color: #4b5563;
    }}
    h1 {{
      margin: 0;
      font-size: 18px;
      font-weight: 650;
    }}
    main {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 16px;
      padding: 16px;
      min-height: 0;
    }}
    canvas {{
      width: 100%;
      height: 100%;
      min-height: 420px;
      background: #ffffff;
      border: 1px solid #c9d1d9;
      border-radius: 8px;
    }}
    aside {{
      background: #ffffff;
      border: 1px solid #c9d1d9;
      border-radius: 8px;
      padding: 14px;
      overflow: auto;
    }}
    .row {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid #eef2f7;
      font-size: 13px;
    }}
    .row:last-child {{
      border-bottom: 0;
    }}
    .key {{
      color: #374151;
      overflow-wrap: anywhere;
    }}
    .value {{
      font-variant-numeric: tabular-nums;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }}
    @media (max-width: 800px) {{
      main {{
        grid-template-columns: 1fr;
      }}
      canvas {{
        min-height: 360px;
      }}
    }}
  </style>
</head>
<body>
  <header><h1>SO100 LeKiwi Simulation</h1></header>
  <main>
    <canvas id="view" width="{SIM_CANVAS_WIDTH}" height="{SIM_CANVAS_HEIGHT}"></canvas>
    <aside id="values"></aside>
  </main>
  <footer>Move the SO100 leader. The arm pose updates from the same mapped LeKiwi action dictionary sent by the bridge.</footer>
  <script>
    const pollIntervalMs = {SIM_POLL_INTERVAL_MS};
    const baseX = {SIM_ARM_BASE_X};
    const baseY = {SIM_ARM_BASE_Y};
    const lengths = {json.dumps(SIM_ARM_SEGMENT_LENGTHS)};
    const angleScale = {SIM_JOINT_ANGLE_SCALE_RAD};
    const gripperMaxOpenPx = {SIM_GRIPPER_MAX_OPEN_PX};
    const jointKeys = [
      "arm_shoulder_pan.pos",
      "arm_shoulder_lift.pos",
      "arm_elbow_flex.pos",
      "arm_wrist_flex.pos",
      "arm_wrist_roll.pos",
    ];
    const displayKeys = [
      ...jointKeys,
      "arm_gripper.pos",
      "x.vel",
      "y.vel",
      "theta.vel",
    ];
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

      const tip = points[points.length - 1];
      const gripper = Math.max(0, Math.min(100, Number(state["arm_gripper.pos"]) || 0));
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
      ctx.lineWidth = 1;
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--leader-port", required=True, help="SO100 leader serial port.")
    parser.add_argument("--leader-id", default=DEFAULT_LEADER_ID)
    parser.add_argument(
        "--leader-calibration-dir",
        type=Path,
        default=DEFAULT_LEADER_CALIBRATION_DIR,
        help="Directory containing the SO100 leader calibration JSON.",
    )
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS)
    parser.add_argument("--duration-s", type=float, default=DEFAULT_DURATION_S)
    parser.add_argument("--base-x", type=float, default=ZERO_BASE_ACTION["x.vel"])
    parser.add_argument("--base-y", type=float, default=ZERO_BASE_ACTION["y.vel"])
    parser.add_argument("--base-theta", type=float, default=ZERO_BASE_ACTION["theta.vel"])

    target = parser.add_mutually_exclusive_group()
    target.add_argument("--dry-run", action="store_true", help="Print mapped LeKiwi actions only.")
    target.add_argument("--lekiwi-port", help="Direct serial LeKiwi follower port.")
    target.add_argument("--remote-ip", help="Remote LeKiwi host IP for lekiwi_client mode.")
    target.add_argument(
        "--sim-http-port",
        type=int,
        help="Serve a browser simulation target on localhost at this port.",
    )

    return parser.parse_args()


def connect_so100_leader(args: argparse.Namespace) -> SO100Leader:
    config = SO100LeaderConfig(
        id=args.leader_id,
        port=args.leader_port,
        calibration_dir=args.leader_calibration_dir,
        use_degrees=False,
    )
    leader = SO100Leader(config)
    if not leader.calibration:
        raise FileNotFoundError(
            f"Missing SO100 leader calibration: {leader.calibration_fpath}. "
            "Run LeRobot calibration first or pass --leader-calibration-dir."
        )

    leader.bus.connect()
    leader.bus.write_calibration(leader.calibration)
    leader.configure()
    return leader


def connect_target(args: argparse.Namespace) -> LeKiwiActionTarget:
    if args.lekiwi_port:
        robot = LeKiwi(
            LeKiwiConfig(
                id="so100_lekiwi_bridge",
                port=args.lekiwi_port,
                cameras={},
                use_degrees=False,
                max_relative_target=10.0,
            )
        )
        robot.connect()
        return robot

    if args.remote_ip:
        robot = LeKiwiClient(LeKiwiClientConfig(id="so100_lekiwi_bridge", remote_ip=args.remote_ip, cameras={}))
        robot.connect()
        return robot

    if args.sim_http_port:
        return SimulationHttpTarget(args.sim_http_port)

    return DryRunTarget()


def map_so100_to_lekiwi(action: dict[str, float], args: argparse.Namespace) -> dict[str, float]:
    mapped = {lekiwi_key: action[so100_key] for so100_key, lekiwi_key in LEKIWI_KEY_BY_SO100_KEY.items()}
    mapped.update(
        {
            "x.vel": args.base_x,
            "y.vel": args.base_y,
            "theta.vel": args.base_theta,
        }
    )
    return mapped


def main() -> None:
    args = parse_args()
    if args.fps <= 0:
        raise ValueError("--fps must be positive")
    if args.duration_s <= 0:
        raise ValueError("--duration-s must be positive")

    leader = connect_so100_leader(args)
    target = connect_target(args)
    period_s = 1.0 / args.fps
    start = time.perf_counter()

    try:
        while time.perf_counter() - start < args.duration_s:
            loop_start = time.perf_counter()
            so100_action = leader.get_action()
            lekiwi_action = map_so100_to_lekiwi(so100_action, args)
            target.send_action(lekiwi_action)
            elapsed_s = time.perf_counter() - loop_start
            time.sleep(max(period_s - elapsed_s, 0.0))
    finally:
        target.disconnect()
        leader.disconnect()


if __name__ == "__main__":
    main()
