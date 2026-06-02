from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def _read_current_map_objects(current_map_path: Path) -> list[str]:
    if not current_map_path.exists():
        return []
    objects: list[str] = []
    for raw_line in current_map_path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("- "):
            objects.append(stripped[2:])
    return objects


def _run_planner_mode(*, control_dir: Path, text: str) -> dict[str, object]:
    from sim.action_runtime import build_runtime
    from sim.chat_loop import DEFAULT_MAX_TURNS, _execute_typed_actions, _plan_action, run_request
    from sim.env import load_dotenv

    load_dotenv()
    messages: list[str] = []
    runtime = build_runtime(control_dir)

    run_request(
        user_text=text,
        show_sim=False,
        max_turns=DEFAULT_MAX_TURNS,
        planner=_plan_action,
        action_executor=lambda actions, policy=None: _execute_typed_actions(
            actions,
            policy=policy,
            runtime=runtime,
        ),
        emit=messages.append,
    )

    return {
        "accepted": True,
        "messages": messages,
        "raw_text": "\n".join(message for message in messages if message.strip()),
    }


def _run_direct_mode(*, control_dir: Path, command_json: str, timeout_s: float) -> dict[str, object]:
    raise RuntimeError("deprecated direct mode entrypoint")


def _run_scan_mode(
    *,
    repo_path: Path,
    python_path: Path,
    command_json: str,
    runtime_demo_enabled: bool,
    timeout_s: float,
) -> dict[str, object]:
    payload = json.loads(command_json)
    target = str(payload.get("target", "")).strip()
    current_map_path = repo_path / "map" / "current_map.md"

    if runtime_demo_enabled:
        messages = [
            "Demo detections loaded into runtime.",
            "Trajectory is seeded between the first two demo objects.",
        ]
        if target:
            messages.insert(0, f"Demo scan completed for '{target}'.")
        return {
            "accepted": True,
            "messages": messages,
            "raw_text": "\n".join(messages),
        }

    if not target:
        objects = _read_current_map_objects(current_map_path)
        if objects:
            messages = [
                f"Loaded {len(objects)} known object cluster(s) from current_map.md.",
                *objects[:3],
            ]
        else:
            messages = [
                "No known objects are available yet.",
                "Use /scan <target> to run ButterClaw's real rotate-and-detect scan.",
            ]
        return {
            "accepted": True,
            "messages": messages,
            "raw_text": "\n".join(messages),
        }

    completed = subprocess.run(
        [
            str(python_path),
            "-m",
            "sim.percept_cmd",
            "scan",
            "--target",
            target,
        ],
        cwd=str(repo_path),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=True,
    )
    scan_output = (completed.stdout or "").strip()
    messages = [
        f"Completed ButterClaw scan for '{target}'.",
        "Refresh detections from current_map.md or continue with a follow-up target command.",
    ]
    if scan_output:
        messages.append(scan_output.splitlines()[-1])
    return {
        "accepted": True,
        "messages": messages,
        "raw_text": scan_output or "\n".join(messages),
    }


def _run_direct_robot_runtime_mode(
    *,
    repo_path: Path,
    python_path: Path,
    command_json: str,
    timeout_s: float,
    runtime_demo_enabled: bool,
    runtime_root: Path,
    remote_ip: str,
    robot_id: str,
    port_zmq_cmd: int,
    port_zmq_observations: int,
    urdf_os_root: str | None,
    urdf_os_python: str | None,
    use_ssh_tunnel: bool,
    ssh_host: str | None,
    ssh_user: str | None,
    ssh_port: int,
    ping_first: bool,
    ping_count: int,
    wait_timeout_s: float,
) -> dict[str, object]:
    from robot_cli.adapter import build_settings
    from robot_cli.service_cmd import request_runtime_command, start_runtime

    payload = json.loads(command_json)
    command_type = str(payload.get("type", "")).strip()
    if command_type == "scan":
        return _run_scan_mode(
            repo_path=repo_path,
            python_path=python_path,
            command_json=command_json,
            runtime_demo_enabled=runtime_demo_enabled,
            timeout_s=timeout_s,
        )

    settings = build_settings(
        remote_ip=remote_ip,
        robot_id=robot_id,
        port_zmq_cmd=port_zmq_cmd,
        port_zmq_observations=port_zmq_observations,
        urdf_os_root=urdf_os_root,
        urdf_os_python=urdf_os_python,
        use_ssh_tunnel=use_ssh_tunnel,
        ssh_host=ssh_host,
        ssh_user=ssh_user,
        ssh_port=ssh_port,
        ping_first=ping_first,
        ping_count=ping_count,
    )
    start_runtime(settings, runtime_root, wait_timeout_s=wait_timeout_s)
    result = request_runtime_command(
        settings,
        runtime_root,
        command_type=command_type,
        timeout_s=timeout_s,
        payload={key: value for key, value in payload.items() if key != "type"},
    )
    payload_text = json.dumps(result, indent=2, sort_keys=True)
    messages = [payload_text] if payload_text.strip() else []
    return {
        "accepted": True,
        "messages": messages,
        "raw_text": "\n".join(messages),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one ButterClaw planner request and emit JSON.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--control-dir", required=True)
    parser.add_argument("--mode", choices=("planner", "direct"), default="planner")
    parser.add_argument("--text")
    parser.add_argument("--command-json")
    parser.add_argument("--timeout-s", type=float, default=30.0)
    parser.add_argument(
        "--runtime-demo-enabled",
        action=argparse.BooleanOptionalAction,
        default=False,
    )
    parser.add_argument("--runtime-root")
    parser.add_argument("--remote-ip")
    parser.add_argument("--robot-id")
    parser.add_argument("--port-zmq-cmd", type=int, default=5555)
    parser.add_argument("--port-zmq-observations", type=int, default=5557)
    parser.add_argument("--urdf-os-root")
    parser.add_argument("--urdf-os-python")
    parser.add_argument("--use-ssh-tunnel", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--ssh-host")
    parser.add_argument("--ssh-user")
    parser.add_argument("--ssh-port", type=int, default=22)
    parser.add_argument("--ping-first", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--ping-count", type=int, default=1)
    parser.add_argument("--wait-timeout-s", type=float, default=45.0)
    args = parser.parse_args()

    repo_path = Path(args.repo).expanduser().resolve()
    if not repo_path.exists():
        raise SystemExit(f"ButterClaw repo not found: {repo_path}")

    sys.path.insert(0, str(repo_path))
    control_dir = Path(args.control_dir)

    if args.mode == "planner":
        if not args.text:
            raise SystemExit("--text is required for planner mode")
        result = _run_planner_mode(control_dir=control_dir, text=args.text)
    else:
        if not args.command_json:
            raise SystemExit("--command-json is required for direct mode")
        if not args.runtime_root:
            raise SystemExit("--runtime-root is required for direct mode")
        if not args.remote_ip:
            raise SystemExit("--remote-ip is required for direct mode")
        if not args.robot_id:
            raise SystemExit("--robot-id is required for direct mode")
        result = _run_direct_robot_runtime_mode(
            repo_path=repo_path,
            python_path=Path(sys.executable),
            command_json=args.command_json,
            timeout_s=float(args.timeout_s),
            runtime_demo_enabled=bool(args.runtime_demo_enabled),
            runtime_root=Path(args.runtime_root),
            remote_ip=args.remote_ip,
            robot_id=args.robot_id,
            port_zmq_cmd=int(args.port_zmq_cmd),
            port_zmq_observations=int(args.port_zmq_observations),
            urdf_os_root=args.urdf_os_root,
            urdf_os_python=args.urdf_os_python,
            use_ssh_tunnel=bool(args.use_ssh_tunnel),
            ssh_host=args.ssh_host,
            ssh_user=args.ssh_user,
            ssh_port=int(args.ssh_port),
            ping_first=bool(args.ping_first),
            ping_count=int(args.ping_count),
            wait_timeout_s=float(args.wait_timeout_s),
        )

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
