import type { LinkData } from "@/shared/lib/urdfBrowser";

export const resolveLinkBrowserEmptyState = (searchQuery: string): string =>
  searchQuery ? "No links match the search" : "No links available";

export const resolveVisibleLinkNames = ({
  effectiveEndEffectorLink,
  isCollapsed,
  sectionItemNames,
}: {
  effectiveEndEffectorLink: string | null;
  isCollapsed: boolean;
  sectionItemNames: readonly string[];
}): readonly string[] => {
  if (!isCollapsed) {
    return sectionItemNames;
  }
  if (effectiveEndEffectorLink && sectionItemNames.includes(effectiveEndEffectorLink)) {
    return [effectiveEndEffectorLink];
  }
  return [];
};

export const isEntireLinkSectionBatchSelected = ({
  sectionItemNames,
  selectedBatchLinks,
}: {
  sectionItemNames: readonly string[];
  selectedBatchLinks: ReadonlySet<string>;
}): boolean =>
  sectionItemNames.length > 0 &&
  sectionItemNames.every((linkName) => selectedBatchLinks.has(linkName));

export const linkHasMeshVisual = (linkData: LinkData | null | undefined): boolean =>
  Boolean(
    linkData?.visuals.some(
      (visual) => visual.geometry.type === "mesh" && Boolean(visual.geometry.params.filename)
    )
  );

export const canAddMeshCollisionForLink = ({
  hasUrdfCollision,
  linkData,
}: {
  hasUrdfCollision: boolean;
  linkData: LinkData | null | undefined;
}): boolean => !hasUrdfCollision && linkHasMeshVisual(linkData);

export const resolveLinkStatusSummary = ({
  hasEeStatus,
  isCollisionMerged,
  isCollisionSimplified,
}: {
  hasEeStatus: boolean;
  isCollisionMerged: boolean;
  isCollisionSimplified: boolean;
}): {
  label: string;
  title: string;
} => {
  const label = [
    isCollisionMerged ? "Mrg" : isCollisionSimplified ? "Simp" : null,
    hasEeStatus ? "EE" : null,
  ]
    .filter((value): value is string => value !== null)
    .join("+");

  const title = [
    isCollisionMerged
      ? "Merged collision active"
      : isCollisionSimplified
        ? "Collision simplification enabled"
        : null,
    hasEeStatus ? "Marked as end effector" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" • ");

  return { label, title };
};
