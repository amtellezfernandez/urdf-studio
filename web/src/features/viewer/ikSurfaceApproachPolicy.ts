import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { ROVER_APPROACH_CONFIG } from "@/features/locomotion/approach";
import { resolveArmReachEnvelope } from "@/features/viewer/armReach";

type ShouldRetryRoverApproachForSurfaceTargetArgs = {
  robot: URDFRobot | null;
  urdfAnalysis: UrdfAnalysis | null;
  endEffectorLink: string | null;
  maxLinkTraversal: number;
  targetPosition: [number, number, number];
};

type SurfaceTargetApproachRetryPreSolveStatus =
  | "completed"
  | "skipped"
  | "timeout"
  | "cancelled"
  | "failed"
  | null;

export const shouldRetryRoverApproachForSurfaceTarget = ({
  robot,
  urdfAnalysis,
  endEffectorLink,
  maxLinkTraversal,
  targetPosition,
}: ShouldRetryRoverApproachForSurfaceTargetArgs): boolean => {
  const envelope = resolveArmReachEnvelope({
    robot,
    urdfAnalysis,
    endEffectorLink,
    maxLinkTraversal,
  });
  if (!envelope) {
    return false;
  }
  const distanceToTargetM = envelope.basePositionWorld.distanceTo(
    new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2])
  );
  return (
    distanceToTargetM >
    envelope.radiusMeters - ROVER_APPROACH_CONFIG.reachGapTriggerM
  );
};

export const shouldRunSurfaceTargetApproachRetry = ({
  hasPreSolveHandler,
  isOrbitTarget,
  wheelDriveEnabled,
  initialPreSolveStatus,
  ...surfaceRetryArgs
}: ShouldRetryRoverApproachForSurfaceTargetArgs & {
  hasPreSolveHandler: boolean;
  isOrbitTarget: boolean;
  wheelDriveEnabled: boolean;
  initialPreSolveStatus: SurfaceTargetApproachRetryPreSolveStatus;
}): boolean => {
  if (
    !hasPreSolveHandler ||
    isOrbitTarget ||
    !wheelDriveEnabled ||
    initialPreSolveStatus === "completed"
  ) {
    return false;
  }
  return shouldRetryRoverApproachForSurfaceTarget(surfaceRetryArgs);
};
