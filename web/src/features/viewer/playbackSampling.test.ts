import { describe, expect, it } from "vitest";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import {
  buildFrameLockedJointValues,
  clampFrameIndexToFrameRange,
  clampTimestampToFrameRange,
  resolveFrameIndexAtOrAfterTimestamp,
  resolveFrameIndexAtOrBeforeTimestamp,
  resolveInterpolatedJointValues,
  resolveNearestFrameIndexAtTimestamp,
} from "@/features/viewer/playbackSampling";

const frames: AnimationFrame[] = [
  { timestamp: 1000, joints: { j1: 0, j2: 0.1 } },
  { timestamp: 1100, joints: { j1: 1, j2: 0.2 } },
  { timestamp: 1300, joints: { j1: 2, j2: 0.3 } },
];

describe("playbackSampling", () => {
  it("clamps frame indices to available frames", () => {
    expect(clampFrameIndexToFrameRange(frames, -4)).toBe(0);
    expect(clampFrameIndexToFrameRange(frames, 1)).toBe(1);
    expect(clampFrameIndexToFrameRange(frames, 99)).toBe(2);
  });

  it("falls back to the first frame for empty or non-finite indices", () => {
    expect(clampFrameIndexToFrameRange(frames, Number.NaN)).toBe(0);
    expect(clampFrameIndexToFrameRange([], 4)).toBe(0);
  });

  it("clamps timestamps to frame range", () => {
    expect(clampTimestampToFrameRange(frames, 900)).toBe(1000);
    expect(clampTimestampToFrameRange(frames, 1150)).toBe(1150);
    expect(clampTimestampToFrameRange(frames, 1400)).toBe(1300);
  });

  it("resolves frame indices deterministically around boundaries", () => {
    expect(resolveFrameIndexAtOrAfterTimestamp(frames, 999)).toBe(0);
    expect(resolveFrameIndexAtOrAfterTimestamp(frames, 1000)).toBe(0);
    expect(resolveFrameIndexAtOrAfterTimestamp(frames, 1001)).toBe(1);
    expect(resolveFrameIndexAtOrBeforeTimestamp(frames, 1001)).toBe(0);
    expect(resolveFrameIndexAtOrBeforeTimestamp(frames, 1299)).toBe(1);
    expect(resolveFrameIndexAtOrBeforeTimestamp(frames, 1300)).toBe(2);
    expect(resolveNearestFrameIndexAtTimestamp(frames, 1049)).toBe(0);
    expect(resolveNearestFrameIndexAtTimestamp(frames, 1051)).toBe(1);
    expect(resolveNearestFrameIndexAtTimestamp(frames, 1299)).toBe(2);
  });

  it("linearly interpolates joint values between recorded frames", () => {
    const early = resolveInterpolatedJointValues(frames, 1050);
    expect(early.j1).toBeCloseTo(0.5);
    expect(early.j2).toBeCloseTo(0.15);

    const late = resolveInterpolatedJointValues(frames, 1200);
    expect(late.j1).toBeCloseTo(1.5);
    expect(late.j2).toBeCloseTo(0.25);
  });

  it("builds frame-locked joints with carry-forward and finite filtering", () => {
    const prev = { j1: 0.5, j2: 0.2, j3: -1 };
    const { joints, hasNonFinite } = buildFrameLockedJointValues(prev, {
      j1: 1.2,
      j2: Number.NaN,
      j4: 3,
    });
    expect(hasNonFinite).toBe(true);
    expect(joints.j1).toBe(1.2);
    expect(joints.j2).toBe(0.2);
    expect(joints.j3).toBe(-1);
    expect(joints.j4).toBe(3);
  });

  it("can disable carry-forward to keep playback writes scoped to frame joints", () => {
    const prev = { j1: 0.5, j2: 0.2, j3: -1 };
    const { joints, hasNonFinite } = buildFrameLockedJointValues(
      prev,
      {
        j1: 1.2,
        j2: Number.NaN,
        j4: 3,
      },
      { preservePrevious: false }
    );
    expect(hasNonFinite).toBe(true);
    expect(joints).toEqual({
      j1: 1.2,
      j4: 3,
    });
  });
});
