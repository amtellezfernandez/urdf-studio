import {
  clampNumber as clampNumericValue,
  toFiniteNumberOrFallback,
} from "@/shared/lib/numeric";
import { ROVER_APPROACH_CONFIG } from "./approachParams";

const TWO_PI = Math.PI * 2;

export const clampNumber = clampNumericValue;

export const normalizeSignedAngleRad = (angleRad: number): number => {
  let angle = toFiniteNumberOrFallback(angleRad, 0) % TWO_PI;
  if (angle > Math.PI) angle -= TWO_PI;
  if (angle < -Math.PI) angle += TWO_PI;
  return angle;
};

export const clampRoverApproachDtSec = (dtSec: number): number =>
  clampNumber(
    toFiniteNumberOrFallback(dtSec, ROVER_APPROACH_CONFIG.minDtSec),
    ROVER_APPROACH_CONFIG.minDtSec,
    ROVER_APPROACH_CONFIG.maxDtSec
  );
