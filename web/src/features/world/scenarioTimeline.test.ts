import { describe, expect, it } from "vitest";
import {
  clampToScenarioTime,
  createWorldScenarioClock,
  normalizeScenarioTime,
  toScenarioTimeFromFrame,
} from "./scenarioTimeline";

const TIMELINE_TEST_VECTORS = {
  durationMs: 1000,
  overflowMs: 1200,
  negativeMs: -100,
  expectedOverflowNormalizedMs: 200,
  expectedNegativeNormalizedMs: 900,
  frameMapping: {
    durationMs: 9000,
    totalFrames: 10,
    startFrame: 0,
    middleFrame: 4,
    lastFrame: 9,
    outOfRangeFrame: 99,
    expectedMiddleTimeMs: 4000,
  },
  loopingClock: {
    initialMs: 900,
    deltaMs: 250,
    expectedMs: 150,
  },
  nonLoopingClock: {
    initialMs: 200,
    forwardDeltaMs: 900,
    backwardDeltaMs: -1200,
  },
} as const;

describe("scenarioTimeline", () => {
  it("normalizes time in looping mode", () => {
    expect(
      normalizeScenarioTime(
        TIMELINE_TEST_VECTORS.overflowMs,
        TIMELINE_TEST_VECTORS.durationMs
      )
    ).toBe(TIMELINE_TEST_VECTORS.expectedOverflowNormalizedMs);
    expect(
      normalizeScenarioTime(
        TIMELINE_TEST_VECTORS.negativeMs,
        TIMELINE_TEST_VECTORS.durationMs
      )
    ).toBe(TIMELINE_TEST_VECTORS.expectedNegativeNormalizedMs);
  });

  it("clamps time in non-looping mode", () => {
    expect(
      clampToScenarioTime(
        TIMELINE_TEST_VECTORS.negativeMs,
        TIMELINE_TEST_VECTORS.durationMs
      )
    ).toBe(0);
    expect(
      clampToScenarioTime(
        TIMELINE_TEST_VECTORS.overflowMs,
        TIMELINE_TEST_VECTORS.durationMs
      )
    ).toBe(TIMELINE_TEST_VECTORS.durationMs);
  });

  it("maps frame index to scenario time", () => {
    const frameMapping = TIMELINE_TEST_VECTORS.frameMapping;
    expect(
      toScenarioTimeFromFrame(
        frameMapping.startFrame,
        frameMapping.totalFrames,
        frameMapping.durationMs
      )
    ).toBe(0);
    expect(
      toScenarioTimeFromFrame(
        frameMapping.lastFrame,
        frameMapping.totalFrames,
        frameMapping.durationMs
      )
    ).toBe(frameMapping.durationMs);
    expect(
      toScenarioTimeFromFrame(
        frameMapping.middleFrame,
        frameMapping.totalFrames,
        frameMapping.durationMs
      )
    ).toBe(frameMapping.expectedMiddleTimeMs);
    expect(
      toScenarioTimeFromFrame(
        frameMapping.outOfRangeFrame,
        frameMapping.totalFrames,
        frameMapping.durationMs
      )
    ).toBe(frameMapping.durationMs);
  });

  it("advances looping clock across duration boundaries", () => {
    const loopCase = TIMELINE_TEST_VECTORS.loopingClock;
    const clock = createWorldScenarioClock({
      durationMs: TIMELINE_TEST_VECTORS.durationMs,
      loop: true,
      initialTimeMs: loopCase.initialMs,
    });
    expect(clock.advance(loopCase.deltaMs)).toBe(loopCase.expectedMs);
    expect(clock.getTimeMs()).toBe(loopCase.expectedMs);
  });

  it("advances non-looping clock with hard bounds", () => {
    const nonLoopCase = TIMELINE_TEST_VECTORS.nonLoopingClock;
    const clock = createWorldScenarioClock({
      durationMs: TIMELINE_TEST_VECTORS.durationMs,
      loop: false,
      initialTimeMs: nonLoopCase.initialMs,
    });
    expect(clock.advance(nonLoopCase.forwardDeltaMs)).toBe(
      TIMELINE_TEST_VECTORS.durationMs
    );
    expect(clock.advance(nonLoopCase.backwardDeltaMs)).toBe(0);
  });
});
