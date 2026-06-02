import { describe, expect, it } from "vitest";

import {
  advancePlaybackClockTime,
  clampPlaybackWallClockStepMs,
  resolvePlaybackAnchorTime,
} from "@/features/viewer/playback/playbackClock";
import { PLAYBACK_MAX_WALL_CLOCK_STEP_MS } from "@/features/viewer/playback/playbackParams";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

const FIRST_FRAME_TIMESTAMP_MS = 0;
const SECOND_FRAME_TIMESTAMP_MS = 100;
const LAST_FRAME_TIMESTAMP_MS = 200;
const STALL_STEP_MS = PLAYBACK_MAX_WALL_CLOCK_STEP_MS * 5;
const HALF_SPEED = 0.5;
const EXPECTED_HALF_SPEED_ADVANCE_MS = PLAYBACK_MAX_WALL_CLOCK_STEP_MS * HALF_SPEED;

const TEST_FRAMES: AnimationFrame[] = [
  { timestamp: FIRST_FRAME_TIMESTAMP_MS, joints: {} },
  { timestamp: SECOND_FRAME_TIMESTAMP_MS, joints: {} },
  { timestamp: LAST_FRAME_TIMESTAMP_MS, joints: {} },
];

describe("playbackClock", () => {
  it("clamps invalid and oversized wall-clock steps", () => {
    expect(clampPlaybackWallClockStepMs(Number.NaN, PLAYBACK_MAX_WALL_CLOCK_STEP_MS)).toBe(0);
    expect(clampPlaybackWallClockStepMs(-1, PLAYBACK_MAX_WALL_CLOCK_STEP_MS)).toBe(0);
    expect(
      clampPlaybackWallClockStepMs(STALL_STEP_MS, PLAYBACK_MAX_WALL_CLOCK_STEP_MS)
    ).toBe(PLAYBACK_MAX_WALL_CLOCK_STEP_MS);
  });

  it("anchors playback to the selected frame timestamp", () => {
    expect(resolvePlaybackAnchorTime(TEST_FRAMES, 1)).toBe(SECOND_FRAME_TIMESTAMP_MS);
  });

  it("limits playback advancement after a long render stall", () => {
    const initial = advancePlaybackClockTime({
      currentPlaybackTime: FIRST_FRAME_TIMESTAMP_MS,
      frames: TEST_FRAMES,
      maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      nowMs: 1000,
      playbackSpeed: 1,
      previousNowMs: null,
    });

    const advanced = advancePlaybackClockTime({
      currentPlaybackTime: initial.playbackTime,
      frames: TEST_FRAMES,
      maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      nowMs: 1000 + STALL_STEP_MS,
      playbackSpeed: 1,
      previousNowMs: initial.previousNowMs,
    });

    expect(advanced.playbackTime).toBe(PLAYBACK_MAX_WALL_CLOCK_STEP_MS);
  });

  it("applies playback speed when advancing", () => {
    const initial = advancePlaybackClockTime({
      currentPlaybackTime: FIRST_FRAME_TIMESTAMP_MS,
      frames: TEST_FRAMES,
      maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      nowMs: 1000,
      playbackSpeed: HALF_SPEED,
      previousNowMs: null,
    });

    const advanced = advancePlaybackClockTime({
      currentPlaybackTime: initial.playbackTime,
      frames: TEST_FRAMES,
      maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      nowMs: 1000 + PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      playbackSpeed: HALF_SPEED,
      previousNowMs: initial.previousNowMs,
    });

    expect(advanced.playbackTime).toBe(EXPECTED_HALF_SPEED_ADVANCE_MS);
  });

  it("never advances past the last frame timestamp", () => {
    const advanced = advancePlaybackClockTime({
      currentPlaybackTime: LAST_FRAME_TIMESTAMP_MS - 10,
      frames: TEST_FRAMES,
      maxStepMs: PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      nowMs: 1000 + PLAYBACK_MAX_WALL_CLOCK_STEP_MS,
      playbackSpeed: 1,
      previousNowMs: 1000,
    });

    expect(advanced.playbackTime).toBe(LAST_FRAME_TIMESTAMP_MS);
  });
});
