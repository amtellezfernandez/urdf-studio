import { describe, expect, it } from "vitest";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import {
  resolveFrozenPlaybackFrameSelection,
  resolvePlaybackFrameSelection,
} from "@/features/viewer/playback/frameSelection";

const FRAMES: AnimationFrame[] = [
  { timestamp: 0, joints: {} },
  { timestamp: 100, joints: {} },
  { timestamp: 250, joints: {} },
];

describe("frameSelection", () => {
  it("resolves a clamped causal frame selection", () => {
    const selection = resolvePlaybackFrameSelection(FRAMES, 120);
    expect(selection).toEqual({
      frameTime: 120,
      frameIndex: 1,
    });
  });

  it("never advances playback to a future frame", () => {
    const selection = resolvePlaybackFrameSelection(FRAMES, 249);
    expect(selection).toEqual({
      frameTime: 249,
      frameIndex: 1,
    });
  });

  it("clamps timestamp below range to first frame", () => {
    const selection = resolvePlaybackFrameSelection(FRAMES, -10);
    expect(selection).toEqual({
      frameTime: 0,
      frameIndex: 0,
    });
  });

  it("resolves frozen frame selection with clamped index", () => {
    const selection = resolveFrozenPlaybackFrameSelection(FRAMES, 99);
    expect(selection).toEqual({
      frameTime: 250,
      frameIndex: 2,
    });
  });
});
