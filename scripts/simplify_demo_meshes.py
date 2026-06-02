#!/usr/bin/env python3
"""Simplify heavy demo STL meshes with deterministic vertex clustering."""

from __future__ import annotations

import argparse
import os
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEMO_MESH_DIR = REPO_ROOT / "web" / "public" / "demo" / "meshes"
TRIANGLE_RECORD_SIZE = 50
STL_HEADER_SIZE = 84
MIN_EDGE_LENGTH = 1e-6
DEFAULT_TARGETS = {
    "4-Omni-Directional-Wheel_Single_Body-v1.stl": 50,
    "Camera-Model-v3.stl": 60,
    "Base_08q-v1.stl": 60,
    "Wrist_Roll_Pitch_08i-v1.stl": 70,
    "ST3215_Servo_Motor-v1.stl": 70,
    "SO_ARM100_08k_Mirror-v1.stl": 70,
    "Wrist_Roll_08c-v1.stl": 70,
    "Moving_Jaw_08d-v1.stl": 70,
    "Rotation_Pitch_08i-v1.stl": 70,
}
STL_TRIANGLE_DTYPE = np.dtype(
    [
        ("normal", "<f4", (3,)),
        ("v1", "<f4", (3,)),
        ("v2", "<f4", (3,)),
        ("v3", "<f4", (3,)),
        ("attr", "<u2"),
    ]
)


@dataclass(frozen=True)
class SimplificationResult:
    filename: str
    divisions: int
    triangles_before: int
    triangles_after: int
    bytes_before: int
    bytes_after: int


def load_binary_stl(path: Path) -> tuple[bytes, np.ndarray]:
    data = path.read_bytes()
    triangle_count = struct.unpack("<I", data[80:84])[0]
    records = np.frombuffer(data, dtype=STL_TRIANGLE_DTYPE, count=triangle_count, offset=84)
    triangles = np.stack([records["v1"], records["v2"], records["v3"]], axis=1).copy()
    return data[:80], triangles


def simplify_triangles(triangles: np.ndarray, divisions: int) -> np.ndarray:
    vertices = triangles.reshape(-1, 3)
    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    spans = np.maximum(maxs - mins, MIN_EDGE_LENGTH)
    steps = spans / divisions

    cell_indices = np.floor((vertices - mins) / steps).astype(np.int32)
    cell_indices = np.clip(cell_indices, 0, divisions - 1)
    _, inverse = np.unique(cell_indices, axis=0, return_inverse=True)

    centroid_sums = np.zeros((inverse.max() + 1, 3), dtype=np.float64)
    centroid_counts = np.bincount(inverse)
    np.add.at(centroid_sums, inverse, vertices)
    centroids = (centroid_sums / centroid_counts[:, None]).astype(np.float32)
    simplified = centroids[inverse].reshape(triangles.shape)

    edge_a = np.linalg.norm(simplified[:, 0] - simplified[:, 1], axis=1)
    edge_b = np.linalg.norm(simplified[:, 1] - simplified[:, 2], axis=1)
    edge_c = np.linalg.norm(simplified[:, 2] - simplified[:, 0], axis=1)
    keep_mask = (edge_a > MIN_EDGE_LENGTH) & (edge_b > MIN_EDGE_LENGTH) & (edge_c > MIN_EDGE_LENGTH)
    return simplified[keep_mask]


def compute_normals(triangles: np.ndarray) -> np.ndarray:
    vectors_a = triangles[:, 1] - triangles[:, 0]
    vectors_b = triangles[:, 2] - triangles[:, 0]
    normals = np.cross(vectors_a, vectors_b)
    lengths = np.linalg.norm(normals, axis=1)
    nonzero = lengths > MIN_EDGE_LENGTH
    normals[nonzero] = normals[nonzero] / lengths[nonzero][:, None]
    normals[~nonzero] = 0
    return normals.astype(np.float32)


def write_binary_stl(path: Path, header: bytes, triangles: np.ndarray) -> int:
    normals = compute_normals(triangles)
    records = np.zeros(len(triangles), dtype=STL_TRIANGLE_DTYPE)
    records["normal"] = normals
    records["v1"] = triangles[:, 0]
    records["v2"] = triangles[:, 1]
    records["v3"] = triangles[:, 2]
    records["attr"] = 0
    output = header.ljust(80, b" ")[:80] + struct.pack("<I", len(triangles)) + records.tobytes()
    path.write_bytes(output)
    return len(output)


def simplify_mesh(path: Path, divisions: int) -> SimplificationResult:
    bytes_before = path.stat().st_size
    header, triangles = load_binary_stl(path)
    simplified = simplify_triangles(triangles, divisions)
    bytes_after = write_binary_stl(path, header, simplified)
    return SimplificationResult(
        filename=path.name,
        divisions=divisions,
        triangles_before=len(triangles),
        triangles_after=len(simplified),
        bytes_before=bytes_before,
        bytes_after=bytes_after,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mesh-dir",
        type=Path,
        default=DEMO_MESH_DIR,
        help=f"Directory containing demo STL meshes (default: {DEMO_MESH_DIR})",
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help="Optional NAME=DIVISIONS overrides. Defaults to the heavy demo mesh set.",
    )
    return parser.parse_args()


def resolve_targets(raw_targets: list[str]) -> dict[str, int]:
    if not raw_targets:
        return DEFAULT_TARGETS

    parsed: dict[str, int] = {}
    for raw_target in raw_targets:
        filename, separator, divisions_text = raw_target.partition("=")
        if separator != "=":
            raise ValueError(f"Target '{raw_target}' must use NAME=DIVISIONS.")
        parsed[filename] = int(divisions_text)
    return parsed


def main() -> int:
    args = parse_args()
    targets = resolve_targets(args.targets)
    results = []
    for filename, divisions in targets.items():
        mesh_path = args.mesh_dir / filename
        if not mesh_path.exists():
            raise FileNotFoundError(f"Missing mesh: {mesh_path}")
        result = simplify_mesh(mesh_path, divisions)
        results.append(result)
        print(
            f"{result.filename}\tdiv={result.divisions}\t"
            f"{result.triangles_before}->{result.triangles_after}\t"
            f"{result.bytes_before}->{result.bytes_after}"
        )

    total_before = sum(result.bytes_before for result in results)
    total_after = sum(result.bytes_after for result in results)
    print(f"total_bytes\t{total_before}->{total_after}\tsaved={total_before - total_after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
