import { toFiniteNumberOrFallback } from "@/shared/lib/numeric";

export const STRUCTURE_GROUP_ORDER: Record<string, number> = {
  base: 0,
  body: 1,
  arm: 2,
  leg: 3,
  wheel: 4,
  other: 5,
};

export const STRUCTURE_GROUP_DEFAULTS = {
  label: "other",
} as const;
const GROUP_LABEL_PATTERN = /^([a-z]+)(\d+)?$/i;
const DEFAULT_GROUP_INDEX = Number.POSITIVE_INFINITY;

export const parseStructureGroupLabel = (
  label: string
): { kind: string; index: number } => {
  const match = label.match(GROUP_LABEL_PATTERN);
  if (!match) {
    return {
      kind: STRUCTURE_GROUP_DEFAULTS.label,
      index: DEFAULT_GROUP_INDEX,
    };
  }

  const kind = (match[1] || STRUCTURE_GROUP_DEFAULTS.label).toLowerCase();
  const indexRaw = match[2];
  const index = indexRaw ? Number(indexRaw) : 0;

  return {
    kind:
      STRUCTURE_GROUP_ORDER[kind] === undefined
        ? STRUCTURE_GROUP_DEFAULTS.label
        : kind,
    index: toFiniteNumberOrFallback(index, DEFAULT_GROUP_INDEX),
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
    : STRUCTURE_GROUP_DEFAULTS.label;
};
