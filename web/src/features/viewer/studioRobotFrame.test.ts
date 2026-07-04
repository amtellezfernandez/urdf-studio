import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import {
  clampStudioPlanarPose,
  cloneStudioUpAxis,
  ROBOT_FRONT_LOCAL_FORWARD,
  resolveBaseCameraForwardLocal,
  resolveBaseCameraLikeLinkForwardLocal,
} from "@/features/viewer/studioRobotFrame";
import type { Camera as RobotCamera } from "@/shared/types/camera";

const asRobot = (object: THREE.Object3D): URDFRobot => object as URDFRobot;

type MutableRobotFixture = Omit<URDFRobot, "links" | "joints"> & {
  links: Record<string, THREE.Object3D>;
  joints: Record<string, THREE.Object3D>;
};

const createRobotWithCameraLink = () => {
  const robot = asRobot(new THREE.Group());
  const baseLink = new THREE.Group();
  const cameraJoint = new THREE.Group();
  const cameraLink = new THREE.Group();

  baseLink.name = "base_link";
  cameraJoint.name = "camera_joint";
  cameraLink.name = "front_camera_link";
  cameraLink.position.set(2, 0, 0);

  (baseLink as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  (cameraJoint as THREE.Object3D & { isURDFJoint?: boolean; childLink?: string }).isURDFJoint = true;
  (cameraJoint as THREE.Object3D & { childLink?: string }).childLink = cameraLink.name;
  (cameraLink as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;

  cameraJoint.add(cameraLink);
  baseLink.add(cameraJoint);
  robot.add(baseLink);
  const mutableRobot = robot as unknown as MutableRobotFixture;
  mutableRobot.links = {
    [baseLink.name]: baseLink,
    [cameraLink.name]: cameraLink,
  };
  mutableRobot.joints = {
    [cameraJoint.name]: cameraJoint,
  };
  robot.updateMatrixWorld(true);

  return {
    robot,
    cameraJoint,
  };
};

describe("studioRobotFrame", () => {
  it("returns a fresh Studio up-axis vector", () => {
    const first = cloneStudioUpAxis();
    const second = cloneStudioUpAxis();

    first.x = 10;

    expect(second.toArray()).toEqual([0, 0, 1]);
  });

  it("clamps z-up Studio poses without changing yaw", () => {
    const robot = asRobot(new THREE.Group());
    robot.position.set(0.4, 0.5, 1.25);
    robot.rotation.set(0.2, -0.3, 0.4);

    const result = clampStudioPlanarPose(robot, new THREE.Vector3(0, 0, 1));

    expect(result).toMatchObject({
      clamped: true,
      reasons: ["y", "roll", "pitch"],
      floorHeight: 0,
    });
    expect(robot.position.toArray()).toEqual([0.4, 0.5, 0]);
    expect(robot.rotation.x).toBe(0);
    expect(robot.rotation.y).toBe(0);
    expect(robot.rotation.z).toBeCloseTo(0.4);
  });

  it("clamps y-up runtime poses through the planar safety helper", () => {
    const robot = asRobot(new THREE.Group());
    robot.position.set(0.4, 1.25, 0.5);
    robot.rotation.set(0.2, -0.3, 0.4);

    const result = clampStudioPlanarPose(robot, new THREE.Vector3(0, 1, 0));

    expect(result).toMatchObject({
      clamped: true,
      reasons: ["y", "roll", "pitch"],
      floorHeight: 0,
    });
    expect(robot.position.toArray()).toEqual([0.4, 0, 0.5]);
    expect(robot.rotation.x).toBe(0);
    expect(robot.rotation.y).toBeCloseTo(-0.3);
    expect(robot.rotation.z).toBe(0);
  });

  it("uses a shallow camera-like link as the robot front hint", () => {
    const { robot } = createRobotWithCameraLink();

    const direction = resolveBaseCameraLikeLinkForwardLocal({
      robot,
      rootLinkName: "base_link",
      worldUp: new THREE.Vector3(0, 0, 1),
    });

    expect(direction?.dot(ROBOT_FRONT_LOCAL_FORWARD)).toBeGreaterThan(0.99);
  });

  it("uses a base camera attachment as the robot front hint", () => {
    const { robot } = createRobotWithCameraLink();
    const camera = {
      parent_joint: "camera_joint",
      pose: {
        xyz: [2, 0, 0],
        rpy: [0, 0, 0],
      },
    } as RobotCamera;

    const direction = resolveBaseCameraForwardLocal({
      robot,
      cameras: [camera],
      rootLinkName: "base_link",
      worldUp: new THREE.Vector3(0, 0, 1),
    });

    expect(direction?.dot(ROBOT_FRONT_LOCAL_FORWARD)).toBeGreaterThan(0.99);
  });
});
