import type { AssemblyPose } from "@/features/assembly/store/useAssemblyPlacementStore";
import { parseAssemblyContactPairKey } from "@/features/assembly/store/assemblyContactPair";
import { ASSEMBLY_PLACEMENT_HELPERS_PARAMS } from "@/features/viewer/assemblyPlacementHelpersParams";

export type AssemblyPlacementPoseMap = Record<string, AssemblyPose>;
export type AssemblyPlacementRadiusMap = Record<string, number>;
export type AssemblyPlacementTuple3 = [number, number, number];

export type AssemblyContactSegment = {
  id: string;
  from: AssemblyPlacementTuple3;
  to: AssemblyPlacementTuple3;
};

export type AssemblySelectedGuide = {
  from: AssemblyPlacementTuple3;
  to: AssemblyPlacementTuple3;
  snap: AssemblyPlacementTuple3;
  axisCorner: AssemblyPlacementTuple3;
  axisXAligned: boolean;
  axisZAligned: boolean;
  gapMeters: number;
  isNearContact: boolean;
};

type AssemblySelectedGuideCandidate = {
  pose: AssemblyPose;
  absGap: number;
  snapX: number;
  snapZ: number;
};

export const parseAssemblyContactPair = parseAssemblyContactPairKey;

export const resolveAssemblyHelperRadius = (radius: number | undefined): number =>
  Math.max(
    radius ?? ASSEMBLY_PLACEMENT_HELPERS_PARAMS.defaultRadiusM,
    ASSEMBLY_PLACEMENT_HELPERS_PARAMS.minRadiusM
  );

export const buildAssemblyContactRobotIds = (
  contactPairs: readonly string[]
): Set<string> => {
  const robotIds = new Set<string>();
  contactPairs.forEach((pairKey) => {
    const parsed = parseAssemblyContactPair(pairKey);
    if (!parsed) return;
    robotIds.add(parsed[0]);
    robotIds.add(parsed[1]);
  });
  return robotIds;
};

export const buildAssemblyContactSegments = ({
  contactPairs,
  poses,
}: {
  contactPairs: readonly string[];
  poses: AssemblyPlacementPoseMap;
}): AssemblyContactSegment[] =>
  contactPairs
    .map((pairKey, index) => {
      const parsed = parseAssemblyContactPair(pairKey);
      if (!parsed) return null;
      const lhs = poses[parsed[0]];
      const rhs = poses[parsed[1]];
      if (!lhs || !rhs) return null;
      return {
        id: `${pairKey}-${index}`,
        from: [
          lhs.x,
          ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactLineHeightM,
          lhs.z,
        ] as AssemblyPlacementTuple3,
        to: [
          rhs.x,
          ASSEMBLY_PLACEMENT_HELPERS_PARAMS.contactLineHeightM,
          rhs.z,
        ] as AssemblyPlacementTuple3,
      };
    })
    .filter((item): item is AssemblyContactSegment => Boolean(item));

export const resolveAssemblySelectedGuide = ({
  poses,
  radii,
  selectedRobotId,
}: {
  poses: AssemblyPlacementPoseMap;
  radii: AssemblyPlacementRadiusMap;
  selectedRobotId: string | null;
}): AssemblySelectedGuide | null => {
  if (!selectedRobotId) return null;
  const selectedPose = poses[selectedRobotId];
  if (!selectedPose) return null;
  const selectedRadius = resolveAssemblyHelperRadius(radii[selectedRobotId]);
  const candidates = Object.entries(poses).filter(([robotId]) => robotId !== selectedRobotId);
  if (candidates.length === 0) return null;

  let best: AssemblySelectedGuideCandidate | null = null;

  candidates.forEach(([robotId, pose]) => {
    const otherRadius = resolveAssemblyHelperRadius(radii[robotId]);
    const dx = selectedPose.x - pose.x;
    const dz = selectedPose.z - pose.z;
    const distance = Math.hypot(dx, dz);
    const targetDistance = selectedRadius + otherRadius;
    const absGap = Math.abs(distance - targetDistance);
    const dirX =
      distance > ASSEMBLY_PLACEMENT_HELPERS_PARAMS.directionEpsilonM
        ? dx / distance
        : Math.cos(selectedPose.yaw);
    const dirZ =
      distance > ASSEMBLY_PLACEMENT_HELPERS_PARAMS.directionEpsilonM
        ? dz / distance
        : Math.sin(selectedPose.yaw);
    const snapX = pose.x + dirX * targetDistance;
    const snapZ = pose.z + dirZ * targetDistance;
    if (!best || absGap < best.absGap) {
      best = { pose, absGap, snapX, snapZ };
    }
  });

  if (!best) return null;
  const guideHeightM = ASSEMBLY_PLACEMENT_HELPERS_PARAMS.guideLineHeightM;
  const axisCorner = [best.pose.x, guideHeightM, selectedPose.z] as AssemblyPlacementTuple3;
  const nearestPoint = [best.pose.x, guideHeightM, best.pose.z] as AssemblyPlacementTuple3;
  const axisAlignmentToleranceM =
    ASSEMBLY_PLACEMENT_HELPERS_PARAMS.guideAxisAlignmentToleranceM;
  return {
    from: [selectedPose.x, guideHeightM, selectedPose.z] as AssemblyPlacementTuple3,
    to: nearestPoint,
    snap: [best.snapX, guideHeightM, best.snapZ] as AssemblyPlacementTuple3,
    axisCorner,
    axisXAligned: Math.abs(selectedPose.x - best.pose.x) <= axisAlignmentToleranceM,
    axisZAligned: Math.abs(selectedPose.z - best.pose.z) <= axisAlignmentToleranceM,
    gapMeters: best.absGap,
    isNearContact: best.absGap <= ASSEMBLY_PLACEMENT_HELPERS_PARAMS.nearContactGapM,
  };
};
