export type StructureGroupSection = {
  id: string;
  label: string;
  items: string[];
};

const STRUCTURE_GROUP_ORDER: Record<string, number> = {
  base: 0,
  body: 1,
  arm: 2,
  leg: 3,
  wheel: 4,
  other: 5,
};

const DEFAULT_GROUP_LABEL = "other";
const GROUP_LABEL_PATTERN = /^([a-z]+)(\d+)?$/i;
const DEFAULT_GROUP_INDEX = Number.POSITIVE_INFINITY;

const parseStructureGroupLabel = (label: string): { kind: string; index: number } => {
  const match = label.match(GROUP_LABEL_PATTERN);
  if (!match) return { kind: DEFAULT_GROUP_LABEL, index: DEFAULT_GROUP_INDEX };

  const kind = (match[1] || DEFAULT_GROUP_LABEL).toLowerCase();
  const indexRaw = match[2];
  const index = indexRaw ? Number(indexRaw) : 0;
  return {
    kind: STRUCTURE_GROUP_ORDER[kind] === undefined ? DEFAULT_GROUP_LABEL : kind,
    index: Number.isFinite(index) ? index : DEFAULT_GROUP_INDEX,
  };
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
  if (!label) return "Other";
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const buildStructureGroupSections = (
  names: string[],
  labelsByName: Record<string, string | undefined>
): StructureGroupSection[] => {
  const byLabel = new Map<string, string[]>();
  for (const name of names) {
    const rawLabel = labelsByName[name];
    const label = rawLabel && rawLabel.trim().length > 0 ? rawLabel : DEFAULT_GROUP_LABEL;
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
