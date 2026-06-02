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

const INERTIA_VISUALIZATION_METRIC_GROUP_ORDER: readonly InertiaVisualizationMetricGroupKey[] = [
  "healthy",
  "warning",
  "problematic",
  "unverified",
] as const;

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
