import { describe, expect, it } from "vitest";
import type { OperatorGatewayStateFrame } from "@/features/teleop/transport/operatorHelperApi";
import { buildOperatorGatewayJointTelemetry } from "@/features/teleop/perception/operatorGatewayTelemetry";

const TEST_GATEWAY_TELEMETRY = {
  sourceId: "gateway",
  sourceLabel: "Robot gateway",
  sourceTsMs: 42_000,
  shoulderPositionRad: 0.25,
  shoulderVelocityRadPerSec: 0.12,
  shoulderTorqueNm: -0.34,
  shoulderTempMosC: 38,
  shoulderTempRotorC: 41,
  gripperPositionRad: -0.1,
} as const;

const buildState = (
  overrides: Partial<OperatorGatewayStateFrame> = {},
): OperatorGatewayStateFrame => ({
  robotId: "openarm",
  adapterId: "fake_openarm",
  profileId: "real_hardware",
  sequence: 7,
  sourceTsMs: TEST_GATEWAY_TELEMETRY.sourceTsMs,
  mode: "manual",
  estop: false,
  heartbeatOk: true,
  jointPositionsRad: {
    shoulder: TEST_GATEWAY_TELEMETRY.shoulderPositionRad,
  },
  gripperPositionsRad: {
    gripper: TEST_GATEWAY_TELEMETRY.gripperPositionRad,
  },
  jointTelemetry: {},
  hardwareMotionSafety: {
    motionReady: true,
    authoritativeJointFeedbackReady: true,
    jointRotationCalibrationReady: true,
    jointRotationCalibrationRequired: false,
    jointRotationCalibrationId: "test-calibration",
    selfCollisionPreflightReady: true,
    gripperMotionEnabled: false,
    lastRejectReason: null,
  },
  ...overrides,
});

describe("operatorGatewayTelemetry", () => {
  it("converts gateway joint and gripper positions to live joint telemetry", () => {
    const telemetry = buildOperatorGatewayJointTelemetry({
      state: buildState(),
      sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
      sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
    });

    expect(telemetry.shoulder).toMatchObject({
      positionRad: TEST_GATEWAY_TELEMETRY.shoulderPositionRad,
      sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
      sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
      sourceTsMs: TEST_GATEWAY_TELEMETRY.sourceTsMs,
    });
    expect(telemetry.gripper?.positionRad).toBe(
      TEST_GATEWAY_TELEMETRY.gripperPositionRad,
    );
    expect(Number.isNaN(telemetry.shoulder?.velocityRadPerSec)).toBe(true);
  });

  it("preserves rich gateway joint telemetry when present", () => {
    const telemetry = buildOperatorGatewayJointTelemetry({
      state: buildState({
        jointTelemetry: {
          shoulder: {
            positionRad: TEST_GATEWAY_TELEMETRY.shoulderPositionRad,
            velocityRadPerSec: TEST_GATEWAY_TELEMETRY.shoulderVelocityRadPerSec,
            torqueNm: TEST_GATEWAY_TELEMETRY.shoulderTorqueNm,
            tempMosC: TEST_GATEWAY_TELEMETRY.shoulderTempMosC,
            tempRotorC: TEST_GATEWAY_TELEMETRY.shoulderTempRotorC,
            faultCode: null,
          },
        },
      }),
      sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
      sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
    });

    expect(telemetry.shoulder).toMatchObject({
      velocityRadPerSec: TEST_GATEWAY_TELEMETRY.shoulderVelocityRadPerSec,
      torqueNm: TEST_GATEWAY_TELEMETRY.shoulderTorqueNm,
      tempMos: TEST_GATEWAY_TELEMETRY.shoulderTempMosC,
      tempRotor: TEST_GATEWAY_TELEMETRY.shoulderTempRotorC,
    });
  });

  it("ignores non-finite gateway joint positions", () => {
    const telemetry = buildOperatorGatewayJointTelemetry({
      state: buildState({
        jointPositionsRad: {
          shoulder: Number.NaN,
        },
      }),
      sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
      sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
    });

    expect(telemetry.shoulder).toBeUndefined();
    expect(telemetry.gripper?.positionRad).toBe(
      TEST_GATEWAY_TELEMETRY.gripperPositionRad,
    );
  });

  it("does not publish gateway telemetry before robot feedback is authoritative", () => {
    const readyState = buildState();

    expect(
      buildOperatorGatewayJointTelemetry({
        state: buildState({ heartbeatOk: false }),
        sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
        sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
      }),
    ).toEqual({});
    expect(
      buildOperatorGatewayJointTelemetry({
        state: buildState({
          hardwareMotionSafety: {
            ...readyState.hardwareMotionSafety,
            authoritativeJointFeedbackReady: false,
          },
        }),
        sourceId: TEST_GATEWAY_TELEMETRY.sourceId,
        sourceLabel: TEST_GATEWAY_TELEMETRY.sourceLabel,
      }),
    ).toEqual({});
  });
});
