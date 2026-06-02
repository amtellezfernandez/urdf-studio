import type { CollisionEntry } from "@/shared/lib/urdfCore";

const toPoseAxisKey = (value: [number, number, number]) => value.join(",");

export const toCollisionEntryPoseKey = (entry: CollisionEntry) =>
  `${entry.linkName}|${toPoseAxisKey(entry.origin.xyz)}|${toPoseAxisKey(entry.origin.rpy)}`;

export const buildMeshCollisionPoseSet = (entries: CollisionEntry[]) => {
  const meshPoseSet = new Set<string>();
  entries.forEach((entry) => {
    if (entry.geometry.type !== "mesh") return;
    meshPoseSet.add(toCollisionEntryPoseKey(entry));
  });
  return meshPoseSet;
};

export const shouldSkipPrimitiveCollisionWhenMeshOverlaps = (
  entry: CollisionEntry,
  meshPoseSet: ReadonlySet<string>
) => {
  if (entry.geometry.type === "mesh") return false;
  return meshPoseSet.has(toCollisionEntryPoseKey(entry));
};
