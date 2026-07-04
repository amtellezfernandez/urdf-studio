import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import {
  applyRobotBasePose,
  extractRobotBasePose,
} from "@/shared/lib/urdfRobotBasePose";

const createRobot = (): URDFRobot => new THREE.Group() as unknown as URDFRobot;

describe("urdfRobotBasePose", () => {
  it("extracts and applies finite robot root poses", () => {
    const sourceRobot = createRobot();
    sourceRobot.position.set(1.2, 0.3, -0.4);
    sourceRobot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);

    const pose = extractRobotBasePose(sourceRobot);
    expect(pose).not.toBeNull();

    const targetRobot = createRobot();
    expect(applyRobotBasePose(targetRobot, pose)).toBe(true);
    expect(targetRobot.position.distanceTo(sourceRobot.position)).toBeLessThan(1e-10);
    expect(targetRobot.quaternion.angleTo(sourceRobot.quaternion)).toBeLessThan(1e-10);
  });

  it("rejects missing and non-finite poses", () => {
    const robot = createRobot();
    robot.position.x = Number.NaN;

    expect(extractRobotBasePose(robot)).toBeNull();
    expect(applyRobotBasePose(robot, null)).toBe(false);
  });
});
