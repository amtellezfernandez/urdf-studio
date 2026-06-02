import type { OperatorCalibrationFileEditSession } from "@/features/teleop/panel/useOperatorCalibrationFileEdit";
import {
  resolveOperatorLeaderTargetJointDirections,
  mapOperatorLeaderSourcePositionsToTargetPositions,
  resolveOperatorLeaderTargetJointNames,
  type OperatorLeaderTelemetryTarget,
} from "@/features/teleop/transport/operatorLeaderTelemetry";

const hasTelemetryOverrideMapping = (
  session: OperatorCalibrationFileEditSession,
): boolean =>
  session.syncedMapping.jointNames.length > 0 &&
  session.syncedMapping.jointNames.length === session.syncedMapping.motorIds.length;

export const applyCalibrationFileEditLeaderTelemetryOverride = ({
  targets,
  session,
}: {
  targets: readonly OperatorLeaderTelemetryTarget[];
  session: OperatorCalibrationFileEditSession | null;
}): OperatorLeaderTelemetryTarget[] => {
  if (session?.role !== "leader" || !hasTelemetryOverrideMapping(session)) {
    return [...targets];
  }
  return targets.map((target) => {
    if (target.identityKey !== session.targetKey) {
      return target;
    }
    const targetJointNames = resolveOperatorLeaderTargetJointNames(
      session.syncedMapping.jointNames,
      target.targetJointNames,
      Math.min(
        session.syncedMapping.jointNames.length,
        target.targetJointNames.length,
      ),
    );
    const targetJointDirections = resolveOperatorLeaderTargetJointDirections({
      calibrationProfile: target.calibrationProfile,
      targetJointNames,
    });
    return {
      ...target,
      motorIds: session.syncedMapping.motorIds,
      sourceJointNames: session.syncedMapping.jointNames,
      targetJointNames,
      targetJointDirections,
      sourceNeutralPositionsByTargetJointName:
        mapOperatorLeaderSourcePositionsToTargetPositions({
          sourceJointNames: session.syncedMapping.jointNames,
          targetJointNames,
          targetJointDirections,
          sourceReferencePositionsByJointName: session.syncedZeroPositionsRad,
        }),
      calibrationRevision: session.syncRevision,
    };
  });
};
