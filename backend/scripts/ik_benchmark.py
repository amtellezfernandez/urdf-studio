from __future__ import annotations

import argparse
import random
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

from backend.core.app_config import get_config_value, read_app_config
from backend.models.kinematics import FKRequest, IKRequest
from backend.services.kinematics import forward_kinematics
from backend.services.amik_kinematics import inverse_kinematics as amik_ik
from backend.services.placo_kinematics import inverse_kinematics as placo_ik
from backend.services.placo_kinematics import _load_placo


@dataclass
class SolverResult:
    name: str
    runs: int
    success: int
    avg_ms: float
    avg_pos_err: float


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


def generate_targets(count: int) -> List[Tuple[float, float, float]]:
    rng = random.Random(42)
    targets: List[Tuple[float, float, float]] = []
    for _ in range(count):
        x = 0.18 + rng.uniform(-0.05, 0.08)
        y = rng.uniform(-0.12, 0.12)
        z = 0.12 + rng.uniform(-0.04, 0.08)
        targets.append((x, y, z))
    return targets


def evaluate_placo(
    urdf_xml: str,
    target_link: str,
    targets: List[Tuple[float, float, float]],
) -> SolverResult:
    durations: List[float] = []
    errors: List[float] = []
    success = 0
    entry = _load_placo(urdf_xml)
    for target in targets:
        req = IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=list(target),
            target_wxyz=[1.0, 0.0, 0.0, 0.0],
        )
        start = time.perf_counter()
        result = placo_ik(req)
        durations.append((time.perf_counter() - start) * 1000.0)
        if result and result.solution:
            success += 1
            for joint_name in entry.joint_names:
                entry.robot.set_joint(joint_name, result.solution.get(joint_name, 0.0))
            entry.robot.update_kinematics()
            transform = entry.robot.get_T_world_frame(target_link)
            pos = np.array(transform[:3, 3], dtype=float)
            errors.append(float(np.linalg.norm(pos - np.array(target))))
    return SolverResult(
        name="placo",
        runs=len(targets),
        success=success,
        avg_ms=float(np.mean(durations)) if durations else 0.0,
        avg_pos_err=float(np.mean(errors)) if errors else 0.0,
    )


def evaluate_amik(
    urdf_xml: str,
    target_link: str,
    targets: List[Tuple[float, float, float]],
) -> SolverResult:
    durations: List[float] = []
    errors: List[float] = []
    success = 0
    for target in targets:
        req = IKRequest(
            urdf=urdf_xml,
            joint_values={},
            target_link=target_link,
            target_position=list(target),
            target_wxyz=[1.0, 0.0, 0.0, 0.0],
        )
        start = time.perf_counter()
        result = amik_ik(req)
        durations.append((time.perf_counter() - start) * 1000.0)
        if result and result.solution:
            success += 1
            fk = forward_kinematics(
                FKRequest(urdf=urdf_xml, joint_values=result.solution)
            )
            link = next((l for l in fk.links if l.name == target_link), None)
            if link:
                pos = np.array(link.position, dtype=float)
                errors.append(float(np.linalg.norm(pos - np.array(target))))
    return SolverResult(
        name="amik",
        runs=len(targets),
        success=success,
        avg_ms=float(np.mean(durations)) if durations else 0.0,
        avg_pos_err=float(np.mean(errors)) if errors else 0.0,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark IK solvers using the SO-ARM100 sample.")
    parser.add_argument("--sample-id", default="so-arm100", help="Sample id from config.")
    parser.add_argument("--targets", type=int, default=12, help="Number of target positions.")
    parser.add_argument("--solvers", nargs="*", default=["placo", "amik"])
    args = parser.parse_args()

    urdf_xml = load_sample_urdf(args.sample_id)
    target_link = find_leaf_link(urdf_xml)
    targets = generate_targets(args.targets)

    results: List[SolverResult] = []
    if "placo" in args.solvers:
        results.append(evaluate_placo(urdf_xml, target_link, targets))
    if "amik" in args.solvers:
        results.append(evaluate_amik(urdf_xml, target_link, targets))

    print("IK benchmark results:")
    for result in results:
        print(
            f"- {result.name}: success {result.success}/{result.runs}, "
            f"avg {result.avg_ms:.1f} ms, pos err {result.avg_pos_err:.4f} m"
        )


if __name__ == "__main__":
    main()
