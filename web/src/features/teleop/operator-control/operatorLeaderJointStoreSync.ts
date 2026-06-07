import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import { OPERATOR_HARDWARE_IK_COMMAND } from "@/features/teleop/params/operatorTeleopParams";
import { useJointStore } from "@/shared/store/useJointStore";

type ResolveOperatorLeaderJointStorePatchParams = {
  jointTargets: Record<string, number>;
  availableJointNames: readonly string[];
  currentJointValues: Record<string, number>;
  positionEpsilonRad?: number;
};

type SyncOperatorLeaderJointTargetsParams = {
  jointTargets: Record<string, number>;
  availableJointNames: readonly string[];
};

type SyncOperatorLeaderTelemetryParams = {
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
  availableJointNames: readonly string[];
};

export type OperatorLeaderJointStorePatch = {
  jointValues: Record<string, number>;
  changed: boolean;
};

export const resolveOperatorLeaderJointStorePatch = ({
  jointTargets,
  availableJointNames,
  currentJointValues,
  positionEpsilonRad = OPERATOR_HARDWARE_IK_COMMAND.minDeltaRad,
}: ResolveOperatorLeaderJointStorePatchParams): OperatorLeaderJointStorePatch => {
  const availableJointSet =
    availableJointNames.length > 0 ? new Set(availableJointNames) : null;
  const jointValues: Record<string, number> = {};
  let changed = false;

  for (const [jointName, positionRad] of Object.entries(jointTargets)) {
    if (availableJointSet && !availableJointSet.has(jointName)) continue;
    if (!Number.isFinite(positionRad)) continue;

    jointValues[jointName] = positionRad;
    const current = currentJointValues[jointName];
    if (
      !Number.isFinite(current) ||
      Math.abs((current as number) - positionRad) > positionEpsilonRad
    ) {
      changed = true;
    }
  }

  return { jointValues, changed };
};

export const syncOperatorLeaderJointTargetsToJointStore = ({
  jointTargets,
  availableJointNames,
}: SyncOperatorLeaderJointTargetsParams): boolean => {
  const jointStore = useJointStore.getState();
  const { jointValues, changed } = resolveOperatorLeaderJointStorePatch({
    jointTargets,
    availableJointNames,
    currentJointValues: jointStore.jointValues,
  });
  if (!changed || Object.keys(jointValues).length === 0) return false;

  jointStore.setJointValues({
    ...jointStore.jointValues,
    ...jointValues,
  });
  return true;
};

export const syncOperatorLeaderTelemetryToJointStore = ({
  telemetryByName,
  availableJointNames,
}: SyncOperatorLeaderTelemetryParams): boolean =>
  syncOperatorLeaderJointTargetsToJointStore({
    availableJointNames,
    jointTargets: Object.fromEntries(
      Object.entries(telemetryByName).map(([jointName, telemetry]) => [
        jointName,
        telemetry.positionRad,
      ]),
    ),
  });
