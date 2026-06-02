export const WHEEL_PLAYBACK_MOTION_PARAMS = {
  maxLinearSpeedMps: 3.0,
  maxAngularSpeedRadps: 5.0,
  minLinearStepMeters: 0.01,
  minAngularStepRad: 0.02,
  allowBaseMotionSynthesisWithoutBasePose: false,
  playbackSynthesisMinTravelMeters: 1e-6,
  playbackSynthesisMinAngularTravelRad: 1e-6,
  driveAuthorityEpsilon: 1e-6,
  minWheelSpeedSampleDtSeconds: 1e-4,
  motionEpsilon: 1e-8,
} as const;
