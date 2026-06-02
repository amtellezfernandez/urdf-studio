type IkObjectPreSolveTerminalResult = {
  status: "completed" | "skipped" | "timeout" | "cancelled" | "failed";
  reason?: string;
};

const NON_TERMINAL_PRE_SOLVE_REASONS = new Set(["contact-corridor-blocked"]);
const RETRYABLE_BLOCKED_TARGET_REASONS = new Set(["collision-blocked"]);
const PRE_SOLVE_TIMEOUT_REASON_MESSAGES = new Map<string, string>([
  ["timeout", "Rover approach timed out"],
  [
    "waypoint-timeout",
    "Rover approach timed out before reaching the planned route",
  ],
]);

const normalizePreSolveReason = (reason?: string) => reason?.trim() ?? "";

export const shouldAbortIkSolveAfterPreSolve = (
  result: IkObjectPreSolveTerminalResult
): boolean =>
  result.status === "cancelled" ||
  (result.status === "failed" &&
    !NON_TERMINAL_PRE_SOLVE_REASONS.has(normalizePreSolveReason(result.reason))) ||
  result.status === "timeout";

export const shouldRememberBlockedTargetAfterPreSolve = (
  result: IkObjectPreSolveTerminalResult
): boolean =>
  result.status === "failed" &&
  RETRYABLE_BLOCKED_TARGET_REASONS.has(normalizePreSolveReason(result.reason));

export const canRetryRememberedBlockedTarget = ({
  hasRememberedTarget,
  isFollowingOrbit,
  isIkHandleDragging,
  isIkRunning,
}: {
  hasRememberedTarget: boolean;
  isFollowingOrbit: boolean;
  isIkHandleDragging: boolean;
  isIkRunning: boolean;
}): boolean =>
  hasRememberedTarget && !isFollowingOrbit && !isIkHandleDragging && !isIkRunning;

export const resolveIkPreSolveTerminalErrorMessage = (
  result: IkObjectPreSolveTerminalResult
): string | null => {
  if (result.status === "failed") {
    if (NON_TERMINAL_PRE_SOLVE_REASONS.has(normalizePreSolveReason(result.reason))) {
      return null;
    }
    return normalizePreSolveReason(result.reason) || "Rover approach failed";
  }
  if (result.status === "timeout") {
    const normalizedReason = normalizePreSolveReason(result.reason);
    return (
      PRE_SOLVE_TIMEOUT_REASON_MESSAGES.get(normalizedReason) ||
      normalizedReason ||
      "Rover approach timed out"
    );
  }
  return null;
};
