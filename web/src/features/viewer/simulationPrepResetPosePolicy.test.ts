import { describe, expect, it } from "vitest";
import { shouldApplySimulationPrepResetPoseRequest } from "@/features/viewer/simulationPrepResetPosePolicy";

describe("shouldApplySimulationPrepResetPoseRequest", () => {
  it("applies a new reset request", () => {
    expect(
      shouldApplySimulationPrepResetPoseRequest({
        requestKey: "request-1",
        handledRequestKey: null,
      })
    ).toBe(true);
  });

  it("does not re-apply an already handled request", () => {
    expect(
      shouldApplySimulationPrepResetPoseRequest({
        requestKey: "request-1",
        handledRequestKey: "request-1",
      })
    ).toBe(false);
  });

  it("ignores missing requests", () => {
    expect(
      shouldApplySimulationPrepResetPoseRequest({
        requestKey: null,
        handledRequestKey: null,
      })
    ).toBe(false);
  });
});
