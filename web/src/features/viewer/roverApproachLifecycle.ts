import type { URDFRobot } from "urdf-loader";

import { ROVER_APPROACH_CONFIG } from "@/features/locomotion/approach";
import { areApproachArmResetTargetsSettled } from "@/features/viewer/approachArmReset";
import type {
  IkObjectPreSolveContext,
  IkObjectPreSolveResult,
} from "@/features/viewer/useIkSolver";

export type RoverApproachAsyncAbortReason =
  | "wheel-disabled"
  | "manual-base-drag"
  | "stale-solve";

type ResolveRoverApproachAsyncAbortReasonArgs = {
  manualApproachInterrupted: boolean;
  wheelDriveEnabled: boolean;
  isStaleSolve: boolean;
};

export const resolveRoverApproachAsyncAbortReason = ({
  manualApproachInterrupted,
  wheelDriveEnabled,
  isStaleSolve,
}: ResolveRoverApproachAsyncAbortReasonArgs): RoverApproachAsyncAbortReason | null => {
  if (!wheelDriveEnabled) return "wheel-disabled";
  if (manualApproachInterrupted) return "manual-base-drag";
  if (isStaleSolve) return "stale-solve";
  return null;
};

export const resolveRoverApproachAsyncAbortResult = ({
  manualApproachInterrupted,
  wheelDriveEnabled,
  isStaleSolve,
  durationMs,
}: ResolveRoverApproachAsyncAbortReasonArgs & {
  durationMs?: number;
}): IkObjectPreSolveResult | null => {
  const reason = resolveRoverApproachAsyncAbortReason({
    manualApproachInterrupted,
    wheelDriveEnabled,
    isStaleSolve,
  });
  if (!reason) return null;
  return {
    status: "cancelled",
    reason,
    durationMs,
  };
};

export const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export const nextAnimationFrameTimeMs = (): Promise<number> =>
  new Promise<number>((resolve) => requestAnimationFrame((time) => resolve(time)));

export const waitForApproachArmResetAfterLocomotion = async ({
  robot,
  targetJointValues,
  manualApproachInterruptRef,
  wheelDriveEnabledRef,
  isStaleSolve,
  reportProgress,
  distanceToTargetM,
  yawErrorRad,
}: {
  robot: URDFRobot | null;
  targetJointValues: Readonly<Record<string, number>>;
  manualApproachInterruptRef: { current: boolean };
  wheelDriveEnabledRef: { current: boolean };
  isStaleSolve: () => boolean;
  reportProgress: IkObjectPreSolveContext["reportProgress"];
  distanceToTargetM: number;
  yawErrorRad: number;
}): Promise<IkObjectPreSolveResult | null> => {
  if (Object.keys(targetJointValues).length === 0) {
    return null;
  }
  let armResetSettledFrameCount = 0;
  let armResetFrameTimeMs = nowMs();
  const armResetDeadlineMs =
    armResetFrameTimeMs + ROVER_APPROACH_CONFIG.armResetSettleTimeoutMs;
  while (armResetFrameTimeMs < armResetDeadlineMs) {
    const armResetAbortResult = resolveRoverApproachAsyncAbortResult({
      manualApproachInterrupted: manualApproachInterruptRef.current,
      wheelDriveEnabled: wheelDriveEnabledRef.current,
      isStaleSolve: isStaleSolve(),
    });
    if (armResetAbortResult) {
      return armResetAbortResult;
    }
    const armResetSettled = areApproachArmResetTargetsSettled({
      robot,
      targetJointValues,
      jointToleranceRad: ROVER_APPROACH_CONFIG.armResetJointToleranceRad,
    });
    if (armResetSettled) {
      armResetSettledFrameCount += 1;
      if (armResetSettledFrameCount >= ROVER_APPROACH_CONFIG.armResetSettleFrames) {
        break;
      }
    } else {
      armResetSettledFrameCount = 0;
    }
    reportProgress({
      phase: "idle",
      distanceToTargetM,
      yawErrorDeg: (yawErrorRad * 180) / Math.PI,
    });
    armResetFrameTimeMs = await nextAnimationFrameTimeMs();
  }
  return null;
};
