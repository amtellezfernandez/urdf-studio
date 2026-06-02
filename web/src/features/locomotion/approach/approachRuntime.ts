import { ROVER_APPROACH_CONFIG } from "./approachParams";
import { computeRoverApproachRotateTravelRad, computeRoverApproachStep } from "./approachExecutor";
import type {
  RoverApproachPlan,
  RoverApproachStepPhase,
  RoverApproachStepResult,
} from "./approachTypes";

export type RoverApproachRuntimePhase = "rotate" | "translate";
export type RoverApproachSpeedState = {
  linearSpeedMps: number;
  angularSpeedRadps: number;
};

const toFiniteSigned = (value: number): number => (Number.isFinite(value) ? value : 0);

export const resolveInitialRoverApproachPhase = (
  yawErrorRad: number
): RoverApproachRuntimePhase => {
  const yawAbs = Math.abs(yawErrorRad);
  return yawAbs > ROVER_APPROACH_CONFIG.initialRotateThresholdRad ? "rotate" : "translate";
};

type AdvanceRoverApproachPhaseParams = {
  phase: RoverApproachRuntimePhase;
  yawErrorRad: number;
  stepPhase?: RoverApproachStepPhase;
};

export const advanceRoverApproachPhase = (
  params: AdvanceRoverApproachPhaseParams
): RoverApproachRuntimePhase => {
  const { phase, yawErrorRad, stepPhase } = params;
  const yawAbs = Math.abs(yawErrorRad);
  if (phase === "rotate" && yawAbs <= ROVER_APPROACH_CONFIG.yawPhaseRotateExitRad) {
    return "translate";
  }
  if (phase === "translate" && yawAbs >= ROVER_APPROACH_CONFIG.yawPhaseRotateEnterRad) {
    return "rotate";
  }
  if (phase === "rotate" && stepPhase && stepPhase !== "rotate") {
    return "translate";
  }
  return phase;
};

export const resolveRoverApproachCommandYawErrorRad = (
  phase: RoverApproachRuntimePhase,
  yawErrorRad: number
): number => {
  const yawError = toFiniteSigned(yawErrorRad);
  if (phase === "translate") {
    return yawError * ROVER_APPROACH_CONFIG.yawTranslateCommandScale;
  }
  return yawError;
};

export const moveRoverApproachValueToward = (
  current: number,
  target: number,
  maxDelta: number
): number => {
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    return 0;
  }
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) {
    return target;
  }
  if (target > current) return Math.min(target, current + maxDelta);
  if (target < current) return Math.max(target, current - maxDelta);
  return target;
};

export const clampRoverApproachDtSec = (dtSec: number): number =>
  Math.min(ROVER_APPROACH_CONFIG.maxDtSec, Math.max(ROVER_APPROACH_CONFIG.minDtSec, dtSec));

type ResolveRoverApproachFrameParams = {
  phase: RoverApproachRuntimePhase;
  yawErrorRad: number;
  distanceToTargetM: number;
  dtSec: number;
  plan: RoverApproachPlan;
};

type ResolveRoverApproachFrameResult = {
  phase: RoverApproachRuntimePhase;
  commandYawErrorRad: number;
  step: RoverApproachStepResult;
};

export const resolveRoverApproachFrame = ({
  phase,
  yawErrorRad,
  distanceToTargetM,
  dtSec,
  plan,
}: ResolveRoverApproachFrameParams): ResolveRoverApproachFrameResult => {
  if (!plan.allowTranslationYawAssist) {
    const exactLockedYawErrorRad = toFiniteSigned(yawErrorRad);
    const lockedTurnComplete =
      Math.abs(exactLockedYawErrorRad) <= ROVER_APPROACH_CONFIG.appliedTravelEpsilon;
    if (phase === "rotate" && !lockedTurnComplete) {
      return {
        phase: "rotate",
        commandYawErrorRad: exactLockedYawErrorRad,
        step: {
          phase: "rotate",
          linearTravelM: 0,
          angularTravelRad: computeRoverApproachRotateTravelRad(exactLockedYawErrorRad, dtSec),
          done: false,
        },
      };
    }
    const translateStep = computeRoverApproachStep({
      plan,
      distanceToTargetM,
      yawErrorRad: 0,
      dtSec,
    });
    return {
      phase: "translate",
      commandYawErrorRad: 0,
      step: {
        ...translateStep,
        phase: translateStep.done ? "done" : "translate",
        angularTravelRad: 0,
      },
    };
  }
  const phaseAfterYaw = advanceRoverApproachPhase({
    phase,
    yawErrorRad,
  });
  const commandYawErrorRad = resolveRoverApproachCommandYawErrorRad(phaseAfterYaw, yawErrorRad);
  const step = computeRoverApproachStep({
    plan,
    distanceToTargetM,
    yawErrorRad: commandYawErrorRad,
    dtSec,
  });
  const nextPhase = advanceRoverApproachPhase({
    phase: phaseAfterYaw,
    yawErrorRad,
    stepPhase: step.phase,
  });
  return {
    phase: nextPhase,
    commandYawErrorRad,
    step,
  };
};

type ResolveRoverApproachDesiredSpeedsParams = {
  step: RoverApproachStepResult;
  driveLinearScale: number;
  driveAngularScale: number;
  dtSec: number;
};

export const resolveRoverApproachDesiredSpeeds = ({
  step,
  driveLinearScale,
  driveAngularScale,
  dtSec,
}: ResolveRoverApproachDesiredSpeedsParams): RoverApproachSpeedState => {
  const safeDtSec = Math.max(dtSec, ROVER_APPROACH_CONFIG.speedDtDenominatorEpsilonSec);
  return {
    linearSpeedMps: (step.linearTravelM * driveLinearScale) / safeDtSec,
    angularSpeedRadps: (step.angularTravelRad * driveAngularScale) / safeDtSec,
  };
};

type ResolveAppliedRoverApproachMotionParams = {
  speedState: RoverApproachSpeedState;
  dtSec: number;
  remainingDistanceM: number;
  remainingYawErrorRad: number;
  phase?: RoverApproachStepPhase;
  enforceExactTurnStop?: boolean;
};

type ResolveAppliedRoverApproachMotionResult = {
  linearTravelM: number;
  angularTravelRad: number;
  speedState: RoverApproachSpeedState;
  completedExactTurn: boolean;
};

const clampNonNegativeFinite = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

export const resolveAppliedRoverApproachMotion = ({
  speedState,
  dtSec,
  remainingDistanceM,
  remainingYawErrorRad,
  phase,
  enforceExactTurnStop = false,
}: ResolveAppliedRoverApproachMotionParams): ResolveAppliedRoverApproachMotionResult => {
  const appliedDtSec =
    Number.isFinite(dtSec) && dtSec > 0 ? dtSec : ROVER_APPROACH_CONFIG.minDtSec;
  const speedDtSec = Math.max(appliedDtSec, ROVER_APPROACH_CONFIG.speedDtDenominatorEpsilonSec);
  const unclampedLinearTravelM =
    Math.max(0, toFiniteSigned(speedState.linearSpeedMps)) * appliedDtSec;
  const linearTravelM = Math.min(
    unclampedLinearTravelM,
    clampNonNegativeFinite(remainingDistanceM)
  );
  const unclampedAngularTravelRad = toFiniteSigned(speedState.angularSpeedRadps) * appliedDtSec;
  let angularTravelRad = unclampedAngularTravelRad;
  let completedExactTurn = false;
  if (enforceExactTurnStop && phase === "rotate") {
    const remainingYawAbsRad = Math.abs(toFiniteSigned(remainingYawErrorRad));
    const angularDirection =
      Math.sign(toFiniteSigned(remainingYawErrorRad)) || Math.sign(unclampedAngularTravelRad);
    const appliedAngularAbsRad = Math.min(Math.abs(unclampedAngularTravelRad), remainingYawAbsRad);
    angularTravelRad = appliedAngularAbsRad * angularDirection;
    completedExactTurn =
      remainingYawAbsRad > 0 &&
      remainingYawAbsRad - appliedAngularAbsRad <= ROVER_APPROACH_CONFIG.appliedTravelEpsilon;
  }
  return {
    linearTravelM,
    angularTravelRad,
    speedState: {
      linearSpeedMps: linearTravelM / speedDtSec,
      angularSpeedRadps: angularTravelRad / speedDtSec,
    },
    completedExactTurn,
  };
};

type AdvanceRoverApproachSpeedsParams = {
  current: RoverApproachSpeedState;
  desired: RoverApproachSpeedState;
  dtSec: number;
  done: boolean;
  phase?: RoverApproachStepPhase;
  enforcePhaseAxisLock?: boolean;
};

export const advanceRoverApproachSpeeds = ({
  current,
  desired,
  dtSec,
  done,
  phase,
  enforcePhaseAxisLock = false,
}: AdvanceRoverApproachSpeedsParams): RoverApproachSpeedState => {
  if (done) {
    return {
      linearSpeedMps: 0,
      angularSpeedRadps: 0,
    };
  }
  const maxLinearSpeedDelta = ROVER_APPROACH_CONFIG.maxLinearAccelMps2 * dtSec;
  const maxAngularSpeedDelta = ROVER_APPROACH_CONFIG.maxAngularAccelRadps2 * dtSec;
  const nextSpeedState = {
    linearSpeedMps: moveRoverApproachValueToward(
      current.linearSpeedMps,
      desired.linearSpeedMps,
      maxLinearSpeedDelta
    ),
    angularSpeedRadps: moveRoverApproachValueToward(
      current.angularSpeedRadps,
      desired.angularSpeedRadps,
      maxAngularSpeedDelta
    ),
  };
  if (!enforcePhaseAxisLock) {
    return nextSpeedState;
  }
  if (phase === "rotate") {
    return {
      linearSpeedMps: 0,
      angularSpeedRadps: nextSpeedState.angularSpeedRadps,
    };
  }
  if (phase === "translate") {
    return {
      linearSpeedMps: nextSpeedState.linearSpeedMps,
      angularSpeedRadps: 0,
    };
  }
  return nextSpeedState;
};
