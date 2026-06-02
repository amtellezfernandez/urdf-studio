import {
  OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
  OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG,
} from "@/features/teleop/params/operatorTeleopParams";

export const STUDIO_KINEMATIC_TELEOP_SAMPLE_EVENT =
  "urdf-studio:studio-kinematic-teleop-sample";

export type StudioKinematicTeleopInputSource =
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY;

export type StudioKinematicTeleopSampleDetail = {
  inputSource: StudioKinematicTeleopInputSource;
  jointTargets: Record<string, number>;
  sourceTsMs: number;
};

export const emitStudioKinematicTeleopSample = (
  detail: StudioKinematicTeleopSampleDetail,
) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StudioKinematicTeleopSampleDetail>(
      STUDIO_KINEMATIC_TELEOP_SAMPLE_EVENT,
      { detail },
    ),
  );
};

export const isStudioKinematicTeleopSampleDetail = (
  value: unknown,
): value is StudioKinematicTeleopSampleDetail => {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<StudioKinematicTeleopSampleDetail>;
  return (
    (detail.inputSource === OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG ||
      detail.inputSource === OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY) &&
    Boolean(detail.jointTargets) &&
    typeof detail.jointTargets === "object" &&
    typeof detail.sourceTsMs === "number" &&
    Number.isFinite(detail.sourceTsMs)
  );
};
