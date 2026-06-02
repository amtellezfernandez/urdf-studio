import type { OperatorJointJogCommand } from "@/features/teleop/contracts/operatorControlTypes";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import {
  OPERATOR_HELPER_OPENARM_FINGER_JOINT_NAME_TOKEN,
  OPERATOR_TELEOP_MS_PER_SECOND,
} from "@/features/teleop/params/operatorTeleopParams";

type ResolveFollowerHardwareJointJogCommandsParams = {
  jointTargets: Record<string, number>;
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
  controlledJointNames: readonly string[];
  maxDeltaRad: number;
  maxVelocityRadPerSec: number;
  commandTickMs: number;
  minDeltaRad: number;
  maxTelemetryAgeMs: number;
  nowMs: number;
};

type FollowerHardwareJointJogResolution = {
  commands: OperatorJointJogCommand[];
  staleTelemetryCount: number;
};

const hasFreshTelemetry = (
  telemetry: OperatorLiveJointTelemetry | undefined,
  nowMs: number,
  maxTelemetryAgeMs: number,
): telemetry is OperatorLiveJointTelemetry => {
  if (!telemetry) return false;
  if (!Number.isFinite(telemetry.positionRad)) return false;
  if (!Number.isFinite(telemetry.sourceTsMs)) return false;
  return nowMs - telemetry.sourceTsMs <= maxTelemetryAgeMs;
};

export const resolveFollowerHardwareJointJogCommands = ({
  jointTargets,
  telemetryByName,
  controlledJointNames,
  maxDeltaRad,
  maxVelocityRadPerSec,
  commandTickMs,
  minDeltaRad,
  maxTelemetryAgeMs,
  nowMs,
}: ResolveFollowerHardwareJointJogCommandsParams): FollowerHardwareJointJogResolution => {
  const controlledJointSet = new Set(controlledJointNames);
  const commands: OperatorJointJogCommand[] = [];
  const velocityLimitedDeltaRad =
    (maxVelocityRadPerSec * commandTickMs) / OPERATOR_TELEOP_MS_PER_SECOND;
  const maxStepDeltaRad = Math.min(maxDeltaRad, velocityLimitedDeltaRad);
  let staleTelemetryCount = 0;

  if (!Number.isFinite(maxStepDeltaRad) || maxStepDeltaRad <= minDeltaRad) {
    return { commands, staleTelemetryCount };
  }

  for (const [jointName, targetPositionRad] of Object.entries(jointTargets)) {
    if (!controlledJointSet.has(jointName) || !Number.isFinite(targetPositionRad)) {
      continue;
    }
    if (jointName.includes(OPERATOR_HELPER_OPENARM_FINGER_JOINT_NAME_TOKEN)) {
      continue;
    }

    const telemetry = telemetryByName[jointName];
    if (!hasFreshTelemetry(telemetry, nowMs, maxTelemetryAgeMs)) {
      staleTelemetryCount += 1;
      continue;
    }

    const rawDeltaRad = targetPositionRad - telemetry.positionRad;
    if (Math.abs(rawDeltaRad) <= minDeltaRad) {
      continue;
    }

    commands.push({
      joint_name: jointName,
      current_position_rad: telemetry.positionRad,
      delta_rad: Math.max(-maxStepDeltaRad, Math.min(maxStepDeltaRad, rawDeltaRad)),
    });
  }

  return { commands, staleTelemetryCount };
};
