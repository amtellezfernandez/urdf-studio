import type { IkSolverId, IkSolveStrategy } from "./types";

export const DEFAULT_IK_SOLVER_CHAIN: IkSolverId[] = ["pyroki-http"];

export type OrientationMode = "required" | "optional" | "prefer" | "ignore";

export const buildIkStrategies = (
  solverChain: IkSolverId[],
  orientationMode: OrientationMode,
  hasOrientation: boolean
): IkSolveStrategy[] => {
  const attempts: boolean[] = [];

  if (orientationMode === "ignore") {
    attempts.push(true);
  } else if (!hasOrientation) {
    attempts.push(true);
  } else if (orientationMode === "required") {
    attempts.push(false);
  } else if (orientationMode === "optional") {
    attempts.push(true, false);
  } else {
    // "prefer" - strict orientation then fallback
    attempts.push(false, true);
  }

  return solverChain.flatMap((solverId) =>
    attempts.map((ignoreOrientation) => ({ solverId, ignoreOrientation }))
  );
};
