import { describe, expect, it } from "vitest";

import { shouldApplyFrameLockedJoints } from "@/features/viewer/playback/jointFrameApplyPolicy";

describe("shouldApplyFrameLockedJoints", () => {
  it("applies a data-zero source change while paused after manual joint edits", () => {
    expect(
      shouldApplyFrameLockedJoints({
        shouldApplyAnimation: false,
        shouldForceApplyDataZeroOffset: true,
        skipForManualDragOverride: false,
        hasManualJointChanges: true,
        isPlaying: false,
      }),
    ).toBe(true);
  });

  it("preserves paused manual joint edits when the replay source has not changed", () => {
    expect(
      shouldApplyFrameLockedJoints({
        shouldApplyAnimation: false,
        shouldForceApplyDataZeroOffset: false,
        skipForManualDragOverride: false,
        hasManualJointChanges: true,
        isPlaying: false,
      }),
    ).toBe(false);
  });

  it("does not overwrite active manual drags", () => {
    expect(
      shouldApplyFrameLockedJoints({
        shouldApplyAnimation: true,
        shouldForceApplyDataZeroOffset: true,
        skipForManualDragOverride: true,
        hasManualJointChanges: false,
        isPlaying: true,
      }),
    ).toBe(false);
  });
});
