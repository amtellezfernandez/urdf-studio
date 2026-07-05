import {
  normalizeStructureGroupDisplayLabel,
  parseStructureGroupLabel,
  resolveStructureGroupLabelForName,
  STRUCTURE_GROUP_ORDER,
} from "@/features/layout/structureGroupHelpers";

export type StructureGroupSection = {
  id: string;
  label: string;
  items: string[];
};

export const sortStructureGroupLabels = (lhs: string, rhs: string): number => {
  const left = parseStructureGroupLabel(lhs);
  const right = parseStructureGroupLabel(rhs);
  const leftOrder = STRUCTURE_GROUP_ORDER[left.kind] ?? STRUCTURE_GROUP_ORDER.other;
  const rightOrder = STRUCTURE_GROUP_ORDER[right.kind] ?? STRUCTURE_GROUP_ORDER.other;

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.index !== right.index) return left.index - right.index;
  return lhs.localeCompare(rhs);
};

export const toGroupDisplayLabel = (label: string): string => {
  return normalizeStructureGroupDisplayLabel(label);
};

export const buildStructureGroupSections = (
  names: string[],
  labelsByName: Record<string, string | undefined>
): StructureGroupSection[] => {
  const byLabel = new Map<string, string[]>();
  for (const name of names) {
    const label = resolveStructureGroupLabelForName({
      labelsByName,
      name,
    });
    const existing = byLabel.get(label);
    if (existing) {
      existing.push(name);
      continue;
    }
    byLabel.set(label, [name]);
  }

  return [...byLabel.entries()]
    .sort(([leftLabel], [rightLabel]) => sortStructureGroupLabels(leftLabel, rightLabel))
    .map(([label, items]) => ({
      id: `group:${label}`,
      label,
      items,
    }));
};

export const mergeStructureGroupSections = (
  sections: StructureGroupSection[],
  additionalLabels: string[]
): StructureGroupSection[] => {
  const sectionByLabel = new Map<string, StructureGroupSection>();
  sections.forEach((section) => {
    sectionByLabel.set(section.label, section);
  });

  additionalLabels.forEach((labelRaw) => {
    const label = labelRaw.trim();
    if (!label) return;
    if (sectionByLabel.has(label)) return;
    sectionByLabel.set(label, {
      id: `group:${label}`,
      label,
      items: [],
    });
  });

  return Array.from(sectionByLabel.values()).sort((lhs, rhs) =>
    sortStructureGroupLabels(lhs.label, rhs.label)
  );
};

export const expandStructureSectionsContainingItem = ({
  previousCollapsedSectionIds,
  sections,
  itemName,
}: {
  previousCollapsedSectionIds: ReadonlySet<string>;
  sections: readonly StructureGroupSection[];
  itemName: string | null;
}): Set<string> => {
  if (!itemName) {
    return new Set(previousCollapsedSectionIds);
  }

  const nextCollapsedSectionIds = new Set(previousCollapsedSectionIds);
  sections.forEach((section) => {
    if (section.items.includes(itemName)) {
      nextCollapsedSectionIds.delete(section.id);
    }
  });
  return nextCollapsedSectionIds;
};
