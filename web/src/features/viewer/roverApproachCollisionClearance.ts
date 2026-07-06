import { ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS } from "@/features/viewer/roverApproachBeforeIkSolveParams";

export const resolveRoverApproachCollisionPathClearanceM = ({
  useCase,
}: {
  useCase: "retreat-overlap" | "runtime-stop";
}): number =>
  useCase === "runtime-stop"
    ? ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionStopClearanceM
    : ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatCollisionPathClearanceM;
