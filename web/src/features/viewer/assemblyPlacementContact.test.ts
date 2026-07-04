import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import {
  computeAssemblyContactMetric,
  computeAssemblyContactPairs,
  computeAssemblyMeshContactGap,
  resolveAssemblyNearestContactSnap,
  type AssemblyMeshProxy,
  type AssemblyPlacementRobot,
} from "@/features/viewer/assemblyPlacementContact";

const createMeshProxy = (mesh: THREE.Mesh): AssemblyMeshProxy => {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (!geometry.boundingBox) {
    throw new Error("test mesh geometry did not produce a bounding box");
  }
  return {
    mesh,
    localBounds: geometry.boundingBox.clone(),
  };
};

const createAssemblyRobot = ({
  id,
  x = 0,
  z = 0,
  yaw = 0,
  radius = 0.5,
  halfExtentX = 0.5,
  halfExtentZ = 0.5,
  meshes = [],
}: {
  id: string;
  x?: number;
  z?: number;
  yaw?: number;
  radius?: number;
  halfExtentX?: number;
  halfExtentZ?: number;
  meshes?: THREE.Mesh[];
}): AssemblyPlacementRobot => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  robot.position.set(x, 0, z);
  robot.rotation.y = yaw;
  meshes.forEach((mesh) => robot.add(mesh));
  robot.updateMatrixWorld(true);
  return {
    id,
    robot,
    radius,
    halfExtentX,
    halfExtentZ,
    meshProxies: meshes.map(createMeshProxy),
    wheelProfile: null,
  };
};

describe("assemblyPlacementContact", () => {
  it("computes an x-axis contact metric from footprint support", () => {
    const lhs = createAssemblyRobot({
      id: "lhs",
      x: 1,
      halfExtentX: 0.4,
      halfExtentZ: 0.2,
    });
    const rhs = createAssemblyRobot({
      id: "rhs",
      x: 0,
      halfExtentX: 0.6,
      halfExtentZ: 0.2,
    });

    const metric = computeAssemblyContactMetric(lhs, rhs);

    expect(metric.axisMode).toBe("x");
    expect(metric.distance).toBeCloseTo(1);
    expect(metric.targetDistance).toBeCloseTo(1);
    expect(metric.gap).toBeCloseTo(0);
    expect(metric.targetX).toBeCloseTo(1);
    expect(metric.targetZ).toBeCloseTo(0);
  });

  it("computes mesh contact gaps from world-space boxes", () => {
    const lhsMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const rhsMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const lhs = createAssemblyRobot({ id: "lhs", meshes: [lhsMesh] });
    const rhs = createAssemblyRobot({ id: "rhs", x: 1.2, meshes: [rhsMesh] });

    expect(computeAssemblyMeshContactGap(lhs, rhs)).toBeCloseTo(0.2);
  });

  it("builds contact pairs when robots are within the contact tolerance", () => {
    const contactPairs = computeAssemblyContactPairs([
      createAssemblyRobot({ id: "primary", x: 0, halfExtentX: 0.5 }),
      createAssemblyRobot({ id: "left", x: 1, halfExtentX: 0.5 }),
      createAssemblyRobot({ id: "far", x: 4, halfExtentX: 0.5 }),
    ]);

    expect(contactPairs).toEqual(["left::primary"]);
  });

  it("resolves the preferred snap candidate when contact scores are close", () => {
    const snap = resolveAssemblyNearestContactSnap(
      [
        createAssemblyRobot({ id: "selected", x: 0, halfExtentX: 0.5 }),
        createAssemblyRobot({ id: "near", x: 1.5, halfExtentX: 0.5 }),
        createAssemblyRobot({ id: "preferred", x: 1.51, halfExtentX: 0.5 }),
      ],
      "selected",
      { maxGap: 1, preferOtherId: "preferred" }
    );

    expect(snap.snapped).toBe(true);
    if (snap.snapped) {
      expect(snap.otherId).toBe("preferred");
      expect(snap.absGap).toBeCloseTo(0.51);
      expect(snap.targetX).toBeCloseTo(0.51);
      expect(snap.targetZ).toBeCloseTo(0);
    }
  });

  it("blocks snapping when the best gap exceeds the requested limit", () => {
    expect(
      resolveAssemblyNearestContactSnap(
        [
          createAssemblyRobot({ id: "selected", x: 0, halfExtentX: 0.5 }),
          createAssemblyRobot({ id: "near", x: 2, halfExtentX: 0.5 }),
        ],
        "selected",
        { maxGap: 0.2 }
      )
    ).toEqual({ snapped: false });
  });
});
