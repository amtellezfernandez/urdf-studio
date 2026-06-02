import { describe, expect, it } from "vitest";

import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { resolveFollowerHardwareJointJogCommands } from "@/features/teleop/panel/operatorFollowerHardwareSafety";
import { OPERATOR_TELEOP_MS_PER_SECOND } from "@/features/teleop/params/operatorTeleopParams";

const TEST_FOLLOWER_HARDWARE_SAFETY = {
  nowMs: 1_000,
  freshSourceTsMs: 900,
  staleSourceTsMs: 400,
  maxTelemetryAgeMs: 500,
  maxDeltaRad: 0.05,
  maxVelocityRadPerSec: 0.5,
  commandTickMs: 100,
  slowCommandTickMs: 50,
  minDeltaRad: 1e-4,
} as const;

const buildTelemetry = (
  positionRad: number,
  sourceTsMs: number = TEST_FOLLOWER_HARDWARE_SAFETY.freshSourceTsMs,
): OperatorLiveJointTelemetry => ({
  positionRad,
  velocityRadPerSec: Number.NaN,
  torqueNm: Number.NaN,
  tempMos: Number.NaN,
  tempRotor: Number.NaN,
  sourceId: "gateway",
  sourceLabel: "Robot gateway",
  sourceTsMs,
});

describe("resolveFollowerHardwareJointJogCommands", () => {
  it("clamps fresh controlled target deltas before hardware dispatch", () => {
    const result = resolveFollowerHardwareJointJogCommands({
      jointTargets: {
        openarm_left_joint1: 0.4,
        unknown_joint: 1,
      },
      telemetryByName: {
        openarm_left_joint1: buildTelemetry(0.1),
      },
      controlledJointNames: ["openarm_left_joint1"],
      maxDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
      maxVelocityRadPerSec: TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec,
      commandTickMs: TEST_FOLLOWER_HARDWARE_SAFETY.commandTickMs,
      minDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.minDeltaRad,
      maxTelemetryAgeMs: TEST_FOLLOWER_HARDWARE_SAFETY.maxTelemetryAgeMs,
      nowMs: TEST_FOLLOWER_HARDWARE_SAFETY.nowMs,
    });

    expect(result).toEqual({
      commands: [
        {
          joint_name: "openarm_left_joint1",
          current_position_rad: 0.1,
          delta_rad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
        },
      ],
      staleTelemetryCount: 0,
    });
  });

  it("rejects stale follower telemetry instead of computing hardware deltas", () => {
    const result = resolveFollowerHardwareJointJogCommands({
      jointTargets: {
        openarm_left_joint1: 0.2,
      },
      telemetryByName: {
        openarm_left_joint1: buildTelemetry(
          0.1,
          TEST_FOLLOWER_HARDWARE_SAFETY.staleSourceTsMs,
        ),
      },
      controlledJointNames: ["openarm_left_joint1"],
      maxDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
      maxVelocityRadPerSec: TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec,
      commandTickMs: TEST_FOLLOWER_HARDWARE_SAFETY.commandTickMs,
      minDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.minDeltaRad,
      maxTelemetryAgeMs: TEST_FOLLOWER_HARDWARE_SAFETY.maxTelemetryAgeMs,
      nowMs: TEST_FOLLOWER_HARDWARE_SAFETY.nowMs,
    });

    expect(result).toEqual({
      commands: [],
      staleTelemetryCount: 1,
    });
  });

  it("ignores target noise below the configured minimum delta", () => {
    const result = resolveFollowerHardwareJointJogCommands({
      jointTargets: {
        openarm_left_joint1: 0.10005,
      },
      telemetryByName: {
        openarm_left_joint1: buildTelemetry(0.1),
      },
      controlledJointNames: ["openarm_left_joint1"],
      maxDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
      maxVelocityRadPerSec: TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec,
      commandTickMs: TEST_FOLLOWER_HARDWARE_SAFETY.commandTickMs,
      minDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.minDeltaRad,
      maxTelemetryAgeMs: TEST_FOLLOWER_HARDWARE_SAFETY.maxTelemetryAgeMs,
      nowMs: TEST_FOLLOWER_HARDWARE_SAFETY.nowMs,
    });

    expect(result.commands).toEqual([]);
  });

  it("limits each follower step by velocity and command tick", () => {
    const result = resolveFollowerHardwareJointJogCommands({
      jointTargets: {
        openarm_left_joint1: 0.4,
      },
      telemetryByName: {
        openarm_left_joint1: buildTelemetry(0.1),
      },
      controlledJointNames: ["openarm_left_joint1"],
      maxDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
      maxVelocityRadPerSec: TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec,
      commandTickMs: TEST_FOLLOWER_HARDWARE_SAFETY.slowCommandTickMs,
      minDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.minDeltaRad,
      maxTelemetryAgeMs: TEST_FOLLOWER_HARDWARE_SAFETY.maxTelemetryAgeMs,
      nowMs: TEST_FOLLOWER_HARDWARE_SAFETY.nowMs,
    });

    expect(result.commands).toEqual([
      {
        joint_name: "openarm_left_joint1",
        current_position_rad: 0.1,
        delta_rad:
          TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec *
          (TEST_FOLLOWER_HARDWARE_SAFETY.slowCommandTickMs /
            OPERATOR_TELEOP_MS_PER_SECOND),
      },
    ]);
  });

  it("does not dispatch gripper joints until hardware collision mapping exists", () => {
    const result = resolveFollowerHardwareJointJogCommands({
      jointTargets: {
        openarm_left_joint1: 0.2,
        openarm_left_finger_joint1: -0.2,
      },
      telemetryByName: {
        openarm_left_joint1: buildTelemetry(0.1),
        openarm_left_finger_joint1: buildTelemetry(0),
      },
      controlledJointNames: ["openarm_left_joint1", "openarm_left_finger_joint1"],
      maxDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.maxDeltaRad,
      maxVelocityRadPerSec: TEST_FOLLOWER_HARDWARE_SAFETY.maxVelocityRadPerSec,
      commandTickMs: TEST_FOLLOWER_HARDWARE_SAFETY.commandTickMs,
      minDeltaRad: TEST_FOLLOWER_HARDWARE_SAFETY.minDeltaRad,
      maxTelemetryAgeMs: TEST_FOLLOWER_HARDWARE_SAFETY.maxTelemetryAgeMs,
      nowMs: TEST_FOLLOWER_HARDWARE_SAFETY.nowMs,
    });

    expect(result.commands.map((command) => command.joint_name)).toEqual([
      "openarm_left_joint1",
    ]);
  });
});
