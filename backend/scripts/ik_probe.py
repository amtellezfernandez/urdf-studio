from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, Tuple

import numpy as np

from backend.core.app_config import get_config_value, read_app_config
from backend.models.kinematics import FKRequest, IKRequest
from backend.services.kinematics import forward_kinematics, inverse_kinematics as pyroki_ik
from backend.services.lerobot_kinematics import _load_placo, inverse_kinematics as placo_ik


def _load_sample_urdf(sample_id: str) -> str:
    config = read_app_config()
    quickstart_id = get_config_value(config, ["samples", "quickStartId"], None)
    if sample_id == "quickstart" and isinstance(quickstart_id, str):
        sample_id = quickstart_id
    items = get_config_value(config, ["samples", "items"], {})
    if not isinstance(items, dict) or sample_id not in items:
        raise RuntimeError(f"Sample '{sample_id}' not found in config.")
    payload = items[sample_id]
    if not isinstance(payload, dict):
        raise RuntimeError(f"Sample '{sample_id}' config is invalid.")
    repo_path = payload.get("repoPath")
    urdf_path = payload.get("urdfPath")
    if not repo_path or not urdf_path:
        raise RuntimeError(f"Sample '{sample_id}' missing repoPath/urdfPath.")
    repo_root = Path(__file__).resolve().parents[2]
    urdf_file = repo_root / repo_path / urdf_path
    if not urdf_file.exists():
        raise RuntimeError(f"URDF not found at {urdf_file}")
    return urdf_file.read_text()


def _rotation_error_deg(target: np.ndarray, actual: np.ndarray) -> float:
    delta = target.T @ actual
    trace = np.clip((np.trace(delta) - 1.0) * 0.5, -1.0, 1.0)
    return float(np.degrees(np.arccos(trace)))


def _find_link_pose(fk_payload, link_name: str) -> Tuple[np.ndarray, np.ndarray]:
    for link in fk_payload.links:
        if link.name == link_name:
            pos = np.array(link.position, dtype=np.float64)
            quat = np.array(link.quaternion_wxyz, dtype=np.float64)
            return pos, quat
    raise RuntimeError(f"Link '{link_name}' not found in FK output.")


def _quat_to_matrix(wxyz: np.ndarray) -> np.ndarray:
    w, x, y, z = wxyz
    norm = np.linalg.norm(wxyz)
    if norm == 0:
        return np.eye(3, dtype=np.float64)
    w, x, y, z = wxyz / norm
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def _placo_fk(urdf_xml: str, joints: Dict[str, float], target_link: str) -> Tuple[np.ndarray, np.ndarray]:
    entry = _load_placo(urdf_xml)
    for name in entry.joint_names:
        entry.robot.set_joint(name, float(joints.get(name, 0.0)))
    entry.robot.update_kinematics()
    tf = entry.robot.get_T_world_frame(target_link)
    pos = np.array(tf[:3, 3], dtype=np.float64)
    rot = np.array(tf[:3, :3], dtype=np.float64)
    return pos, rot


def _print_pose(label: str, pos: np.ndarray, rot: np.ndarray) -> None:
    pos_str = f"[{pos[0]:+.4f}, {pos[1]:+.4f}, {pos[2]:+.4f}]"
    trace = np.trace(rot)
    print(f"{label} pos={pos_str} rot_trace={trace:+.4f}")


def run_probe(sample_id: str, target_link: str, offset: np.ndarray) -> int:
    urdf_xml = _load_sample_urdf(sample_id)

    fk_payload = forward_kinematics(FKRequest(urdf=urdf_xml, joint_values={}))
    base_pos, base_quat = _find_link_pose(fk_payload, target_link)
    target_pos = base_pos + offset
    target_rot = _quat_to_matrix(base_quat)

    print("== Baseline (PyRoki FK, zero joints) ==")
    _print_pose("pyroki_base", base_pos, target_rot)

    placo_base_pos, placo_base_rot = _placo_fk(urdf_xml, {}, target_link)
    base_pos_err = float(np.linalg.norm(placo_base_pos - base_pos))
    base_rot_err = _rotation_error_deg(target_rot, placo_base_rot)
    _print_pose("placo_base", placo_base_pos, placo_base_rot)
    print(f"base_delta pos_err={base_pos_err:.6f} rot_err_deg={base_rot_err:.3f}")

    print("\n== Target ==")
    _print_pose("target", target_pos, target_rot)

    # PyRoki IK solve for reference
    pyroki_solution = pyroki_ik(
        IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=target_pos.tolist(),
            target_wxyz=base_quat.tolist(),
        )
    ).solution
    pyroki_fk_payload = forward_kinematics(
        FKRequest(urdf=urdf_xml, joint_values=pyroki_solution)
    )
    pyroki_pos, pyroki_quat = _find_link_pose(pyroki_fk_payload, target_link)
    pyroki_rot = _quat_to_matrix(pyroki_quat)
    pyroki_pos_err = float(np.linalg.norm(pyroki_pos - target_pos))
    pyroki_rot_err = _rotation_error_deg(target_rot, pyroki_rot)
    print("\n== PyRoki IK result ==")
    _print_pose("pyroki_ik", pyroki_pos, pyroki_rot)
    print(f"pyroki_err pos_err={pyroki_pos_err:.6f} rot_err_deg={pyroki_rot_err:.3f}")

    # Placo IK solve
    placo_solution = placo_ik(
        IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=target_pos.tolist(),
            target_wxyz=base_quat.tolist(),
        )
    ).solution
    placo_pos, placo_rot = _placo_fk(urdf_xml, placo_solution, target_link)
    placo_pos_err = float(np.linalg.norm(placo_pos - target_pos))
    placo_rot_err = _rotation_error_deg(target_rot, placo_rot)
    print("\n== Placo IK result ==")
    _print_pose("placo_ik", placo_pos, placo_rot)
    print(f"placo_err pos_err={placo_pos_err:.6f} rot_err_deg={placo_rot_err:.3f}")

    return 0


def _parse_offset(raw: str) -> np.ndarray:
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("Offset must be 'x,y,z'")
    return np.array([float(parts[0]), float(parts[1]), float(parts[2])], dtype=np.float64)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe IK solver alignment for a sample URDF.")
    parser.add_argument("--sample", default="quickstart", help="Sample id or 'quickstart'.")
    parser.add_argument("--link", default="gripper_frame_link", help="Target link name.")
    parser.add_argument(
        "--offset",
        default="0.05,0,0",
        type=_parse_offset,
        help="Offset from current FK position in meters (x,y,z).",
    )
    args = parser.parse_args()

    try:
        return run_probe(args.sample, args.link, args.offset)
    except Exception as exc:
        print(f"[ik_probe] failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
