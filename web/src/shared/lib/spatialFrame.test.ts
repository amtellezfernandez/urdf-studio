import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  composeUrdfPoseMatrix,
  createIdentityRigidFrame,
  localToWorldPositionInFrame,
  localToWorldQuaternionInFrame,
  updateRigidFrameFromMatrixWorld,
  URDF_CYLINDER_TO_THREE_AXIS_QUATERNION,
  worldToLocalPositionInFrame,
  worldToLocalQuaternionInFrame,
} from "./spatialFrame";

const POSITION_EPSILON = 1e-8;
const QUATERNION_ALIGNMENT_MIN_DOT = 0.999999;
const AXIS_ALIGNMENT_MIN_DOT = 0.999999;
const HALF_PI_RAD = Math.PI / 2;
const RPY_ALIGNMENT_MIN_DOT = 0.999999;

const composeUrdfRpyQuaternionReference = (roll: number, pitch: number, yaw: number) => {
  const halfRoll = roll * 0.5;
  const halfPitch = pitch * 0.5;
  const halfYaw = yaw * 0.5;

  const cr = Math.cos(halfRoll);
  const sr = Math.sin(halfRoll);
  const cp = Math.cos(halfPitch);
  const sp = Math.sin(halfPitch);
  const cy = Math.cos(halfYaw);
  const sy = Math.sin(halfYaw);

  return new THREE.Quaternion(
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy
  ).normalize();
};

describe("spatialFrame", () => {
  it("roundtrips world/local positions and quaternions for a rigid frame", () => {
    const frameMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(1.2, -0.4, 0.8),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2, "XYZ")),
      new THREE.Vector3(1, 1, 1)
    );
    const frame = createIdentityRigidFrame();
    updateRigidFrameFromMatrixWorld(frameMatrix, frame);

    const worldPosition = new THREE.Vector3(2.5, -1.1, 0.6);
    const localPosition = worldToLocalPositionInFrame(frame, worldPosition, new THREE.Vector3());
    const worldRoundtrip = localToWorldPositionInFrame(frame, localPosition, new THREE.Vector3());
    expect(worldRoundtrip.distanceTo(worldPosition)).toBeLessThan(POSITION_EPSILON);

    const worldQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.1, 0.4, 0.9, "XYZ")
    );
    const localQuaternion = worldToLocalQuaternionInFrame(
      frame,
      worldQuaternion,
      new THREE.Quaternion()
    );
    const worldQuaternionRoundtrip = localToWorldQuaternionInFrame(
      frame,
      localQuaternion,
      new THREE.Quaternion()
    );
    const alignment = Math.abs(worldQuaternionRoundtrip.dot(worldQuaternion.normalize()));
    expect(alignment).toBeGreaterThan(QUATERNION_ALIGNMENT_MIN_DOT);
  });

  it("composes URDF pose with center offset in rotated frame without scale inflation", () => {
    const matrix = composeUrdfPoseMatrix(
      {
        xyz: [1, 2, 3],
        rpy: [0, 0, HALF_PI_RAD],
        scale: [2, 3, 4],
        centerOffset: new THREE.Vector3(1, 0, 0),
      },
      new THREE.Matrix4()
    );

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    expect(position.x).toBeCloseTo(1, 8);
    expect(position.y).toBeCloseTo(3, 8);
    expect(position.z).toBeCloseTo(3, 8);
    expect(scale.x).toBeCloseTo(2, 8);
    expect(scale.y).toBeCloseTo(3, 8);
    expect(scale.z).toBeCloseTo(4, 8);
  });

  it("keeps URDF cylinder axis correction aligned with +Z", () => {
    const mappedAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(
      URDF_CYLINDER_TO_THREE_AXIS_QUATERNION
    );
    const dot = mappedAxis.normalize().dot(new THREE.Vector3(0, 0, 1));
    expect(dot).toBeGreaterThan(AXIS_ALIGNMENT_MIN_DOT);
  });

  it("matches URDF fixed-axis rpy composition", () => {
    const roll = 0.31;
    const pitch = -0.67;
    const yaw = 1.12;
    const matrix = composeUrdfPoseMatrix(
      {
        xyz: [0, 0, 0],
        rpy: [roll, pitch, yaw],
      },
      new THREE.Matrix4()
    );
    const actualRotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, actualRotation, scale);

    const expectedRotation = composeUrdfRpyQuaternionReference(roll, pitch, yaw);
    const alignment = Math.abs(actualRotation.normalize().dot(expectedRotation));
    expect(alignment).toBeGreaterThan(RPY_ALIGNMENT_MIN_DOT);
  });
});
