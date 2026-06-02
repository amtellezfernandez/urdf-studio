import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { CollisionEntry } from "@/shared/lib/urdfCore";

const hasOwn = (obj: object, key: number): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

export const isCollisionEntryVisible = (
  collisionVisibility: CollisionVisibility,
  linkName: string,
  collisionIndex: number
): boolean => {
  const linkVisibility = collisionVisibility[linkName];
  if (!linkVisibility) return true;
  if (!hasOwn(linkVisibility, collisionIndex)) return true;
  return linkVisibility[collisionIndex] !== false;
};

export const hasRenderableCollisionEntries = (
  collisionsByLink: Record<string, CollisionEntry[]>,
  collisionVisibility: CollisionVisibility
): boolean => {
  for (const [linkName, collisions] of Object.entries(collisionsByLink)) {
    for (const collision of collisions) {
      if (isCollisionEntryVisible(collisionVisibility, linkName, collision.index)) {
        return true;
      }
    }
  }
  return false;
};
