import type { OperatorLiveJointTelemetry } from "@/features/teleop/perception/operatorPerceptionStore";
import type { OperatorLeaderState } from "@/features/teleop/transport/operatorHelperApi";

type BuildTelemetrySampleFn = (
  state: OperatorLeaderState,
  sourceId: string,
  sourceLabel: string,
  positionRad: number,
  velocityRadPerSec: number | null,
  torqueNm: number | null,
  motorId: number | null | undefined,
) => OperatorLiveJointTelemetry;

const CRANE_BOOM_LUFF_JOINT = "boom_luff";
const CRANE_FINGER_SLIDE_JOINT = "finger_slide";
const SO101_GRIPPER_CLOSED_RAD = 0.08;
const SO101_GRIPPER_OPEN_RAD = 1.25;
const CRANE_FINGER_SLIDE_OPEN_M = 0.02;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const mapSo101GripperToCraneFingerSlide = (positionRad: number): number => {
  const normalized =
    (positionRad - SO101_GRIPPER_CLOSED_RAD) /
    (SO101_GRIPPER_OPEN_RAD - SO101_GRIPPER_CLOSED_RAD);
  return clamp(normalized * CRANE_FINGER_SLIDE_OPEN_M, 0, CRANE_FINGER_SLIDE_OPEN_M);
};

export const applySo101ToCraneMapping = (
  state: OperatorLeaderState,
  leaderEntries: Array<readonly [string, OperatorLeaderState["joints"][string]]>,
  targetJointNames: readonly string[],
  sourceId: string,
  sourceLabel: string,
  sourceMotorIds: readonly number[],
  buildTelemetrySample: BuildTelemetrySampleFn,
): Record<string, OperatorLiveJointTelemetry> | null => {
  const isCraneTarget =
    targetJointNames.includes(CRANE_BOOM_LUFF_JOINT) &&
    targetJointNames.includes(CRANE_FINGER_SLIDE_JOINT);
  if (!isCraneTarget || leaderEntries.length === 0) return null;

  const boomLuffTelemetry = state.joints.shoulder_lift ?? leaderEntries[1]?.[1];
  const fingerSlideTelemetry =
    state.joints.gripper ??
    leaderEntries.find(([jointName]) => jointName.includes("gripper"))?.[1] ??
    leaderEntries[6]?.[1] ??
    leaderEntries[5]?.[1];
  const result: Record<string, OperatorLiveJointTelemetry> = {};

  if (boomLuffTelemetry && Number.isFinite(boomLuffTelemetry.positionRad)) {
    result[CRANE_BOOM_LUFF_JOINT] = buildTelemetrySample(
      state,
      sourceId,
      sourceLabel,
      boomLuffTelemetry.positionRad,
      boomLuffTelemetry.velocityRadPerSec,
      boomLuffTelemetry.torqueNm,
      boomLuffTelemetry.motorId ?? sourceMotorIds[1],
    );
  }

  if (fingerSlideTelemetry && Number.isFinite(fingerSlideTelemetry.positionRad)) {
    result[CRANE_FINGER_SLIDE_JOINT] = buildTelemetrySample(
      state,
      sourceId,
      sourceLabel,
      mapSo101GripperToCraneFingerSlide(fingerSlideTelemetry.positionRad),
      fingerSlideTelemetry.velocityRadPerSec,
      fingerSlideTelemetry.torqueNm,
      fingerSlideTelemetry.motorId ?? sourceMotorIds[5],
    );
  }

  return Object.keys(result).length > 0 ? result : null;
};
