import { describe, expect, it } from "vitest";
import {
  resolveRemountPreservedFrameTimestamp,
} from "@/features/viewer/demoRobotPolicy";

describe("demoRobotPolicy", () => {
  it("preserves the current demo frame timestamp across remounts", () => {
    expect(
      resolveRemountPreservedFrameTimestamp({
        animationFrames: [{ timestamp: 100, joints: {} }, { timestamp: 240, joints: {} }],
        currentFrameIndex: 1,
      })
    ).toBe(240);
  });

  it("preserves remount timestamps outside demo mode as well", () => {
    expect(
      resolveRemountPreservedFrameTimestamp({
        animationFrames: [{ timestamp: 100, joints: {} }],
        currentFrameIndex: 0,
      })
    ).toBe(100);
  });
});
