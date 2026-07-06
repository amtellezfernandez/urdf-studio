import { ROVER_APPROACH_CONFIG } from "./approachParams";

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const normalizeSignedAngleRad = (angleRad: number): number => {
  if (!Number.isFinite(angleRad)) return 0;
  let angle = angleRad;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

export const clampRoverApproachDtSec = (dtSec: number): number =>
  clampNumber(
    Number.isFinite(dtSec) && dtSec > 0 ? dtSec : ROVER_APPROACH_CONFIG.minDtSec,
    ROVER_APPROACH_CONFIG.minDtSec,
    ROVER_APPROACH_CONFIG.maxDtSec
  );
