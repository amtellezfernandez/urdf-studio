import type { StructureGroupSection } from "@/features/layout/structureGroups";
import {
  areStringSetsEqual,
  filterStringSetMembers,
} from "@/features/layout/stringSetHelpers";

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

export { areStringSetsEqual } from "@/features/layout/stringSetHelpers";

export const buildAvailableSectionIdSet = (
  sections: StructureGroupSection[]
): Set<string> => new Set(sections.map((section) => section.id));

export const resolveCollapsedSectionIdSet = ({
  availableSectionIds,
  collapseAllSections,
  collapseNewSectionsByDefault,
  knownSectionIds,
  pinnedExpandedSectionIds = new Set<string>(),
  previousCollapsedSectionIds,
}: {
  availableSectionIds: Set<string>;
  collapseAllSections: boolean;
  collapseNewSectionsByDefault: boolean;
  knownSectionIds: Set<string>;
  pinnedExpandedSectionIds?: Set<string>;
  previousCollapsedSectionIds: Set<string>;
}): Set<string> => {
  const nextCollapsedSectionIds = collapseAllSections
    ? new Set(availableSectionIds)
    : filterStringSetMembers(previousCollapsedSectionIds, availableSectionIds);

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

  return nextCollapsedSectionIds;
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
  const availableSectionIds = buildAvailableSectionIdSet(sections);
  const nextKnownSectionIds = new Set(availableSectionIds);
  const nextCollapsedSectionIds = resolveCollapsedSectionIdSet({
    availableSectionIds,
    collapseAllSections,
    collapseNewSectionsByDefault,
    knownSectionIds,
    pinnedExpandedSectionIds,
    previousCollapsedSectionIds,
  });

  return {
    collapsedSectionIds: nextCollapsedSectionIds,
    knownSectionIds: nextKnownSectionIds,
  };
};
