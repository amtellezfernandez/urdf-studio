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
  if (!canReassignStructureGroups) {
    return {
      isDisabled: true,
      title: "Group editing is unavailable",
    };
  }
  if (effectiveStructureViewMode === "links" && linkGroupingMode !== "body") {
    return {
      isDisabled: true,
      title: "Subgroups are only available in Body grouping",
    };
  }

  return {
    isDisabled: false,
    title: "Create an empty subgroup drop target",
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
