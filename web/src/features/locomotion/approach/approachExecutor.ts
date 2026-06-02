import * as THREE from "three";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import type { RoverApproachPlan, RoverApproachStepResult } from "./approachTypes";

type RoverApproachStepInput = {
  plan: RoverApproachPlan;
  distanceToTargetM: number;
  yawErrorRad: number;
  dtSec: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const STOPPING_SPEED_FACTOR = 2;

const clampDt = (dtSec: number): number =>
  clamp(
    Number.isFinite(dtSec) && dtSec > 0 ? dtSec : ROVER_APPROACH_CONFIG.minDtSec,
    ROVER_APPROACH_CONFIG.minDtSec,
    ROVER_APPROACH_CONFIG.maxDtSec
  );

const normalizeSignedAngle = (angleRad: number): number => {
  let angle = angleRad;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

const resolveYawSlowdownScale = (yawAbsRad: number): number => {
  if (yawAbsRad <= 0) return 1;
  if (yawAbsRad >= ROVER_APPROACH_CONFIG.yawTranslateSlowdownStartRad) {
    return ROVER_APPROACH_CONFIG.yawTranslateMinSpeedScale;
  }
  const t = yawAbsRad / ROVER_APPROACH_CONFIG.yawTranslateSlowdownStartRad;
  return 1 - t * (1 - ROVER_APPROACH_CONFIG.yawTranslateMinSpeedScale);
};

const resolveStoppingLimitedLinearSpeed = (distanceErrorM: number): number => {
  if (!Number.isFinite(distanceErrorM) || distanceErrorM <= 0) return 0;
  return Math.sqrt(
    STOPPING_SPEED_FACTOR * ROVER_APPROACH_CONFIG.maxLinearAccelMps2 * distanceErrorM
  );
};

export const computeSignedPlanarYawErrorRad = (
  forwardWorld: THREE.Vector3,
  toTargetWorld: THREE.Vector3,
  upAxisWorld: THREE.Vector3
): number => {
  if (
    forwardWorld.lengthSq() <= 1e-10 ||
    toTargetWorld.lengthSq() <= 1e-10 ||
    upAxisWorld.lengthSq() <= 1e-10
  ) {
    return 0;
  }
  const forward = forwardWorld.clone().normalize();
  const toTarget = toTargetWorld.clone().normalize();
  const up = upAxisWorld.clone().normalize();
  const dot = clamp(forward.dot(toTarget), -1, 1);
  const unsigned = Math.acos(dot);
  const cross = new THREE.Vector3().crossVectors(forward, toTarget);
  const sign = Math.sign(cross.dot(up));
  return normalizeSignedAngle(unsigned * (sign === 0 ? 1 : sign));
};

export const computeRoverApproachRotateTravelRad = (
  yawErrorRad: number,
  dtSec: number
): number => {
  const clampedDt = clampDt(dtSec);
  const yawError = Number.isFinite(yawErrorRad) ? normalizeSignedAngle(yawErrorRad) : 0;
  const rotationSpeed = clamp(
    yawError * ROVER_APPROACH_CONFIG.rotationGain,
    -ROVER_APPROACH_CONFIG.maxAngularSpeedRadps,
    ROVER_APPROACH_CONFIG.maxAngularSpeedRadps
  );
  return rotationSpeed * clampedDt;
};

export const computeRoverApproachStep = ({
  plan,
  distanceToTargetM,
  yawErrorRad,
  dtSec,
}: RoverApproachStepInput): RoverApproachStepResult => {
  if (plan.mode === "skip") {
    return {
      phase: "done",
      linearTravelM: 0,
      angularTravelRad: 0,
      done: true,
    };
  }

  const clampedDt = clampDt(dtSec);
  const safeDistance = Number.isFinite(distanceToTargetM) ? Math.max(0, distanceToTargetM) : 0;
  const yawError = Number.isFinite(yawErrorRad) ? normalizeSignedAngle(yawErrorRad) : 0;
  const yawAbs = Math.abs(yawError);
  const distanceToleranceM =
    Number.isFinite(plan.distanceToleranceM) && plan.distanceToleranceM >= 0
      ? plan.distanceToleranceM
      : ROVER_APPROACH_CONFIG.distanceToleranceM;
  const distanceError = Math.max(0, safeDistance - plan.desiredStopDistanceM);
  const yawAligned = yawAbs <= ROVER_APPROACH_CONFIG.yawToleranceRad;
  const distanceAligned = distanceError <= distanceToleranceM;

  if (yawAligned && distanceAligned) {
    return {
      phase: "done",
      linearTravelM: 0,
      angularTravelRad: 0,
      done: true,
    };
  }

  const rotationSpeed = clamp(
    yawError * ROVER_APPROACH_CONFIG.rotationGain,
    -ROVER_APPROACH_CONFIG.maxAngularSpeedRadps,
    ROVER_APPROACH_CONFIG.maxAngularSpeedRadps
  );
  if (distanceAligned) {
    return {
      phase: "rotate",
      linearTravelM: 0,
      angularTravelRad: computeRoverApproachRotateTravelRad(yawError, clampedDt),
      done: false,
    };
  }

  // Blend translation with limited yaw correction for smoother approach arcs.
  // Keep rotate-in-place behavior for larger yaw errors to avoid aggressive side drift.
  if (yawAbs > ROVER_APPROACH_CONFIG.yawRotateInPlaceThresholdRad) {
    return {
      phase: "rotate",
      linearTravelM: 0,
      angularTravelRad: computeRoverApproachRotateTravelRad(yawError, clampedDt),
      done: false,
    };
  }
  if (!plan.allowTranslationYawAssist && !yawAligned) {
    return {
      phase: "rotate",
      linearTravelM: 0,
      angularTravelRad: computeRoverApproachRotateTravelRad(yawError, clampedDt),
      done: false,
    };
  }

  const linearSpeed = Math.min(
    clamp(
      distanceError * ROVER_APPROACH_CONFIG.translationGain,
      0,
      ROVER_APPROACH_CONFIG.maxLinearSpeedMps
    ),
    resolveStoppingLimitedLinearSpeed(distanceError)
  ) * (!plan.allowTranslationYawAssist ? 1 : resolveYawSlowdownScale(yawAbs));
  const linearTravelM = Math.min(linearSpeed * clampedDt, distanceError);
  const yawAssistSpeed = clamp(
    rotationSpeed,
    -ROVER_APPROACH_CONFIG.yawTranslateAngularSpeedMaxRadps,
    ROVER_APPROACH_CONFIG.yawTranslateAngularSpeedMaxRadps
  );
  return {
    phase: "translate",
    linearTravelM,
    angularTravelRad: plan.allowTranslationYawAssist ? yawAssistSpeed * clampedDt : 0,
    done: false,
  };
};
