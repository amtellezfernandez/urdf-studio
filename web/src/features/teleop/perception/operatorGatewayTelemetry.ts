import type { OperatorGatewayStateFrame } from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";

type BuildOperatorGatewayJointTelemetryParams = {
  state: OperatorGatewayStateFrame;
  sourceId: string;
  sourceLabel: string;
};

export const buildOperatorGatewayJointTelemetry = ({
  state,
  sourceId,
  sourceLabel,
}: BuildOperatorGatewayJointTelemetryParams): Record<string, OperatorLiveJointTelemetry> => {
  if (
    !state.heartbeatOk ||
    !state.hardwareMotionSafety.authoritativeJointFeedbackReady
  ) {
    return {};
  }

  const telemetryByName: Record<string, OperatorLiveJointTelemetry> = {};
  const sourceTsMs = state.sourceTsMs > 0 ? state.sourceTsMs : Date.now();
  const jointPositionsRad = {
    ...state.gripperPositionsRad,
    ...state.jointPositionsRad,
  };

  for (const [jointName, positionRad] of Object.entries(jointPositionsRad)) {
    if (!Number.isFinite(positionRad)) continue;
    const jointTelemetry = state.jointTelemetry[jointName];
    telemetryByName[jointName] = {
      positionRad: jointTelemetry?.positionRad ?? positionRad,
      velocityRadPerSec: jointTelemetry?.velocityRadPerSec ?? Number.NaN,
      torqueNm: jointTelemetry?.torqueNm ?? Number.NaN,
      tempMos: jointTelemetry?.tempMosC ?? Number.NaN,
      tempRotor: jointTelemetry?.tempRotorC ?? Number.NaN,
      sourceId,
      sourceLabel,
      sourceTsMs,
    };
  }

  return telemetryByName;
};
