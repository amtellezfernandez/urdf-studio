import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { toThreeViewQuaternionFromUrdf } from "./cameraOrientationContract";
import {
  resolveCameraPoseAtBoundsCenter,
  resolveCameraPoseAtLocalPointFacingOutward,
} from "./cameraAutoPlacement";

const ASYMMETRIC_CAMERA_BOUNDS_CASE_A_MIN: [number, number, number] = [-0.019308, -0.022972, -0.034002];
const ASYMMETRIC_CAMERA_BOUNDS_CASE_A_MAX: [number, number, number] = [0.008464, 0.024157, 0.010567];
const ASYMMETRIC_CAMERA_BOUNDS_CASE_B_MIN: [number, number, number] = [-0.022471, -0.035201, -0.031489];
const ASYMMETRIC_CAMERA_BOUNDS_CASE_B_MAX: [number, number, number] = [0.016937, 0.009768, 0.017909];
const UNIT_BOUNDS_MIN: [number, number, number] = [-0.01, -0.01, -0.01];
const UNIT_BOUNDS_MAX: [number, number, number] = [0.01, 0.01, 0.01];
const FORWARD_ALIGNMENT_THRESHOLD = 0.999;
const CAMERA_LINK_POSITIVE_X = new THREE.Vector3(1, 0, 0);
const CAMERA_LINK_POSITIVE_Z = new THREE.Vector3(0, 0, 1);
const LOCAL_FORWARD_HINT_POSITIVE_Y = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD_HINT_NEGATIVE_X = new THREE.Vector3(-1, 0, 0);
const LOCAL_FALLBACK_HINT_POSITIVE_Z = new THREE.Vector3(0, 0, 1);
const LOCAL_UP_HINT_POSITIVE_Y = new THREE.Vector3(0, 1, 0);
const UP_ALIGNMENT_THRESHOLD = 0.99;
const LOCAL_CAMERA_ORIGIN = new THREE.Vector3(0, 0, 0);
const ROBOT_BASE_MESH_SIZE = 0.4;
const THREE_VIEW_FORWARD = new THREE.Vector3(0, 0, -1);

const createBounds = (
  min: [number, number, number],
  max: [number, number, number]
) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
const createRobotWithBaseMesh = () => {
  const robotRoot = new THREE.Group();
  const baseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(ROBOT_BASE_MESH_SIZE, ROBOT_BASE_MESH_SIZE, ROBOT_BASE_MESH_SIZE)
  );
  robotRoot.add(baseMesh);
  return robotRoot as unknown as URDFRobot;
};
const resolveForwardFromPose = (pose: { rpy: [number, number, number] }) =>
  new THREE.Vector3(1, 0, 0)
    .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rpy, "ZYX")))
    .normalize();
const resolveUpFromPose = (pose: { rpy: [number, number, number] }) =>
  new THREE.Vector3(0, 0, 1)
    .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rpy, "ZYX")))
    .normalize();
const resolveDisplayForwardFromPose = (pose: { rpy: [number, number, number] }) => {
  const urdfQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rpy, "ZYX"));
  const displayQuaternion = toThreeViewQuaternionFromUrdf(urdfQuaternion);
  return THREE_VIEW_FORWARD.clone().applyQuaternion(displayQuaternion).normalize();
};

describe("resolveCameraPoseAtBoundsCenter", () => {
  it("returns local center for asymmetric camera bounds case A", () => {
    const bounds = createBounds(
      ASYMMETRIC_CAMERA_BOUNDS_CASE_A_MIN,
      ASYMMETRIC_CAMERA_BOUNDS_CASE_A_MAX
    );

    const pose = resolveCameraPoseAtBoundsCenter(bounds);

    expect(pose.xyz[0]).toBeCloseTo(-0.005422, 6);
    expect(pose.xyz[1]).toBeCloseTo(0.0005925, 6);
    expect(pose.xyz[2]).toBeCloseTo(-0.0117175, 6);
    expect(pose.rpy).toEqual([0, 0, 0]);
  });

  it("returns local center for asymmetric camera bounds case B", () => {
    const bounds = createBounds(
      ASYMMETRIC_CAMERA_BOUNDS_CASE_B_MIN,
      ASYMMETRIC_CAMERA_BOUNDS_CASE_B_MAX
    );

    const pose = resolveCameraPoseAtBoundsCenter(bounds);

    expect(pose.xyz[0]).toBeCloseTo(-0.002767, 6);
    expect(pose.xyz[1]).toBeCloseTo(-0.0127165, 6);
    expect(pose.xyz[2]).toBeCloseTo(-0.00679, 6);
    expect(pose.rpy).toEqual([0, 0, 0]);
  });

  it("returns origin center for symmetric bounds", () => {
    const bounds = createBounds(UNIT_BOUNDS_MIN, UNIT_BOUNDS_MAX);

    const pose = resolveCameraPoseAtBoundsCenter(bounds);

    expect(pose.xyz).toEqual([0, 0, 0]);
    expect(pose.rpy).toEqual([0, 0, 0]);
  });
});

describe("resolveCameraPoseAtLocalPointFacingOutward", () => {
  it("orients camera forward away from robot center for positive X mount", () => {
    const robot = createRobotWithBaseMesh();
    const cameraLink = new THREE.Group();
    cameraLink.position.copy(CAMERA_LINK_POSITIVE_X);
    robot.add(cameraLink);
    robot.updateMatrixWorld(true);

    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, robot);
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });

  it("stays numerically stable when outward vector is parallel to world up", () => {
    const robot = createRobotWithBaseMesh();
    const cameraLink = new THREE.Group();
    cameraLink.position.copy(CAMERA_LINK_POSITIVE_Z);
    robot.add(cameraLink);
    robot.updateMatrixWorld(true);

    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, robot);
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
    pose.rpy.forEach((value) => {
      expect(Number.isFinite(value)).toBe(true);
    });
  });

  it("falls back to default local forward when robot context is missing", () => {
    const cameraLink = new THREE.Group();
    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, null);
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });

  it("uses preferred local forward hint when provided", () => {
    const cameraLink = new THREE.Group();
    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, null, {
      preferredForwardLocal: LOCAL_FORWARD_HINT_POSITIVE_Y,
    });
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });

  it("keeps preferred local forward sign when provided", () => {
    const robot = createRobotWithBaseMesh();
    const cameraLink = new THREE.Group();
    cameraLink.position.copy(CAMERA_LINK_POSITIVE_X);
    robot.add(cameraLink);
    robot.updateMatrixWorld(true);

    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, robot, {
      preferredForwardLocal: LOCAL_FORWARD_HINT_NEGATIVE_X,
    });
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(-1, 0, 0))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });

  it("uses fallback forward when outward cannot be resolved", () => {
    const cameraLink = new THREE.Group();
    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, null, {
      fallbackForwardLocal: LOCAL_FALLBACK_HINT_POSITIVE_Z,
    });
    const forward = resolveForwardFromPose(pose);
    expect(forward.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });

  it("honors preferred up hint to stabilize roll with mesh orientation", () => {
    const cameraLink = new THREE.Group();
    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, null, {
      preferredForwardLocal: new THREE.Vector3(1, 0, 0),
      preferredUpLocal: LOCAL_UP_HINT_POSITIVE_Y,
    });
    const up = resolveUpFromPose(pose);
    expect(up.dot(LOCAL_UP_HINT_POSITIVE_Y)).toBeGreaterThan(UP_ALIGNMENT_THRESHOLD);
  });

  it("keeps icon display forward aligned with solved URDF forward", () => {
    const cameraLink = new THREE.Group();
    const pose = resolveCameraPoseAtLocalPointFacingOutward(cameraLink, LOCAL_CAMERA_ORIGIN, null, {
      preferredForwardLocal: LOCAL_FORWARD_HINT_POSITIVE_Y,
    });
    const urdfForward = resolveForwardFromPose(pose);
    const displayForward = resolveDisplayForwardFromPose(pose);
    expect(displayForward.dot(urdfForward)).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);
  });
});
