from __future__ import annotations

import argparse
import json
import math
import random
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np

from backend.core.app_config import get_config_value, read_app_config
from backend.models.kinematics import IKRequest, IkSolveRequest
from backend.services.ik_orchestrator import solve_ik as orchestrated_ik
from backend.services.kinematics import compute_link_pose
from backend.services.amik_kinematics import inverse_kinematics as amik_ik
from backend.services.lerobot_kinematics import inverse_kinematics as placo_ik


@dataclass
class BenchmarkRun:
    sample_id: str
    target_set: str
    target_seed: int
    target_frame: str
    target_link: str
    solver_policy: str
    solver_used: str | None
    target_index: int
    target_position: Tuple[float, float, float]
    target_wxyz: Tuple[float, float, float, float]
    duration_ms: float
    success: bool
    pos_err: float | None
    rot_err: float | None
    orientation_strategy: str | None
    escalation_blocked_reason: str | None
    seed_source: str | None
    orientation_weight_effective: float | None


def find_leaf_link(urdf_xml: str) -> str:
    root = ET.fromstring(urdf_xml)
    links = {link.get("name") for link in root.findall(".//link") if link.get("name")}
    parent_links = set()
    for joint in root.findall(".//joint"):
        parent = joint.find("parent")
        if parent is not None and parent.get("link"):
            parent_links.add(parent.get("link"))
    leaf_links = sorted(link for link in links if link not in parent_links)
    return leaf_links[-1] if leaf_links else sorted(links)[-1]


def load_sample_urdf(sample_id: str) -> str:
    config = read_app_config()
    sample = get_config_value(config, ["samples", "items", sample_id], None)
    if not isinstance(sample, dict):
        raise FileNotFoundError(f"Sample '{sample_id}' not configured.")
    repo_root = Path(__file__).resolve().parents[2]
    repo_path = repo_root / sample.get("repoPath", "")
    urdf_path = repo_path / sample.get("urdfPath", "")
    if not urdf_path.exists():
        raise FileNotFoundError(f"URDF not found at {urdf_path}")
    return urdf_path.read_text(encoding="utf-8")


def generate_targets(target_set: str, count: int) -> List[Tuple[float, float, float]]:
    rng = random.Random(42)
    targets: List[Tuple[float, float, float]] = []
    for _ in range(count):
        if target_set == "unreachable":
            x = 0.6 + rng.uniform(0.1, 0.2)
            y = rng.uniform(-0.4, 0.4)
            z = 0.6 + rng.uniform(0.1, 0.2)
        else:
            x = 0.18 + rng.uniform(-0.05, 0.08)
            y = rng.uniform(-0.12, 0.12)
            z = 0.12 + rng.uniform(-0.04, 0.08)
        targets.append((x, y, z))
    return targets


def sample_random_cfgs(
    lower: np.ndarray,
    upper: np.ndarray,
    count: int,
    rng: random.Random,
) -> List[np.ndarray]:
    cfgs: List[np.ndarray] = []
    ranges = upper - lower
    ranges = np.where(ranges <= 0.0, 1.0, ranges)
    for _ in range(count):
        unit = np.array([rng.random() for _ in range(len(lower))], dtype=np.float32)
        cfgs.append(lower + unit * ranges)
    return cfgs


def sample_near_limit_cfgs(
    lower: np.ndarray,
    upper: np.ndarray,
    count: int,
    rng: random.Random,
    margin_fraction: float = 0.08,
) -> List[np.ndarray]:
    cfgs: List[np.ndarray] = []
    ranges = upper - lower
    ranges = np.where(ranges <= 0.0, 1.0, ranges)
    margins = ranges * margin_fraction
    for _ in range(count):
        cfg = np.zeros_like(lower)
        for idx in range(len(lower)):
            if rng.random() < 0.5:
                cfg[idx] = lower[idx] + rng.random() * margins[idx]
            else:
                cfg[idx] = upper[idx] - rng.random() * margins[idx]
        cfgs.append(cfg)
    return cfgs


def sanitize_limits(lower: np.ndarray, upper: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    finite = np.isfinite(lower) & np.isfinite(upper)
    safe_lower = np.where(finite, lower, 0.0)
    safe_upper = np.where(finite, upper, 0.0)
    return safe_lower, safe_upper


def filter_diverse_positions(
    positions: List[Tuple[float, float, float]],
    orientations: List[Tuple[float, float, float, float]],
    min_distance: float,
    count: int,
) -> Tuple[List[Tuple[float, float, float]], List[Tuple[float, float, float, float]]]:
    selected_positions: List[Tuple[float, float, float]] = []
    selected_orientations: List[Tuple[float, float, float, float]] = []
    for pos, ori in zip(positions, orientations):
        if len(selected_positions) >= count:
            break
        if not selected_positions:
            selected_positions.append(pos)
            selected_orientations.append(ori)
            continue
        distances = [
            math.dist(pos, existing) for existing in selected_positions
        ]
        if min(distances) >= min_distance:
            selected_positions.append(pos)
            selected_orientations.append(ori)
    if len(selected_positions) < count:
        for pos, ori in zip(positions, orientations):
            if len(selected_positions) >= count:
                break
            if pos in selected_positions:
                continue
            selected_positions.append(pos)
            selected_orientations.append(ori)
    return selected_positions, selected_orientations


def compute_manipulability(robot, cfg: np.ndarray, link_idx: int) -> float:
    cfg_jnp = jnp.array(cfg, dtype=jnp.float32)
    jacobian = jax.jacfwd(
        lambda q: jaxlie.SE3(robot.forward_kinematics(q)).translation()
    )(cfg_jnp)[link_idx]
    jjt = jacobian @ jacobian.T
    value = jnp.sqrt(jnp.maximum(0.0, jnp.linalg.det(jjt)))
    return float(value)


def pose_from_cfg(robot, cfg: np.ndarray, link_idx: int) -> Tuple[Tuple[float, float, float], Tuple[float, float, float, float]]:
    cfg_jnp = jnp.array(cfg, dtype=jnp.float32)
    poses = robot.forward_kinematics(cfg_jnp)
    w, x, y, z, px, py, pz = map(float, poses[link_idx])
    return (px, py, pz), (w, x, y, z)


def generate_target_set(
    target_set: str,
    count: int,
    urdf_xml: str,
    target_link: str,
    seed: int,
) -> Tuple[List[Tuple[float, float, float]], List[Tuple[float, float, float, float]]]:
    if target_set not in ("nominal", "unreachable"):
        raise ValueError(f"Unknown target set: {target_set}")
    positions = generate_targets(target_set, count)
    orientations = [(1.0, 0.0, 0.0, 0.0) for _ in positions]
    return positions, orientations


def quat_angle_error(target: Iterable[float], actual: Iterable[float]) -> float:
    tw, tx, ty, tz = target
    aw, ax, ay, az = actual
    t_norm = math.sqrt(tw * tw + tx * tx + ty * ty + tz * tz)
    a_norm = math.sqrt(aw * aw + ax * ax + ay * ay + az * az)
    if t_norm == 0.0 or a_norm == 0.0:
        return math.inf
    tw, tx, ty, tz = tw / t_norm, tx / t_norm, ty / t_norm, tz / t_norm
    aw, ax, ay, az = aw / a_norm, ax / a_norm, ay / a_norm, az / a_norm
    dot = abs(tw * aw + tx * ax + ty * ay + tz * az)
    dot = min(1.0, max(-1.0, dot))
    return 2.0 * math.acos(dot)


def solve_policy(
    policy: str,
    urdf_xml: str,
    target_link: str,
    target_position: Tuple[float, float, float],
    target_wxyz: Tuple[float, float, float, float],
) -> Tuple[IKRequest | IkSolveRequest, Dict[str, float], Dict]:
    if policy == "orchestrated":
        req = IkSolveRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=list(target_position),
            target_wxyz=list(target_wxyz),
            solver_chain=["lerobot-placo", "amik"],
            orientation_mode="prefer",
        )
        response = orchestrated_ik(req)
        return req, response.solution, response.metadata
    if policy == "amik-direct":
        req = IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=list(target_position),
            target_wxyz=list(target_wxyz),
        )
        response = amik_ik(req)
        return req, response.solution, response.metadata
    if policy == "placo-direct":
        req = IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=list(target_position),
            target_wxyz=list(target_wxyz),
        )
        response = placo_ik(req)
        return req, response.solution, response.metadata
    raise ValueError(f"Unknown policy: {policy}")


def summarize(values: List[float]) -> Dict[str, float]:
    if not values:
        return {"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0, "mean": 0.0}
    arr = np.array(values, dtype=float)
    return {
        "p50": float(np.percentile(arr, 50)),
        "p90": float(np.percentile(arr, 90)),
        "p95": float(np.percentile(arr, 95)),
        "p99": float(np.percentile(arr, 99)),
        "mean": float(np.mean(arr)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark IK policies and dump JSONL results.")
    parser.add_argument(
        "--samples",
        nargs="*",
        default=["so-arm100"],
        help="Sample ids from config.",
    )
    parser.add_argument("--targets", type=int, default=24, help="Targets per set.")
    parser.add_argument(
        "--target-sets",
        nargs="*",
        default=["nominal", "unreachable"],
        help="Target sets to run (nominal, unreachable).",
    )
    parser.add_argument(
        "--policies",
        nargs="*",
        default=["orchestrated", "amik-direct", "placo-direct"],
        help="Policies to benchmark.",
    )
    parser.add_argument(
        "--output",
        default="ik_benchmark.jsonl",
        help="JSONL output path.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    runs: List[BenchmarkRun] = []

    for sample_id in args.samples:
        urdf_xml = load_sample_urdf(sample_id)
        target_link = find_leaf_link(urdf_xml)
        for target_set in args.target_sets:
            seed_map = {
                "nominal": 101,
                "near_limit": 103,
                "near_singular": 107,
                "unreachable": 109,
            }
            seed = seed_map.get(target_set, 123)
            positions, orientations = generate_target_set(
                target_set, args.targets, urdf_xml, target_link, seed
            )
            for target_index, target in enumerate(positions):
                target_wxyz = orientations[target_index]
                for policy in args.policies:
                    start = time.perf_counter()
                    try:
                        _, solution, metadata = solve_policy(
                            policy, urdf_xml, target_link, target, target_wxyz
                        )
                    except Exception:
                        duration_ms = (time.perf_counter() - start) * 1000.0
                        runs.append(
                            BenchmarkRun(
                                sample_id=sample_id,
                                target_set=target_set,
                                target_seed=seed,
                                target_frame="world",
                                target_link=target_link,
                                solver_policy=policy,
                                solver_used=None,
                                target_index=target_index,
                                target_position=target,
                                target_wxyz=target_wxyz,
                                duration_ms=duration_ms,
                                success=False,
                                pos_err=None,
                                rot_err=None,
                                orientation_strategy=None,
                                escalation_blocked_reason="exception",
                                seed_source=None,
                                orientation_weight_effective=None,
                            )
                        )
                        continue
                    duration_ms = (time.perf_counter() - start) * 1000.0
                    pos_actual, wxyz_actual = compute_link_pose(
                        urdf_xml, solution, target_link
                    )
                    pos_err = float(
                        np.linalg.norm(np.array(pos_actual) - np.array(target))
                    )
                    rot_err = float(quat_angle_error(target_wxyz, wxyz_actual))
                    success = pos_err <= 0.002 and rot_err <= 0.05
                    runs.append(
                        BenchmarkRun(
                            sample_id=sample_id,
                            target_set=target_set,
                            target_seed=seed,
                            target_frame="world",
                            target_link=target_link,
                            solver_policy=policy,
                            solver_used=metadata.get("solver_id") if metadata else None,
                            target_index=target_index,
                            target_position=target,
                            target_wxyz=target_wxyz,
                            duration_ms=duration_ms,
                            success=success,
                            pos_err=pos_err,
                            rot_err=rot_err,
                            orientation_strategy=metadata.get("orientation_strategy")
                            if metadata
                            else None,
                            escalation_blocked_reason=metadata.get(
                                "escalation_blocked_reason"
                            )
                            if metadata
                            else None,
                            seed_source=metadata.get("seed_source") if metadata else None,
                            orientation_weight_effective=metadata.get(
                                "orientation_weight_effective"
                            )
                            if metadata
                            else None,
                        )
                    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for run in runs:
            handle.write(json.dumps(asdict(run)) + "\n")

    print(f"Wrote {len(runs)} runs to {output_path}")

    by_policy: Dict[str, List[BenchmarkRun]] = {}
    for run in runs:
        by_policy.setdefault(run.solver_policy, []).append(run)

    print("Summary:")
    for policy, items in by_policy.items():
        durations = [item.duration_ms for item in items]
        success_rate = sum(1 for item in items if item.success) / len(items)
        stats = summarize(durations)
        print(
            f"- {policy}: success {success_rate:.2%}, "
            f"p50 {stats['p50']:.1f} ms, p95 {stats['p95']:.1f} ms"
        )


if __name__ == "__main__":
    main()
