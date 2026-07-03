import { describe, expect, it } from "vitest";

import {
  clampWheelPlaybackBodyMotionStep,
  hasObservedWheelTravel,
  resolveWheelPlaybackBodyMotion,
} from "@/features/viewer/playback/wheelPlaybackMotion";
import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";

const TRACK_WIDTH_METERS = 0.5;
const LARGE_TRAVEL_INPUT = 10;
const CLAMP_TEST_DT_SECONDS = 0.1;

describe("resolveWheelPlaybackBodyMotion", () => {
  it("disables heuristic chassis motion when frames do not include base pose", () => {
    expect(
      WHEEL_PLAYBACK_MOTION_PARAMS.allowBaseMotionSynthesisWithoutBasePose
    ).toBe(false);
  });

  it("returns no motion when wheel travel arrays are empty", () => {
    expect(
      resolveWheelPlaybackBodyMotion({
        leftTravel: [],
        rightTravel: [],
        unknownTravel: [],
        trackWidth: TRACK_WIDTH_METERS,
      })
    ).toEqual({
      linearTravel: 0,
      angularTravel: 0,
      hasMotion: false,
    });
  });

  it("computes differential-drive linear and angular travel", () => {
    const result = resolveWheelPlaybackBodyMotion({
      leftTravel: [0.2, 0.2],
      rightTravel: [0.3, 0.3],
      unknownTravel: [],
      trackWidth: TRACK_WIDTH_METERS,
    });

    expect(result.linearTravel).toBeCloseTo(0.25, 8);
    expect(result.angularTravel).toBeCloseTo(0.2, 8);
    expect(result.hasMotion).toBe(true);
  });

  it("falls back to mean travel when wheel sides are not available", () => {
    const result = resolveWheelPlaybackBodyMotion({
      leftTravel: [],
      rightTravel: [],
      unknownTravel: [0.12, 0.18],
      trackWidth: TRACK_WIDTH_METERS,
    });

    expect(result.linearTravel).toBeCloseTo(0.15, 8);
    expect(result.angularTravel).toBe(0);
    expect(result.hasMotion).toBe(true);
  });

  it("detects observed wheel travel above synthesis threshold", () => {
    expect(
      hasObservedWheelTravel({
        leftTravel: [WHEEL_PLAYBACK_MOTION_PARAMS.playbackSynthesisMinTravelMeters * 0.1],
        rightTravel: [],
        unknownTravel: [],
      })
    ).toBe(false);
    expect(
      hasObservedWheelTravel({
        leftTravel: [],
        rightTravel: [WHEEL_PLAYBACK_MOTION_PARAMS.playbackSynthesisMinTravelMeters * 2],
        unknownTravel: [],
      })
    ).toBe(true);
  });

  it("clamps body-motion steps to configured speed ceilings", () => {
    const result = clampWheelPlaybackBodyMotionStep({
      linearTravel: LARGE_TRAVEL_INPUT,
      angularTravel: LARGE_TRAVEL_INPUT,
      dtSeconds: CLAMP_TEST_DT_SECONDS,
    });
    const expectedLinearStep = Math.max(
      WHEEL_PLAYBACK_MOTION_PARAMS.maxLinearSpeedMps * CLAMP_TEST_DT_SECONDS,
      WHEEL_PLAYBACK_MOTION_PARAMS.minLinearStepMeters
    );
    const expectedAngularStep = Math.max(
      WHEEL_PLAYBACK_MOTION_PARAMS.maxAngularSpeedRadps * CLAMP_TEST_DT_SECONDS,
      WHEEL_PLAYBACK_MOTION_PARAMS.minAngularStepRad
    );
    const expectedScale = Math.min(
      expectedLinearStep / LARGE_TRAVEL_INPUT,
      expectedAngularStep / LARGE_TRAVEL_INPUT
    );

    expect(result.linearTravel).toBeCloseTo(LARGE_TRAVEL_INPUT * expectedScale, 8);
    expect(result.angularTravel).toBeCloseTo(LARGE_TRAVEL_INPUT * expectedScale, 8);
    expect(result.hasMotion).toBe(true);
  });
});
