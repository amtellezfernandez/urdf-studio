import type { StructureGroupSection } from "@/features/layout/structureGroups";

type ReconcileCollapsedSectionIdsArgs = {
  previousCollapsedSectionIds: Set<string>;
  knownSectionIds: Set<string>;
  sections: StructureGroupSection[];
  collapseNewSectionsByDefault: boolean;
  collapseAllSections: boolean;
  pinnedExpandedSectionIds?: Set<string>;
};

type ReconcileCollapsedSectionIdsResult = {
  collapsedSectionIds: Set<string>;
  knownSectionIds: Set<string>;
};

const filterSetByMembership = (values: Set<string>, allowedValues: Set<string>): Set<string> => {
  const filtered = new Set<string>();
  values.forEach((value) => {
    if (allowedValues.has(value)) {
      filtered.add(value);
    }
  });
  return filtered;
};

export const areStringSetsEqual = (lhs: Set<string>, rhs: Set<string>): boolean => {
  if (lhs.size !== rhs.size) return false;
  for (const value of lhs) {
    if (!rhs.has(value)) {
      return false;
    }
  }
  return true;
};

export const resolveSectionsContainingItem = (
  sections: StructureGroupSection[],
  itemName: string | null | undefined
): Set<string> => {
  if (!itemName) {
    return new Set<string>();
  }
  return new Set(
    sections
      .filter((section) => section.items.includes(itemName))
      .map((section) => section.id)
  );
};

type ResolveVisibleSectionItemNamesArgs = {
  sectionItemNames: string[];
  isSectionCollapsed: boolean;
  activeItemNamesWhenCollapsed?: Set<string>;
};

export const resolveVisibleSectionItemNames = ({
  sectionItemNames,
  isSectionCollapsed,
  activeItemNamesWhenCollapsed = new Set<string>(),
}: ResolveVisibleSectionItemNamesArgs): string[] => {
  if (!isSectionCollapsed) {
    return sectionItemNames;
  }
  return sectionItemNames.filter((itemName) => activeItemNamesWhenCollapsed.has(itemName));
};

export const reconcileCollapsedSectionIds = ({
  previousCollapsedSectionIds,
  knownSectionIds,
  sections,
  collapseNewSectionsByDefault,
  collapseAllSections,
  pinnedExpandedSectionIds = new Set<string>(),
}: ReconcileCollapsedSectionIdsArgs): ReconcileCollapsedSectionIdsResult => {
  const availableSectionIds = new Set(sections.map((section) => section.id));
  const nextKnownSectionIds = new Set(availableSectionIds);
  const nextCollapsedSectionIds = collapseAllSections
    ? new Set(availableSectionIds)
    : filterSetByMembership(previousCollapsedSectionIds, availableSectionIds);

  if (!collapseAllSections && collapseNewSectionsByDefault) {
    availableSectionIds.forEach((sectionId) => {
      if (!knownSectionIds.has(sectionId)) {
        nextCollapsedSectionIds.add(sectionId);
      }
    });
  }

  pinnedExpandedSectionIds.forEach((sectionId) => {
    nextCollapsedSectionIds.delete(sectionId);
  });

  return {
    collapsedSectionIds: nextCollapsedSectionIds,
    knownSectionIds: nextKnownSectionIds,
  };
};
