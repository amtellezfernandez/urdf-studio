import { describe, expect, it } from "vitest";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { LIVE_TELEOP_JOINT_SYNC_CONFIG } from "@/features/viewer/config";
import {
  resolveLiveTeleopJointTelemetryByName,
  resolveLiveTeleopJointSyncActive,
  resolveLiveTeleopJointTargets,
} from "@/features/viewer/operatorLiveTeleopJointSync";

const TEST_LIVE_TELEOP_JOINT_SYNC = {
  positionRad: 0.4,
  sourceId: "gateway",
  sourceLabel: "Robot gateway",
  sourceTsMs: 1,
} as const;

const buildTelemetry = (
  positionRad: number,
): OperatorLiveJointTelemetry => ({
  positionRad,
  velocityRadPerSec: Number.NaN,
  torqueNm: Number.NaN,
  tempMos: Number.NaN,
  tempRotor: Number.NaN,
  sourceId: TEST_LIVE_TELEOP_JOINT_SYNC.sourceId,
  sourceLabel: TEST_LIVE_TELEOP_JOINT_SYNC.sourceLabel,
  sourceTsMs: TEST_LIVE_TELEOP_JOINT_SYNC.sourceTsMs,
});

describe("operatorLiveTeleopJointSync", () => {
  it("syncs live teleop input only while Hardware Teleop owns the viewer pose", () => {
    expect(
      resolveLiveTeleopJointSyncActive({
        dragMode: "hardware-teleop",
        isPlaying: false,
        liveTelemetryCount: 1,
      }),
    ).toBe(true);
    expect(
      resolveLiveTeleopJointSyncActive({
        dragMode: "drag-handle",
        isPlaying: false,
        liveTelemetryCount: 1,
      }),
    ).toBe(false);
    expect(
      resolveLiveTeleopJointSyncActive({
        dragMode: "hardware-teleop",
        isPlaying: false,
        liveTelemetryCount: 0,
      }),
    ).toBe(false);
    expect(
      resolveLiveTeleopJointSyncActive({
        dragMode: "hardware-teleop",
        isPlaying: true,
        liveTelemetryCount: 1,
      }),
    ).toBe(false);
  });

  it("prefers authoritative follower feedback over leader input for the same joint", () => {
    const leaderTelemetry = buildTelemetry(0.1);
    const followerTelemetry = buildTelemetry(0.2);
    const result = resolveLiveTeleopJointTelemetryByName({
      leaderTelemetryByName: {
        openarm_left_joint1: leaderTelemetry,
        openarm_left_joint2: leaderTelemetry,
      },
      followerTelemetryByName: {
        openarm_left_joint1: followerTelemetry,
      },
    });

    expect(result).toEqual({
      openarm_left_joint1: followerTelemetry,
      openarm_left_joint2: leaderTelemetry,
    });
  });

  it("resolves finite telemetry positions for loaded URDF joints", () => {
    const result = resolveLiveTeleopJointTargets({
      telemetryByName: {
        shoulder: buildTelemetry(TEST_LIVE_TELEOP_JOINT_SYNC.positionRad),
        unknown: buildTelemetry(1),
      },
      availableJointNames: ["shoulder"],
      currentJointValues: {
        shoulder: 0,
      },
    });

    expect(result).toEqual({
      jointValues: {
        shoulder: TEST_LIVE_TELEOP_JOINT_SYNC.positionRad,
      },
      changed: true,
    });
  });

  it("ignores invalid telemetry positions", () => {
    const result = resolveLiveTeleopJointTargets({
      telemetryByName: {
        shoulder: buildTelemetry(Number.NaN),
      },
      availableJointNames: ["shoulder"],
      currentJointValues: {},
    });

    expect(result).toEqual({
      jointValues: {},
      changed: false,
    });
  });

  it("does not mark unchanged live positions as changed", () => {
    const unchangedPositionRad =
      TEST_LIVE_TELEOP_JOINT_SYNC.positionRad +
      LIVE_TELEOP_JOINT_SYNC_CONFIG.positionEpsilonRad / 2;
    const result = resolveLiveTeleopJointTargets({
      telemetryByName: {
        shoulder: buildTelemetry(unchangedPositionRad),
      },
      availableJointNames: ["shoulder"],
      currentJointValues: {
        shoulder: TEST_LIVE_TELEOP_JOINT_SYNC.positionRad,
      },
    });

    expect(result.changed).toBe(false);
    expect(result.jointValues.shoulder).toBe(unchangedPositionRad);
  });
});
