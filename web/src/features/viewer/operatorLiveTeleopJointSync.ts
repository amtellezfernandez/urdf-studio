import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { LIVE_TELEOP_JOINT_SYNC_CONFIG } from "@/features/viewer/config";
import type { DragMode } from "@/features/viewer/viewer-helpers";

type ResolveLiveTeleopJointTargetsParams = {
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
  availableJointNames: readonly string[];
  currentJointValues: Record<string, number>;
};

type ResolveLiveTeleopJointTelemetryByNameParams = {
  leaderTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
  followerTelemetryByName: Record<string, OperatorLiveJointTelemetry>;
};

type ResolveLiveTeleopJointSyncActiveParams = {
  dragMode: DragMode;
  isPlaying: boolean;
  liveTelemetryCount: number;
};

export type LiveTeleopJointTargets = {
  jointValues: Record<string, number>;
  changed: boolean;
};

export const resolveLiveTeleopJointSyncActive = ({
  dragMode,
  isPlaying,
  liveTelemetryCount,
}: ResolveLiveTeleopJointSyncActiveParams): boolean =>
  dragMode === "hardware-teleop" &&
  liveTelemetryCount > 0 &&
  !isPlaying;

export const resolveLiveTeleopJointTelemetryByName = ({
  leaderTelemetryByName,
  followerTelemetryByName,
}: ResolveLiveTeleopJointTelemetryByNameParams): Record<
  string,
  OperatorLiveJointTelemetry
> => {
  if (Object.keys(followerTelemetryByName).length === 0) {
    return leaderTelemetryByName;
  }
  if (Object.keys(leaderTelemetryByName).length === 0) {
    return followerTelemetryByName;
  }
  return {
    ...leaderTelemetryByName,
    ...followerTelemetryByName,
  };
};

export const resolveLiveTeleopJointTargets = ({
  telemetryByName,
  availableJointNames,
  currentJointValues,
}: ResolveLiveTeleopJointTargetsParams): LiveTeleopJointTargets => {
  const availableJointSet =
    availableJointNames.length > 0 ? new Set(availableJointNames) : null;
  const jointValues: Record<string, number> = {};
  let changed = false;

  for (const [jointName, telemetry] of Object.entries(telemetryByName)) {
    if (availableJointSet && !availableJointSet.has(jointName)) continue;
    const positionRad = telemetry.positionRad;
    if (!Number.isFinite(positionRad)) continue;

    jointValues[jointName] = positionRad;
    const current = currentJointValues[jointName];
    if (
      !Number.isFinite(current) ||
      Math.abs((current as number) - positionRad) >
        LIVE_TELEOP_JOINT_SYNC_CONFIG.positionEpsilonRad
    ) {
      changed = true;
    }
  }

  return { jointValues, changed };
};
