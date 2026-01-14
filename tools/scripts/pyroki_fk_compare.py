#!/usr/bin/env python3
"""
PyRoki-based forward kinematics service for URDF Studio.

This script:
  - Loads a URDF with yourdfpy
  - Builds a PyRoki Robot from the URDF
  - Runs forward kinematics for a given joint configuration
  - Returns link poses as JSON for comparison with Three.js / URDFLoader

It is intended to be called from the Node API server.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Dict, Any

import numpy as onp
import yourdfpy
from jax import numpy as jnp

from pyroki import Robot


def load_urdf(path: str) -> yourdfpy.URDF:
  """Load URDF from file path using yourdfpy."""
  try:
    return yourdfpy.URDF.load(path)
  except Exception as exc:  # pragma: no cover - defensive
    print(f"ERROR: Failed to load URDF from '{path}': {exc}", file=sys.stderr)
    raise


def load_joint_values(path: str) -> Dict[str, float]:
  """Load joint values from a JSON file mapping joint_name -> value (radians)."""
  try:
    with open(path, "r", encoding="utf-8") as f:
      data = json.load(f)
  except Exception as exc:  # pragma: no cover - defensive
    print(f"ERROR: Failed to load joint values from '{path}': {exc}", file=sys.stderr)
    raise

  if not isinstance(data, dict):
    raise ValueError("Joint values JSON must be an object mapping joint names to numbers")

  joint_values: Dict[str, float] = {}
  for name, value in data.items():
    try:
      joint_values[str(name)] = float(value)
    except (TypeError, ValueError):
      raise ValueError(f"Joint value for '{name}' is not a valid number: {value!r}") from None

  return joint_values


def build_cfg_from_joint_map(robot: Robot, joint_values: Dict[str, float]) -> jnp.ndarray:
  """
  Build the actuated joint configuration vector in PyRoki's expected order.

  PyRoki uses `robot.joints.actuated_names` to define the configuration order.
  Any missing joints default to 0.0.
  """
  actuated_names = list(robot.joints.actuated_names)
  cfg_list = []
  for name in actuated_names:
    cfg_list.append(float(joint_values.get(name, 0.0)))
  cfg = jnp.array(cfg_list, dtype=jnp.float32)
  assert cfg.shape == (robot.joints.num_actuated_joints,)
  return cfg


def run_fk(urdf_path: str, joint_values_path: str) -> Dict[str, Any]:
  """Compute FK with PyRoki and return a JSON-serializable result dict."""
  urdf = load_urdf(urdf_path)
  robot = Robot.from_urdf(urdf)

  joint_values = load_joint_values(joint_values_path)
  cfg = build_cfg_from_joint_map(robot, joint_values)

  # Run forward kinematics once; result shape: (link_count, 7) in wxyz_xyz format
  link_poses = robot.forward_kinematics(cfg)
  link_poses_np = onp.asarray(link_poses, dtype=onp.float64)

  if link_poses_np.shape != (robot.links.num_links, 7):
    raise RuntimeError(
      f"Unexpected FK output shape {link_poses_np.shape}, expected ({robot.links.num_links}, 7)"
    )

  link_names = list(robot.links.names)

  links_out = []
  for idx, name in enumerate(link_names):
    w, x, y, z, px, py, pz = map(float, link_poses_np[idx])
    links_out.append(
      {
        "name": name,
        "position": [px, py, pz],
        # Quaternion in [w, x, y, z] to make the convention explicit.
        "quaternion_wxyz": [w, x, y, z],
      }
    )

  return {
    "links": links_out,
    "metadata": {
      "actuated_joint_names": list(robot.joints.actuated_names),
      "all_link_names": link_names,
    },
  }


def main(argv: list[str] | None = None) -> int:
  parser = argparse.ArgumentParser(
    description="Compute forward kinematics using PyRoki for a given URDF and joint configuration."
  )
  parser.add_argument(
    "--urdf-file",
    type=str,
    required=True,
    help="Path to URDF XML file.",
  )
  parser.add_argument(
    "--joint-file",
    type=str,
    required=True,
    help="Path to JSON file mapping joint_name -> value (radians).",
  )

  args = parser.parse_args(argv)

  try:
    result = run_fk(args.urdf_file, args.joint_file)
  except Exception as exc:
    # Print a structured error for the Node server to surface.
    print(f"ERROR: {exc}", file=sys.stderr)
    return 1

  # Write JSON result to stdout with no extra logging.
  json.dump(result, sys.stdout)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

