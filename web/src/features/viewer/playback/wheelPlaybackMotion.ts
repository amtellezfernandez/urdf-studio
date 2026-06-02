import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";

type WheelTravelInput = {
  leftTravel: number[];
  rightTravel: number[];
  unknownTravel: number[];
  trackWidth: number;
};

export type WheelPlaybackBodyMotion = {
  linearTravel: number;
  angularTravel: number;
  hasMotion: boolean;
};

type WheelPlaybackTravelSeries = Pick<
  WheelTravelInput,
  "leftTravel" | "rightTravel" | "unknownTravel"
>;

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;

const flattenTravelSeries = ({
  leftTravel,
  rightTravel,
  unknownTravel,
}: WheelPlaybackTravelSeries) => [...leftTravel, ...rightTravel, ...unknownTravel];

const resolveTrackWidth = (trackWidth: number): number => {
  const absoluteTrackWidth = Math.abs(trackWidth);
  if (Number.isFinite(absoluteTrackWidth) && absoluteTrackWidth > Number.EPSILON) {
    return absoluteTrackWidth;
  }
  return Number.EPSILON;
};

export const hasObservedWheelTravel = ({
  leftTravel,
  rightTravel,
  unknownTravel,
}: WheelPlaybackTravelSeries) =>
  flattenTravelSeries({ leftTravel, rightTravel, unknownTravel }).some(
    (travel) =>
      Math.abs(travel) >
      WHEEL_PLAYBACK_MOTION_PARAMS.playbackSynthesisMinTravelMeters
  );

export const clampWheelPlaybackBodyMotionStep = ({
  linearTravel,
  angularTravel,
  dtSeconds,
}: {
  linearTravel: number;
  angularTravel: number;
  dtSeconds: number;
}): WheelPlaybackBodyMotion => {
  const maxLinearStep = Math.max(
    WHEEL_PLAYBACK_MOTION_PARAMS.maxLinearSpeedMps * dtSeconds,
    WHEEL_PLAYBACK_MOTION_PARAMS.minLinearStepMeters
  );
  const maxAngularStep = Math.max(
    WHEEL_PLAYBACK_MOTION_PARAMS.maxAngularSpeedRadps * dtSeconds,
    WHEEL_PLAYBACK_MOTION_PARAMS.minAngularStepRad
  );

  let travelScale = 1;
  if (Math.abs(linearTravel) > maxLinearStep) {
    travelScale = Math.min(travelScale, maxLinearStep / Math.abs(linearTravel));
  }
  if (Math.abs(angularTravel) > maxAngularStep) {
    travelScale = Math.min(travelScale, maxAngularStep / Math.abs(angularTravel));
  }

  const nextLinearTravel = linearTravel * travelScale;
  const nextAngularTravel = angularTravel * travelScale;
  const hasMotion =
    Math.abs(nextLinearTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon ||
    Math.abs(nextAngularTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon;

  return {
    linearTravel: nextLinearTravel,
    angularTravel: nextAngularTravel,
    hasMotion,
  };
};

export const resolveWheelPlaybackBodyMotion = ({
  leftTravel,
  rightTravel,
  unknownTravel,
  trackWidth,
}: WheelTravelInput): WheelPlaybackBodyMotion => {
  const allTravel = flattenTravelSeries({ leftTravel, rightTravel, unknownTravel });
  if (allTravel.length === 0) {
    return { linearTravel: 0, angularTravel: 0, hasMotion: false };
  }

  const hasDifferentialPair = leftTravel.length > 0 && rightTravel.length > 0;
  const linearTravel = hasDifferentialPair
    ? (average(leftTravel) + average(rightTravel)) * 0.5
    : average(allTravel);
  const angularTravel = hasDifferentialPair
    ? (average(rightTravel) - average(leftTravel)) /
      resolveTrackWidth(trackWidth)
    : 0;

  const hasMotion =
    Math.abs(linearTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon ||
    Math.abs(angularTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon;

  return {
    linearTravel,
    angularTravel,
    hasMotion,
  };
};
