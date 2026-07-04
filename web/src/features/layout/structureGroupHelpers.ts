export const STRUCTURE_GROUP_ORDER: Record<string, number> = {
  base: 0,
  body: 1,
  arm: 2,
  leg: 3,
  wheel: 4,
  other: 5,
};

export const DEFAULT_STRUCTURE_GROUP_LABEL = "other";
const GROUP_LABEL_PATTERN = /^([a-z]+)(\d+)?$/i;
const DEFAULT_GROUP_INDEX = Number.POSITIVE_INFINITY;

export const parseStructureGroupLabel = (
  label: string
): { kind: string; index: number } => {
  const match = label.match(GROUP_LABEL_PATTERN);
  if (!match) {
    return {
      kind: DEFAULT_STRUCTURE_GROUP_LABEL,
      index: DEFAULT_GROUP_INDEX,
    };
  }

  const kind = (match[1] || DEFAULT_STRUCTURE_GROUP_LABEL).toLowerCase();
  const indexRaw = match[2];
  const index = indexRaw ? Number(indexRaw) : 0;

  return {
    kind:
      STRUCTURE_GROUP_ORDER[kind] === undefined
        ? DEFAULT_STRUCTURE_GROUP_LABEL
        : kind,
    index: Number.isFinite(index) ? index : DEFAULT_GROUP_INDEX,
  };
};

export const normalizeStructureGroupDisplayLabel = (label: string): string => {
  if (!label) {
    return "Other";
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const resolveStructureGroupLabelForName = ({
  labelsByName,
  name,
}: {
  labelsByName: Record<string, string | undefined>;
  name: string;
}): string => {
  const rawLabel = labelsByName[name];
  return rawLabel && rawLabel.trim().length > 0
    ? rawLabel
    : DEFAULT_STRUCTURE_GROUP_LABEL;
};
