/** @vitest-environment jsdom */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";
import {
  optimizeRobotSupportPlane,
  type SupportPlaneOptimizationFailure,
} from "./supportPlaneOptimization";

const createRobotWithMesh = (mesh: THREE.Object3D): URDFRobot => {
  const robotRoot = new THREE.Object3D();
  const baseLink = new THREE.Object3D();
  baseLink.name = "base_link";
  baseLink.add(mesh);
  robotRoot.add(baseLink);
  robotRoot.updateMatrixWorld(true);

  return {
    robotName: "support_robot",
    links: {
      base_link: baseLink,
    },
    getObjectByName: robotRoot.getObjectByName.bind(robotRoot),
    updateMatrixWorld: robotRoot.updateMatrixWorld.bind(robotRoot),
    traverse: robotRoot.traverse.bind(robotRoot),
  } as unknown as URDFRobot;
};

describe("supportPlaneOptimization", () => {
  it("detects +z as the likely up-axis for canonical ground-plane geometry", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 0.1), new THREE.MeshBasicMaterial());
    mesh.position.set(0, 0, -0.05);
    const result = optimizeRobotSupportPlane(createRobotWithMesh(mesh));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.inferredUpAxis).toBe("z");
      expect(result.inferredUpSign).toBe(1);
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it("detects +x as the likely up-axis when the support plane is aligned to x", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 2), new THREE.MeshBasicMaterial());
    mesh.position.set(-0.05, 0, 0);
    const result = optimizeRobotSupportPlane(createRobotWithMesh(mesh));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.inferredUpAxis).toBe("x");
      expect(result.inferredUpSign).toBe(1);
    }
  });

  it("falls back when there is no renderable mesh geometry", () => {
    const robotRoot = new THREE.Object3D();
    const baseLink = new THREE.Object3D();
    baseLink.name = "base_link";
    robotRoot.add(baseLink);
    const result = optimizeRobotSupportPlane({
      robotName: "empty_robot",
      links: { base_link: baseLink },
      getObjectByName: robotRoot.getObjectByName.bind(robotRoot),
      updateMatrixWorld: robotRoot.updateMatrixWorld.bind(robotRoot),
      traverse: robotRoot.traverse.bind(robotRoot),
    } as unknown as URDFRobot);

    if (!result.success) {
      const failure = result as SupportPlaneOptimizationFailure;
      expect(failure.fallbackReason).toContain("No renderable mesh geometry");
      return;
    }
    throw new Error("Expected support-plane inference to fail without renderable meshes.");
  });
});
