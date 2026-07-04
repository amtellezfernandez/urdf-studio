type StructureViewMode = "links" | "flat" | "hierarchy";

type StructureModeOption = {
  label: string;
  requiresUrdf?: boolean;
  value: StructureViewMode;
};

export const shouldShowSubgroupControls = (
  effectiveStructureViewMode: StructureViewMode
): boolean =>
  effectiveStructureViewMode === "links" || effectiveStructureViewMode === "flat";

export const resolveSubgroupActionDisabledReason = ({
  canReassignStructureGroups,
  effectiveStructureViewMode,
  linkGroupingMode,
}: {
  canReassignStructureGroups: boolean;
  effectiveStructureViewMode: StructureViewMode;
  linkGroupingMode: "body" | "mesh" | "alpha";
}): string | null => {
  if (!canReassignStructureGroups) {
    return "Group editing is unavailable";
  }
  if (effectiveStructureViewMode === "links" && linkGroupingMode !== "body") {
    return "Subgroups are only available in Body grouping";
  }
  return null;
};

export const resolveSubgroupActionState = ({
  canReassignStructureGroups,
  effectiveStructureViewMode,
  linkGroupingMode,
}: {
  canReassignStructureGroups: boolean;
  effectiveStructureViewMode: StructureViewMode;
  linkGroupingMode: "body" | "mesh" | "alpha";
}): {
  isDisabled: boolean;
  title: string;
} => {
  const disabledReason = resolveSubgroupActionDisabledReason({
    canReassignStructureGroups,
    effectiveStructureViewMode,
    linkGroupingMode,
  });

  return {
    isDisabled: disabledReason !== null,
    title: disabledReason ?? "Create an empty subgroup drop target",
  };
};

export const resolveStructureSearchPlaceholder = (
  effectiveStructureViewMode: StructureViewMode
): string =>
  effectiveStructureViewMode === "links" ? "Search links..." : "Search joints...";

export const isStructureModeOptionDisabled = ({
  option,
  urdfContentAvailable,
}: {
  option: StructureModeOption;
  urdfContentAvailable: boolean;
}): boolean => Boolean(option.requiresUrdf && !urdfContentAvailable);
