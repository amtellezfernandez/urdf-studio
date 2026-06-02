export type RoverApproachReason =
  | "wheel-disabled"
  | "wheel-unavailable"
  | "within-reach"
  | "outside-reach"
  | "rear-target"
  | "orientation-adjust";

export type RoverApproachMode = "skip" | "approach";

export type RoverApproachPlan = {
  mode: RoverApproachMode;
  reason: RoverApproachReason;
  desiredStopDistanceM: number;
  distanceToleranceM: number;
  allowTranslationYawAssist: boolean;
  requiresRotation: boolean;
  requiresTranslation: boolean;
  distanceToTargetM: number;
  forwardDotTarget: number;
};

export type RoverApproachStepPhase = "rotate" | "translate" | "done";

export type RoverApproachStepResult = {
  phase: RoverApproachStepPhase;
  linearTravelM: number;
  angularTravelRad: number;
  done: boolean;
};
