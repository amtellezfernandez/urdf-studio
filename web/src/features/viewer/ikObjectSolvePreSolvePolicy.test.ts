import { describe, expect, it } from "vitest";

import {
  canRetryRememberedBlockedTarget,
  resolveIkPreSolveTerminalErrorMessage,
  shouldAbortIkSolveAfterPreSolve,
  shouldRememberBlockedTargetAfterPreSolve,
} from "@/features/viewer/ikObjectSolvePreSolvePolicy";

describe("ikObjectSolvePreSolvePolicy", () => {
  it("aborts the solve after cancelled, failed, or timed out rover approach results", () => {
    expect(shouldAbortIkSolveAfterPreSolve({ status: "cancelled" })).toBe(true);
    expect(shouldAbortIkSolveAfterPreSolve({ status: "failed" })).toBe(true);
    expect(
      shouldAbortIkSolveAfterPreSolve({
        status: "failed",
        reason: "contact-corridor-blocked",
      })
    ).toBe(false);
    expect(shouldAbortIkSolveAfterPreSolve({ status: "timeout" })).toBe(true);
    expect(shouldAbortIkSolveAfterPreSolve({ status: "completed" })).toBe(false);
    expect(shouldAbortIkSolveAfterPreSolve({ status: "skipped" })).toBe(false);
  });

  it("remembers only collision-blocked targets for drag-end retries", () => {
    expect(
      shouldRememberBlockedTargetAfterPreSolve({
        status: "failed",
        reason: "collision-blocked",
      })
    ).toBe(true);
    expect(
      shouldRememberBlockedTargetAfterPreSolve({
        status: "failed",
        reason: "path-blocked",
      })
    ).toBe(false);
    expect(
      shouldRememberBlockedTargetAfterPreSolve({
        status: "cancelled",
        reason: "collision-blocked",
      })
    ).toBe(false);
  });

  it("retries remembered blocked targets only when the object interaction is idle", () => {
    expect(
      canRetryRememberedBlockedTarget({
        hasRememberedTarget: true,
        isFollowingOrbit: false,
        isIkHandleDragging: false,
        isIkRunning: false,
      })
    ).toBe(true);
    expect(
      canRetryRememberedBlockedTarget({
        hasRememberedTarget: false,
        isFollowingOrbit: false,
        isIkHandleDragging: false,
        isIkRunning: false,
      })
    ).toBe(false);
    expect(
      canRetryRememberedBlockedTarget({
        hasRememberedTarget: true,
        isFollowingOrbit: true,
        isIkHandleDragging: false,
        isIkRunning: false,
      })
    ).toBe(false);
    expect(
      canRetryRememberedBlockedTarget({
        hasRememberedTarget: true,
        isFollowingOrbit: false,
        isIkHandleDragging: true,
        isIkRunning: false,
      })
    ).toBe(false);
    expect(
      canRetryRememberedBlockedTarget({
        hasRememberedTarget: true,
        isFollowingOrbit: false,
        isIkHandleDragging: false,
        isIkRunning: true,
      })
    ).toBe(false);
  });

  it("suppresses corridor-miss messages while keeping real failures and timeouts", () => {
    expect(
      resolveIkPreSolveTerminalErrorMessage({
        status: "failed",
        reason: "contact-corridor-blocked",
      })
    ).toBeNull();
    expect(
      resolveIkPreSolveTerminalErrorMessage({
        status: "failed",
        reason: "collision-blocked",
      })
    ).toBe("collision-blocked");
    expect(resolveIkPreSolveTerminalErrorMessage({ status: "timeout" })).toBe(
      "Rover approach timed out"
    );
    expect(
      resolveIkPreSolveTerminalErrorMessage({
        status: "timeout",
        reason: "waypoint-timeout",
      })
    ).toBe("Rover approach timed out before reaching the planned route");
    expect(resolveIkPreSolveTerminalErrorMessage({ status: "cancelled" })).toBeNull();
  });
});
