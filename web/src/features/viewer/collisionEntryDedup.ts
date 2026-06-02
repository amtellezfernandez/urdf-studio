import type { CollisionEntry } from "@/shared/lib/urdfCore";

const encodeVector3 = (value: [number, number, number]) => value.join(",");

const encodeCollisionGeometry = (geometry: CollisionEntry["geometry"]) => {
  if (geometry.type === "box") {
    return `box:${encodeVector3(geometry.size)}`;
  }
  if (geometry.type === "sphere") {
    return `sphere:${geometry.radius}`;
  }
  if (geometry.type === "cylinder") {
    return `cylinder:${geometry.radius},${geometry.length}`;
  }
  return `mesh:${geometry.filename}:${encodeVector3(geometry.scale)}`;
};

export const toCollisionEntryDedupKey = (entry: CollisionEntry) =>
  `${entry.linkName}|${encodeVector3(entry.origin.xyz)}|${encodeVector3(entry.origin.rpy)}|${encodeCollisionGeometry(entry.geometry)}`;

export const markAndCheckDuplicateCollisionEntry = (
  seen: Set<string>,
  entry: CollisionEntry
) => {
  const key = toCollisionEntryDedupKey(entry);
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
};
