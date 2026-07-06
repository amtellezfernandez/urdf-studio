import { resolveInertiaMetricSeverity } from "@/features/viewer/inertialVisualizationColor";

export type InertiaVisualizationMetricGroupKey =
  | "healthy"
  | "warning"
  | "problematic"
  | "unverified";

type InertiaVisualizationMetricEntry = {
  mismatchBreakdown?: {
    volume: number;
    shape: number;
    center: number;
  };
};

type InertiaVisualizationMetricMap = ReadonlyMap<number, InertiaVisualizationMetricEntry>;

export type InertiaVisualizationMetricGroup = {
  key: InertiaVisualizationMetricGroupKey;
  indices: number[];
};

type InertiaVisualizationLinkEntry = {
  linkName: string;
};

export type InertiaVisualizationVisibleLinkIndices = {
  visibleLinkIndices: number[];
  activeVisibleLinkIndices: number[];
  deemphasizedVisibleLinkIndices: number[];
};

const INERTIA_VISUALIZATION_METRIC_GROUP_ORDER: readonly InertiaVisualizationMetricGroupKey[] = [
  "healthy",
  "warning",
  "problematic",
  "unverified",
] as const;

const toNonEmptyNameSet = (
  names: readonly string[] | null | undefined
): Set<string> | null => (names && names.length > 0 ? new Set(names) : null);

const isLinkIndexInNameSet = (
  index: number,
  inertials: readonly InertiaVisualizationLinkEntry[],
  linkNameSet: ReadonlySet<string>
): boolean => {
  const linkName = inertials[index]?.linkName;
  return typeof linkName === "string" && linkNameSet.has(linkName);
};

export const buildInertiaVisualizationVisibleLinkIndices = ({
  inertiaIndices,
  inertials,
  scopedLinkNames,
  deemphasizedOutlineLinkNames,
}: {
  inertiaIndices: readonly number[];
  inertials: readonly InertiaVisualizationLinkEntry[];
  scopedLinkNames?: readonly string[] | null;
  deemphasizedOutlineLinkNames?: readonly string[] | null;
}): InertiaVisualizationVisibleLinkIndices => {
  const scopedLinkNameSet = toNonEmptyNameSet(scopedLinkNames);
  const deemphasizedOutlineLinkNameSet = toNonEmptyNameSet(
    deemphasizedOutlineLinkNames
  );
  const visibleLinkIndices = scopedLinkNameSet
    ? inertiaIndices.filter((index) =>
        isLinkIndexInNameSet(index, inertials, scopedLinkNameSet)
      )
    : [...inertiaIndices];
  const deemphasizedVisibleLinkIndices = deemphasizedOutlineLinkNameSet
    ? visibleLinkIndices.filter((index) =>
        isLinkIndexInNameSet(index, inertials, deemphasizedOutlineLinkNameSet)
      )
    : [];
  const activeVisibleLinkIndices = deemphasizedOutlineLinkNameSet
    ? visibleLinkIndices.filter(
        (index) =>
          !isLinkIndexInNameSet(index, inertials, deemphasizedOutlineLinkNameSet)
      )
    : visibleLinkIndices;

  return {
    visibleLinkIndices,
    activeVisibleLinkIndices,
    deemphasizedVisibleLinkIndices,
  };
};

export const buildInertiaVisualizationMetricGroups = ({
  inertiaIndices,
  inertiaByIndex,
  metric,
}: {
  inertiaIndices: readonly number[];
  inertiaByIndex: InertiaVisualizationMetricMap;
  metric: "shape" | "volume";
}): InertiaVisualizationMetricGroup[] => {
  const groups = INERTIA_VISUALIZATION_METRIC_GROUP_ORDER.map((key) => ({
    key,
    indices: [] as number[],
  }));
  const groupsByKey = new Map(groups.map((group) => [group.key, group]));

  inertiaIndices.forEach((index) => {
    const entry = inertiaByIndex.get(index);
    if (!entry) {
      return;
    }
    const severity = resolveInertiaMetricSeverity(entry.mismatchBreakdown?.[metric]);
    groupsByKey.get(severity)?.indices.push(index);
  });

  return groups;
};
