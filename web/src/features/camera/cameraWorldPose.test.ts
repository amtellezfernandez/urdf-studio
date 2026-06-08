import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  buildCameraTransformDebugReport,
  getCameraWorldPose,
  remapCameraPoseBetweenParentJoints,
  remapCameraPoseToParentJointFrame,
  resolveCameraParentJointObject,
} from "@/features/camera/cameraWorldPose";

const REPLAY_CAMERA_POSITION_PRECISION_DECIMALS = 8;
const REPLAY_CAMERA_FIXTURE = {
  parentJoint: "camera_mount_joint",
  localPose: {
    xyz: [0.2, 0, 0] as [number, number, number],
    rpy: [0, 0, 0] as [number, number, number],
  },
  initialRobotPosition: { x: 0.1, y: -0.2, z: 0.05 },
  movedRobotPosition: { x: 0.65, y: -0.2, z: 0.05 },
} as const;

describe("cameraWorldPose", () => {
  it("resolves encoded parent joint names", () => {
    const root = new THREE.Group();
    const joint = new THREE.Group();
    joint.name = "shoulder pan";
    root.add(joint);
    (root as unknown as URDFRobot).joints = {
      "shoulder pan": joint,
    } as unknown as URDFRobot["joints"];
    root.updateMatrixWorld(true);

    const resolved = resolveCameraParentJointObject(
      root as unknown as URDFRobot,
      "shoulder%20pan"
    );
    expect(resolved).toBe(joint);
  });

  it("computes world pose from parent transform and local camera pose", () => {
    const root = new THREE.Group();
    const joint = new THREE.Group();
    joint.name = "base_joint";
    joint.position.set(1, -0.5, 0.25);
    joint.rotation.set(0.1, -0.2, 0.3, "XYZ");
    root.add(joint);
    (root as unknown as URDFRobot).joints = {
      base_joint: joint,
    } as unknown as URDFRobot["joints"];
    root.updateMatrixWorld(true);

    const pose = {
      xyz: [0.08, -0.03, 0.05] as [number, number, number],
      rpy: [0.12, -0.08, 0.25] as [number, number, number],
    };
    const result = getCameraWorldPose(
      root as unknown as URDFRobot,
      { parent_joint: "base_joint", pose },
      { updateRobotWorld: true }
    );

    const local = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(...pose.rpy, "ZYX"))
      .setPosition(new THREE.Vector3(...pose.xyz));
    const expectedMatrix = new THREE.Matrix4().copy(joint.matrixWorld).multiply(local);
    const expectedPosition = new THREE.Vector3();
    const expectedQuat = new THREE.Quaternion();
    expectedMatrix.decompose(expectedPosition, expectedQuat, new THREE.Vector3());

    expect(result.position.distanceTo(expectedPosition)).toBeLessThan(1e-8);
    expect(result.quaternion.angleTo(expectedQuat)).toBeLessThan(1e-7);
  });

  it("keeps viewer cameras attached to replayed robot base movement", () => {
    const root = new THREE.Group();
    const joint = new THREE.Group();
    joint.name = REPLAY_CAMERA_FIXTURE.parentJoint;
    root.add(joint);
    (root as unknown as URDFRobot).joints = {
      [REPLAY_CAMERA_FIXTURE.parentJoint]: joint,
    } as unknown as URDFRobot["joints"];

    const cameraConfig = {
      parent_joint: REPLAY_CAMERA_FIXTURE.parentJoint,
      pose: REPLAY_CAMERA_FIXTURE.localPose,
    };

    root.position.set(
      REPLAY_CAMERA_FIXTURE.initialRobotPosition.x,
      REPLAY_CAMERA_FIXTURE.initialRobotPosition.y,
      REPLAY_CAMERA_FIXTURE.initialRobotPosition.z
    );
    const initialPose = getCameraWorldPose(root as unknown as URDFRobot, cameraConfig, {
      updateRobotWorld: true,
    });

    root.position.set(
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.x,
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.y,
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.z
    );
    const movedPose = getCameraWorldPose(root as unknown as URDFRobot, cameraConfig, {
      updateRobotWorld: true,
    });

    expect(initialPose.position.x).toBeCloseTo(
      REPLAY_CAMERA_FIXTURE.initialRobotPosition.x + REPLAY_CAMERA_FIXTURE.localPose.xyz[0],
      REPLAY_CAMERA_POSITION_PRECISION_DECIMALS
    );
    expect(movedPose.position.x).toBeCloseTo(
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.x + REPLAY_CAMERA_FIXTURE.localPose.xyz[0],
      REPLAY_CAMERA_POSITION_PRECISION_DECIMALS
    );
    expect(movedPose.position.y).toBeCloseTo(
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.y,
      REPLAY_CAMERA_POSITION_PRECISION_DECIMALS
    );
    expect(movedPose.position.z).toBeCloseTo(
      REPLAY_CAMERA_FIXTURE.movedRobotPosition.z,
      REPLAY_CAMERA_POSITION_PRECISION_DECIMALS
    );
  });

  it("falls back to local pose when parent joint is missing", () => {
    const pose = {
      xyz: [0.2, 0.1, -0.05] as [number, number, number],
      rpy: [0.4, -0.1, 0.2] as [number, number, number],
    };
    const result = getCameraWorldPose(null, {
      parent_joint: "missing_joint",
      pose,
    });
    const expectedQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...pose.rpy, "ZYX")
    );
    expect(result.position.distanceTo(new THREE.Vector3(...pose.xyz))).toBeLessThan(1e-8);
    expect(result.quaternion.angleTo(expectedQuat)).toBeLessThan(1e-8);
  });

  it("remaps link-relative pose into the selected parent joint frame", () => {
    const root = new THREE.Group();

    const sourceLink = new THREE.Group();
    sourceLink.name = "camera_source_link";
    sourceLink.position.set(0.35, -0.2, 0.1);
    sourceLink.rotation.set(0.05, -0.1, 0.12, "XYZ");
    root.add(sourceLink);

    const cameraJoint = new THREE.Group() as THREE.Group & { childLink?: string };
    cameraJoint.name = "camera_mount_joint";
    cameraJoint.childLink = "camera_mount_link";
    cameraJoint.position.set(-0.18, 0.26, 0.22);
    cameraJoint.rotation.set(-0.07, 0.18, -0.22, "XYZ");
    root.add(cameraJoint);

    const jointChildLink = new THREE.Group();
    jointChildLink.name = "camera_mount_link";
    root.add(jointChildLink);

    (root as unknown as URDFRobot).joints = {
      camera_mount_joint: cameraJoint,
    } as unknown as URDFRobot["joints"];
    (root as unknown as URDFRobot).links = {
      camera_source_link: sourceLink,
      camera_mount_link: jointChildLink,
    } as unknown as URDFRobot["links"];
    root.updateMatrixWorld(true);

    const sourcePose = {
      xyz: [0.09, -0.04, 0.03] as [number, number, number],
      rpy: [0.14, -0.06, 0.18] as [number, number, number],
    };

    const localPoseMatrix = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(...sourcePose.rpy, "ZYX"))
      .setPosition(new THREE.Vector3(...sourcePose.xyz));
    const expectedLocalMatrix = new THREE.Matrix4()
      .copy(cameraJoint.matrixWorld)
      .invert()
      .multiply(new THREE.Matrix4().copy(sourceLink.matrixWorld).multiply(localPoseMatrix));
    const expectedPosition = new THREE.Vector3();
    const expectedQuaternion = new THREE.Quaternion();
    expectedLocalMatrix.decompose(expectedPosition, expectedQuaternion, new THREE.Vector3());
    const expectedEuler = new THREE.Euler().setFromQuaternion(expectedQuaternion, "ZYX");
    const actual = remapCameraPoseToParentJointFrame(
      root as unknown as URDFRobot,
      "camera_mount_joint",
      "camera_source_link",
      sourcePose
    );

    expect(actual.xyz[0]).toBeCloseTo(expectedPosition.x, 7);
    expect(actual.xyz[1]).toBeCloseTo(expectedPosition.y, 7);
    expect(actual.xyz[2]).toBeCloseTo(expectedPosition.z, 7);
    expect(actual.rpy[0]).toBeCloseTo(expectedEuler.x, 7);
    expect(actual.rpy[1]).toBeCloseTo(expectedEuler.y, 7);
    expect(actual.rpy[2]).toBeCloseTo(expectedEuler.z, 7);
  });

  it("remaps joint-frame poses between parent joints", () => {
    const root = new THREE.Group();

    const jointA = new THREE.Group();
    jointA.name = "joint_a";
    jointA.position.set(0.1, -0.2, 0.3);
    jointA.rotation.set(0.05, -0.12, 0.07, "XYZ");
    root.add(jointA);

    const jointB = new THREE.Group();
    jointB.name = "joint_b";
    jointB.position.set(-0.3, 0.4, 0.2);
    jointB.rotation.set(-0.08, 0.03, -0.15, "XYZ");
    root.add(jointB);

    (root as unknown as URDFRobot).joints = {
      joint_a: jointA,
      joint_b: jointB,
    } as unknown as URDFRobot["joints"];
    root.updateMatrixWorld(true);

    const poseInA = {
      xyz: [0.02, -0.03, 0.04] as [number, number, number],
      rpy: [0.09, -0.06, 0.11] as [number, number, number],
    };
    const poseInB = remapCameraPoseBetweenParentJoints(
      root as unknown as URDFRobot,
      "joint_a",
      "joint_b",
      poseInA
    );

    const worldFromA = getCameraWorldPose(
      root as unknown as URDFRobot,
      { parent_joint: "joint_a", pose: poseInA },
      { updateRobotWorld: true }
    );
    const worldFromB = getCameraWorldPose(
      root as unknown as URDFRobot,
      { parent_joint: "joint_b", pose: poseInB },
      { updateRobotWorld: true }
    );

    expect(worldFromA.position.distanceTo(worldFromB.position)).toBeLessThan(1e-7);
    expect(worldFromA.quaternion.angleTo(worldFromB.quaternion)).toBeLessThan(1e-7);
  });

  it("builds transform debug report with sensor comparison", () => {
    const root = new THREE.Group();
    const sourceLink = new THREE.Group();
    sourceLink.name = "camera_source_link";
    sourceLink.position.set(0.2, 0.1, 0.4);
    sourceLink.rotation.set(0.1, 0.04, -0.08, "XYZ");
    root.add(sourceLink);

    const cameraJoint = new THREE.Group() as THREE.Group & { childLink?: string };
    cameraJoint.name = "camera_joint";
    cameraJoint.childLink = "camera_source_link";
    cameraJoint.position.set(-0.12, 0.05, 0.2);
    cameraJoint.rotation.set(0.03, -0.09, 0.14, "XYZ");
    root.add(cameraJoint);

    (root as unknown as URDFRobot).joints = {
      camera_joint: cameraJoint,
    } as unknown as URDFRobot["joints"];
    (root as unknown as URDFRobot).links = {
      camera_source_link: sourceLink,
    } as unknown as URDFRobot["links"];
    root.updateMatrixWorld(true);

    const sensorPose = {
      xyz: [0.01, -0.02, 0.03] as [number, number, number],
      rpy: [0.02, -0.01, 0.05] as [number, number, number],
    };
    const cameraPose = remapCameraPoseToParentJointFrame(
      root as unknown as URDFRobot,
      "camera_joint",
      "camera_source_link",
      sensorPose
    );

    const report = buildCameraTransformDebugReport(
      root as unknown as URDFRobot,
      {
        id: "cam_1",
        name: "Camera 1",
        parent_joint: "camera_joint",
        pose: cameraPose,
      },
      [
        {
          name: "sensor_a",
          type: "camera",
          linkName: "camera_source_link",
          origin: sensorPose,
        },
      ]
    );

    expect(report.parent_joint_found).toBe(true);
    expect(report.sensor_link).toBe("camera_source_link");
    expect(report.position_delta_m).toBeLessThan(1e-6);
    expect(report.angle_delta_deg).toBeLessThan(1e-4);
    expect(report.within_tolerance).toBe(true);
  });
});
