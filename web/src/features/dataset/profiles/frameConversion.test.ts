import { describe, expect, it } from "vitest";

import { convertDatasetRowsToRecordedFrames } from "@/features/dataset/profiles/frameConversion";
import { resolveDatasetSignalProfile } from "@/features/dataset/profiles/semanticDetection";
import { JOINT_VALUE_CONVERSION_PARAMS } from "@/shared/lib/urdfBrowser";

describe("convertDatasetRowsToRecordedFrames", () => {
  it("maps joint channels and integrates planar base twist into base pose", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_a.pos", "x.vel", "y.vel", "theta.vel"],
    });

    // Use dt=500ms and velocity=2 m/s so integration stays within maxTwistIntegrationDtSec cap
    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [1, 2, 0, 0] },
        { timestampMs: 500, values: [2, 2, 0, 0] },
      ],
      {
        signalProfile,
      }
    );

    expect(result.usedPlanarTwist).toBe(true);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0].jointPositions.joint_a).toBe(1);
    expect(result.frames[1].jointPositions.joint_a).toBe(2);
    expect(result.frames[1].basePose?.position.x).toBeCloseTo(1, 6);
    expect(result.frames[1].basePose?.position.y).toBeCloseTo(0, 6);
  });

  it("supports mapped joints and optional degree conversion", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [{ timestampMs: 0, values: [180] }],
      {
        signalProfile,
        jointMapping: { joint_0: "shoulder" },
        degToRad: true,
      }
    );

    expect(result.frames[0].jointPositions.shoulder).toBeCloseTo(Math.PI, 8);
  });

  it("applies joint conversion in dialog order: deg/rad, invert, then offset", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [{ timestampMs: 0, values: [90] }],
      {
        signalProfile,
        jointMapping: { joint_0: "shoulder" },
        jointInversions: { joint_0: true },
        jointOffsets: { joint_0: 0.1 },
        degToRad: true,
      }
    );

    // 90deg -> pi/2, inverted => -pi/2, then +0.1 offset
    expect(result.frames[0].jointPositions.shoulder).toBeCloseTo(
      -Math.PI / 2 + 0.1,
      8
    );
  });

  it("converts servo ticks to radians when angular auto-conversion is enabled", () => {
    const servoTickNeutral = JOINT_VALUE_CONVERSION_PARAMS.servoTickNeutral;
    const servoTickQuarterTurn =
      JOINT_VALUE_CONVERSION_PARAMS.servoTickFullScale / 2;
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_0.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [servoTickNeutral] },
        {
          timestampMs: 1000,
          values: [servoTickNeutral + servoTickQuarterTurn],
        },
      ],
      {
        signalProfile,
        jointMapping: { joint_0: "shoulder" },
        degToRad: true,
      }
    );

    expect(result.frames[0].jointPositions.shoulder).toBeCloseTo(0, 8);
    expect(result.frames[1].jointPositions.shoulder).toBeCloseTo(
      Math.PI / 2,
      8
    );
  });

  it("normalizes oversized prismatic gripper ranges into URDF limits", () => {
    const prismaticGripperClosedMeters = 0;
    const prismaticGripperOpenRaw =
      JOINT_VALUE_CONVERSION_PARAMS.normalizedInputUpper;
    const prismaticGripperOpenMeters = 0.044;
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["gripper.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [prismaticGripperClosedMeters] },
        { timestampMs: 1000, values: [prismaticGripperOpenRaw] },
      ],
      {
        signalProfile,
        jointMapping: { gripper: "finger_joint1" },
        degToRad: true,
        jointLimits: {
          finger_joint1: {
            type: "prismatic",
            lower: prismaticGripperClosedMeters,
            upper: prismaticGripperOpenMeters,
          },
        },
      }
    );

    expect(result.frames[0].jointPositions.finger_joint1).toBeCloseTo(
      prismaticGripperClosedMeters,
      8
    );
    expect(result.frames[1].jointPositions.finger_joint1).toBeCloseTo(
      prismaticGripperOpenMeters,
      8
    );
  });

  it("keeps prismatic gripper values that already fit the target limits", () => {
    const prismaticGripperClosedMeters = 0;
    const prismaticGripperOpenMeters = 0.044;
    const alreadyMetersGripperSample = prismaticGripperOpenMeters / 2;
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["gripper.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [{ timestampMs: 0, values: [alreadyMetersGripperSample] }],
      {
        signalProfile,
        jointMapping: { gripper: "finger_joint1" },
        degToRad: true,
        jointLimits: {
          finger_joint1: {
            type: "prismatic",
            lower: prismaticGripperClosedMeters,
            upper: prismaticGripperOpenMeters,
          },
        },
      }
    );

    expect(result.frames[0].jointPositions.finger_joint1).toBeCloseTo(
      alreadyMetersGripperSample,
      8
    );
  });

  it("keeps skipped joint channels visible for episode curves", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["left_wheel_joint.pos", "right_wheel_joint.pos"],
    });

    const result = convertDatasetRowsToRecordedFrames(
      [{ timestampMs: 0, values: [1, -1] }],
      {
        signalProfile,
        jointMapping: {
          left_wheel_joint: "?",
          right_wheel_joint: "?",
        },
      }
    );

    expect(result.frames[0].jointPositions.left_wheel_joint).toBe(1);
    expect(result.frames[0].jointPositions.right_wheel_joint).toBe(-1);
  });

  it("converts explicit planar base pose channels from mm/deg to base pose", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_a.pos", "base_x_mm", "base_y_mm", "theta_deg"],
      robotTypeHint: "lekiwi",
    });

    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [1, 0, 0, 0] },
        { timestampMs: 1000, values: [2, 100, -200, 90] },
      ],
      {
        signalProfile,
      }
    );

    expect(result.usedPlanarTwist).toBe(true);
    expect(result.frames[1].jointPositions.joint_a).toBe(2);
    expect(result.frames[1].basePose?.position.x).toBeCloseTo(0.1, 8);
    expect(result.frames[1].basePose?.position.y).toBeCloseTo(-0.2, 8);
    expect(result.frames[1].basePose?.quaternion.z).toBeCloseTo(
      Math.SQRT1_2,
      8
    );
    expect(result.frames[1].basePose?.quaternion.w).toBeCloseTo(
      Math.SQRT1_2,
      8
    );
  });

  it("treats generic x_mm/y_mm/theta channels as twist-like commands", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_a.pos", "x_mm", "y_mm", "theta"],
      robotTypeHint: "lekiwi",
    });

    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [1, 100, 0, 0] },
        { timestampMs: 500, values: [2, 100, 0, 0] },
      ],
      {
        signalProfile,
      }
    );

    expect(result.usedPlanarTwist).toBe(true);
    expect(result.frames[0].jointPositions.x_mm).toBe(100);
    expect(result.frames[0].jointPositions.y_mm).toBe(0);
    expect(result.frames[0].jointPositions.theta).toBe(0);
    expect(result.frames[1].basePose?.position.x).toBeCloseTo(0.05, 8);
    expect(result.frames[1].basePose?.position.y).toBeCloseTo(0, 8);
  });

  it("treats plain theta base-pose values as radians when bounded by 2pi", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_a.pos", "base_x_mm", "base_y_mm", "base_theta"],
      robotTypeHint: "lekiwi",
    });

    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [1, 0, 0, 0] },
        { timestampMs: 1000, values: [2, 100, -200, Math.PI / 2] },
      ],
      {
        signalProfile,
      }
    );

    expect(result.frames[1].basePose?.quaternion.z).toBeCloseTo(
      Math.SQRT1_2,
      8
    );
    expect(result.frames[1].basePose?.quaternion.w).toBeCloseTo(
      Math.SQRT1_2,
      8
    );
  });

  it("treats theta.vel as rad/s when values are bounded by 2pi", () => {
    const signalProfile = resolveDatasetSignalProfile({
      featureNames: ["joint_a.pos", "x.vel", "y.vel", "theta.vel"],
    });

    // Use dt=500ms and thetaVel=π rad/s so integration stays within maxTwistIntegrationDtSec cap
    // Yields π/2 rad of yaw (same rotation as the original 1s * π/2 rad/s)
    const result = convertDatasetRowsToRecordedFrames(
      [
        { timestampMs: 0, values: [1, 1, 0, 0] },
        { timestampMs: 500, values: [2, 1, 0, Math.PI] },
      ],
      {
        signalProfile,
      }
    );

    expect(result.frames[1].basePose?.quaternion.z).toBeCloseTo(
      Math.SQRT1_2,
      6
    );
    expect(result.frames[1].basePose?.quaternion.w).toBeCloseTo(
      Math.SQRT1_2,
      6
    );
  });

});
