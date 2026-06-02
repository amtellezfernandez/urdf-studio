import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  CAMERA_ICON_ENVELOPE_MIN_EDGE_M,
} from "./cameraIconParams";
import {
  computeOwnedLinkDominantBasisFrameCue,
  resolveCameraLinkEnvelope,
} from "./cameraEnvelopeFit";

const CAMERA_LINK_NAME = "camera_link";
const NON_CAMERA_LINK_NAME = "wrist_link";
const CAMERA_JOINT_NAME = "camera_joint";
const LINK_BOX_SIZE_X = 0.08;
const LINK_BOX_SIZE_Y = 0.04;
const LINK_BOX_SIZE_Z = 0.02;
const LINK_BOX_OFFSET_X = 0.015;
const LINK_BOX_OFFSET_Y = -0.01;
const LINK_BOX_OFFSET_Z = 0.005;
const PLANE_WIDTH = 0.06;
const PLANE_HEIGHT = 0.02;
const ROTATED_BOX_SIZE_X = 0.1;
const ROTATED_BOX_SIZE_Y = 0.05;
const ROTATED_BOX_SIZE_Z = 0.03;
const ROTATED_BOX_YAW_RAD = Math.PI / 4;
const ORIENTATION_ALIGNMENT_THRESHOLD = 0.999;

const createRobotWithJointAndLink = (
  linkName: string,
  mesh: THREE.Object3D,
  jointName = CAMERA_JOINT_NAME
) => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  const link = new THREE.Group();
  link.name = linkName;
  link.add(mesh);
  const joint = new THREE.Group() as THREE.Group & { childLink?: string };
  joint.name = jointName;
  joint.childLink = linkName;

  robot.add(joint);
  robot.add(link);
  (robot as URDFRobot & { links: URDFRobot["links"] }).links = {
    [linkName]: link,
  } as unknown as URDFRobot["links"];
  (robot as URDFRobot & { joints: URDFRobot["joints"] }).joints = {
    [jointName]: joint,
  } as unknown as URDFRobot["joints"];
  robot.updateMatrixWorld(true);
  return robot;
};

describe("resolveCameraLinkEnvelope", () => {
  it("returns a fitted envelope for camera-prefixed links", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(LINK_BOX_SIZE_X, LINK_BOX_SIZE_Y, LINK_BOX_SIZE_Z)
    );
    mesh.position.set(LINK_BOX_OFFSET_X, LINK_BOX_OFFSET_Y, LINK_BOX_OFFSET_Z);
    const robot = createRobotWithJointAndLink(CAMERA_LINK_NAME, mesh);

    const envelope = resolveCameraLinkEnvelope(robot, CAMERA_JOINT_NAME);
    expect(envelope).not.toBeNull();
    expect(envelope!.localCenter.x).toBeCloseTo(LINK_BOX_OFFSET_X, 8);
    expect(envelope!.localCenter.y).toBeCloseTo(LINK_BOX_OFFSET_Y, 8);
    expect(envelope!.localCenter.z).toBeCloseTo(LINK_BOX_OFFSET_Z, 8);
    expect(envelope!.localSize.x).toBeCloseTo(LINK_BOX_SIZE_X, 8);
    expect(envelope!.localSize.y).toBeCloseTo(LINK_BOX_SIZE_Y, 8);
    expect(envelope!.localSize.z).toBeCloseTo(LINK_BOX_SIZE_Z, 8);
    expect(envelope!.localQuaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 8);
  });

  it("returns null for non-camera links", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(LINK_BOX_SIZE_X, LINK_BOX_SIZE_Y, LINK_BOX_SIZE_Z)
    );
    const robot = createRobotWithJointAndLink(NON_CAMERA_LINK_NAME, mesh);

    const envelope = resolveCameraLinkEnvelope(robot, CAMERA_JOINT_NAME);
    expect(envelope).toBeNull();
  });

  it("clamps thin geometry depth to minimum envelope edge", () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT));
    const robot = createRobotWithJointAndLink(CAMERA_LINK_NAME, mesh);

    const envelope = resolveCameraLinkEnvelope(robot, CAMERA_JOINT_NAME);
    expect(envelope).not.toBeNull();
    expect(envelope!.localSize.z).toBeCloseTo(CAMERA_ICON_ENVELOPE_MIN_EDGE_M, 12);
  });

  it("keeps envelope axes parallel to rotated dominant mesh basis", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROTATED_BOX_SIZE_X,
        ROTATED_BOX_SIZE_Y,
        ROTATED_BOX_SIZE_Z
      )
    );
    mesh.rotation.z = ROTATED_BOX_YAW_RAD;
    const robot = createRobotWithJointAndLink(CAMERA_LINK_NAME, mesh);

    const envelope = resolveCameraLinkEnvelope(robot, CAMERA_JOINT_NAME);
    expect(envelope).not.toBeNull();
    const envelopeXAxis = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(envelope!.localQuaternion)
      .normalize();
    const expectedXAxis = new THREE.Vector3(1, 0, 0)
      .applyEuler(new THREE.Euler(0, 0, ROTATED_BOX_YAW_RAD, "XYZ"))
      .normalize();
    expect(Math.abs(envelopeXAxis.dot(expectedXAxis))).toBeGreaterThan(
      ORIENTATION_ALIGNMENT_THRESHOLD
    );
    expect(envelope!.localSize.x).toBeCloseTo(ROTATED_BOX_SIZE_X, 8);
    expect(envelope!.localSize.y).toBeCloseTo(ROTATED_BOX_SIZE_Y, 8);
    expect(envelope!.localSize.z).toBeCloseTo(ROTATED_BOX_SIZE_Z, 8);
  });

  it("returns dominant basis frame cue aligned with envelope axes", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROTATED_BOX_SIZE_X,
        ROTATED_BOX_SIZE_Y,
        ROTATED_BOX_SIZE_Z
      )
    );
    mesh.rotation.z = ROTATED_BOX_YAW_RAD;
    const robot = createRobotWithJointAndLink(CAMERA_LINK_NAME, mesh);
    const linkObject = robot.links?.[CAMERA_LINK_NAME];
    expect(linkObject).toBeTruthy();

    const desiredForward = new THREE.Vector3(1, 0, 0)
      .applyEuler(new THREE.Euler(0, 0, ROTATED_BOX_YAW_RAD, "XYZ"))
      .normalize();
    const frameCue = computeOwnedLinkDominantBasisFrameCue(linkObject!, desiredForward);
    const envelope = resolveCameraLinkEnvelope(robot, CAMERA_JOINT_NAME);
    expect(frameCue).not.toBeNull();
    expect(envelope).not.toBeNull();

    const envelopeForward = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(envelope!.localQuaternion)
      .normalize();
    const envelopeUp = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(envelope!.localQuaternion)
      .normalize();

    expect(Math.abs(frameCue!.forward.dot(envelopeForward))).toBeGreaterThan(
      ORIENTATION_ALIGNMENT_THRESHOLD
    );
    expect(Math.abs(frameCue!.up.dot(envelopeUp))).toBeGreaterThan(
      ORIENTATION_ALIGNMENT_THRESHOLD
    );
  });
});
