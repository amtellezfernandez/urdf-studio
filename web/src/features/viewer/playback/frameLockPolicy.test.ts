import { describe, expect, it } from "vitest";
import { shouldApplyManualFrameLock } from "@/features/viewer/playback/frameLockPolicy";

describe("shouldApplyManualFrameLock", () => {
  it("always applies during active playback", () => {
    expect(
      shouldApplyManualFrameLock({
        isPlaying: true,
        consumedPreservedFrameTime: false,
        pausedManualFrameTimeChanged: false,
      })
    ).toBe(true);
  });

  it("applies once when stop preserved frame time was consumed", () => {
    expect(
      shouldApplyManualFrameLock({
        isPlaying: false,
        consumedPreservedFrameTime: true,
        pausedManualFrameTimeChanged: false,
      })
    ).toBe(true);
  });

  it("applies once when paused manual frame changes", () => {
    expect(
      shouldApplyManualFrameLock({
        isPlaying: false,
        consumedPreservedFrameTime: false,
        pausedManualFrameTimeChanged: true,
      })
    ).toBe(true);
  });

  it("does not apply repeatedly while paused when frame is unchanged", () => {
    expect(
      shouldApplyManualFrameLock({
        isPlaying: false,
        consumedPreservedFrameTime: false,
        pausedManualFrameTimeChanged: false,
      })
    ).toBe(false);
  });
});
