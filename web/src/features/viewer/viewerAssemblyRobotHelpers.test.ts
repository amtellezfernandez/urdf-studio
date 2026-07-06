import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import {
  applyAssemblyPlacementPose,
  createAssemblyPlacementRobotEntry,
  resolveAssemblySecondaryLayoutRadius,
} from "@/features/viewer/viewerAssemblyRobotHelpers";

const createRobot = (mesh?: THREE.Mesh): URDFRobot => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  if (mesh) {
    robot.add(mesh);
  }
  robot.updateMatrixWorld(true);
  return robot;
};

describe("viewerAssemblyRobotHelpers", () => {
  it("builds assembly placement metadata from robot bounds", () => {
    const robot = createRobot(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.5)));

    const entry = createAssemblyPlacementRobotEntry({ id: "primary", robot });

    expect(entry.id).toBe("primary");
    expect(entry.robot).toBe(robot);
    expect(entry.halfExtentX).toBeCloseTo(1);
    expect(entry.halfExtentZ).toBeCloseTo(0.25);
    expect(entry.radius).toBeCloseTo(1);
    expect(entry.meshProxies).toHaveLength(1);
    expect(entry.wheelProfile).toBeNull();
  });

  it("uses a minimum footprint for empty or tiny robots", () => {
    const entry = createAssemblyPlacementRobotEntry({
      id: "empty",
      robot: createRobot(),
    });

    expect(entry.halfExtentX).toBe(0.09);
    expect(entry.halfExtentZ).toBe(0.09);
    expect(entry.radius).toBe(0.09);
  });

  it("applies stored assembly poses consistently", () => {
    const robot = createRobot();

    applyAssemblyPlacementPose(robot, {
      x: 1.2,
      y: 0.3,
      z: -0.8,
      yaw: Math.PI / 4,
    });

    expect(robot.position.x).toBeCloseTo(1.2);
    expect(robot.position.y).toBeCloseTo(0.3);
    expect(robot.position.z).toBeCloseTo(-0.8);
    expect(robot.rotation.y).toBeCloseTo(Math.PI / 4);
  });

  it("keeps secondary layout clear of the primary robot", () => {
    const radius = resolveAssemblySecondaryLayoutRadius({
      primaryRadius: 0.8,
      secondaryEntries: [{ radius: 0.4 }, { radius: 0.6 }],
      spacing: 0.45,
    });

    expect(radius).toBeCloseTo(1.85);
  });

  it("expands secondary layout for peer spacing when many robots are loaded", () => {
    const radius = resolveAssemblySecondaryLayoutRadius({
      primaryRadius: 0.1,
      secondaryEntries: Array.from({ length: 8 }, () => ({ radius: 0.6 })),
      spacing: 0.45,
    });

    expect(radius).toBeCloseTo((1.65 * 8) / (2 * Math.PI));
  });
});
