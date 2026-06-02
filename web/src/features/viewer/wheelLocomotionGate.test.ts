import { describe, expect, it } from "vitest";
import { isWheelLocomotionAllowed } from "@/features/viewer/wheelLocomotionGate";

describe("isWheelLocomotionAllowed", () => {
  it("allows locomotion only for explicit manual drag while armed", () => {
    expect(
      isWheelLocomotionAllowed({
        isWheelLocomotionArmed: true,
        isManualDragActive: true,
        isPlaybackActive: false,
        isAutoApproachActive: false,
      })
    ).toBe(true);
  });

  it("blocks locomotion during playback", () => {
    expect(
      isWheelLocomotionAllowed({
        isWheelLocomotionArmed: true,
        isManualDragActive: true,
        isPlaybackActive: true,
        isAutoApproachActive: false,
      })
    ).toBe(false);
  });

  it("blocks locomotion when manual drag is not active", () => {
    expect(
      isWheelLocomotionAllowed({
        isWheelLocomotionArmed: true,
        isManualDragActive: false,
        isPlaybackActive: false,
        isAutoApproachActive: false,
      })
    ).toBe(false);
  });

  it("blocks locomotion during automatic approach", () => {
    expect(
      isWheelLocomotionAllowed({
        isWheelLocomotionArmed: true,
        isManualDragActive: true,
        isPlaybackActive: false,
        isAutoApproachActive: true,
      })
    ).toBe(false);
  });
});
