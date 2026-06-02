import { describe, expect, it } from "vitest";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import {
  buildFrameLockedJointValues,
  clampTimestampToFrameRange,
  resolveFrameIndexAtOrAfterTimestamp,
  resolveFrameIndexAtOrBeforeTimestamp,
  resolveNearestFrameIndexAtTimestamp,
} from "@/features/viewer/playbackSampling";

const frames: AnimationFrame[] = [
  { timestamp: 1000, joints: { j1: 0, j2: 0.1 } },
  { timestamp: 1100, joints: { j1: 1, j2: 0.2 } },
  { timestamp: 1300, joints: { j1: 2, j2: 0.3 } },
];

describe("playbackSampling", () => {
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
