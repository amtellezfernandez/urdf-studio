import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFJoint, URDFLink, URDFRobot } from "urdf-loader";

import {
  buildIkOrientationPayload,
  extractLinkPose,
  getDragModeDisplayName,
  getLiveRobotJoints,
  hasJointMapChanged,
  normalizeIkTargetPoseForRobotBase,
  resolveJointScalarValue,
  resolveRobotObjectByName,
  safeDecode,
} from "@/features/viewer/viewer-helpers";

const asRobot = (object: THREE.Object3D): URDFRobot => object as URDFRobot;
const asLink = (object: THREE.Object3D): URDFLink => object as URDFLink;

const createJoint = (
  jointValue: number | number[],
  angle?: number
): URDFJoint =>
  ({
    jointValue,
    angle,
  }) as URDFJoint;

describe("viewer-helpers", () => {
  it("decodes URI components safely", () => {
    expect(safeDecode("camera%20link")).toBe("camera link");
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("resolves scalar joint values from angle or jointValue", () => {
    expect(resolveJointScalarValue(createJoint([1.5], 2.25))).toBe(2.25);
    expect(resolveJointScalarValue(createJoint([1.5]))).toBe(1.5);
    expect(resolveJointScalarValue(createJoint(0.75))).toBe(0.75);
    expect(resolveJointScalarValue()).toBeUndefined();
  });

  it("resolves robot objects by raw or encoded name", () => {
    const robot = asRobot(new THREE.Group());
    const link = asLink(new THREE.Group());
    link.name = "camera link";
    robot.add(link);
    (robot as URDFRobot & { links?: Record<string, URDFLink> }).links = {
      [link.name]: link,
    };

    expect(resolveRobotObjectByName(robot, "camera link")).toBe(link);
    expect(resolveRobotObjectByName(robot, "camera%20link")).toBe(link);
    expect(resolveRobotObjectByName(robot, "missing")).toBeNull();
  });

  it("extracts world-space link poses", () => {
    const robot = asRobot(new THREE.Group());
    const link = asLink(new THREE.Group());
    link.name = "tool";
    link.position.set(1, 2, 3);
    link.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    robot.add(link);
    (robot as URDFRobot & { links?: Record<string, URDFLink> }).links = {
      tool: link,
    };
    robot.updateMatrixWorld(true);

    const pose = extractLinkPose(robot, "tool");

    expect(pose?.position).toEqual([1, 2, 3]);
    expect(pose?.quaternion[0]).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(pose?.quaternion[3]).toBeCloseTo(Math.sin(Math.PI / 4));
  });

  it("normalizes IK target poses into robot-local coordinates", () => {
    const robot = asRobot(new THREE.Group());
    robot.position.set(1, 0, 0);
    robot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    robot.updateMatrixWorld(true);

    const normalized = normalizeIkTargetPoseForRobotBase(robot, {
      position: [1, 1, 0],
      quaternion: [1, 0, 0, 0],
    });

    expect(normalized.position[0]).toBeCloseTo(1);
    expect(normalized.position[1]).toBeCloseTo(0);
    expect(normalized.position[2]).toBeCloseTo(0);
  });

  it("builds finite IK orientation payloads", () => {
    const payload = buildIkOrientationPayload(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    );

    expect(payload?.wxyz[0]).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(payload?.rotation[0]?.[0]).toBeCloseTo(0, 6);
    expect(buildIkOrientationPayload(new THREE.Quaternion(Number.NaN, 0, 0, 1))).toBeNull();
  });

  it("reads live robot joints and falls back when none are readable", () => {
    const robot = asRobot(new THREE.Group());
    (robot as URDFRobot & { joints?: Record<string, URDFJoint> }).joints = {
      shoulder: createJoint([0.25]),
      elbow: createJoint([Number.NaN]),
    };

    expect(getLiveRobotJoints(robot, { fallback: 1 })).toEqual({ shoulder: 0.25 });
    expect(getLiveRobotJoints(asRobot(new THREE.Group()), { fallback: 1 })).toEqual({
      fallback: 1,
    });
  });

  it("detects joint-map changes", () => {
    expect(hasJointMapChanged({ a: 1 }, null)).toBe(true);
    expect(hasJointMapChanged({ a: 1 }, { a: 1 })).toBe(false);
    expect(hasJointMapChanged({ a: 2 }, { a: 1 })).toBe(true);
    expect(hasJointMapChanged({ a: 1, b: 2 }, { a: 1 })).toBe(true);
  });

  it("maps drag modes to labels", () => {
    expect(getDragModeDisplayName("move-joints")).toBe("Move Joints");
    expect(getDragModeDisplayName("drag-handle")).toBe("Drag Handle");
  });
});
