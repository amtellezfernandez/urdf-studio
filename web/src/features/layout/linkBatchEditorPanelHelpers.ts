export const resolveBatchSelectionSummary = (
  selectedBatchLinkCount: number
): string =>
  `${selectedBatchLinkCount} link${selectedBatchLinkCount === 1 ? "" : "s"} selected`;

export const resolveSimplificationStateLabel = ({
  hasMixedBatchSimplifyState,
  hasSelectedCollisionBatchLinks,
  selectedBatchCollisionCount,
  selectedBatchSimplifiedCount,
}: {
  hasMixedBatchSimplifyState: boolean;
  hasSelectedCollisionBatchLinks: boolean;
  selectedBatchCollisionCount: number;
  selectedBatchSimplifiedCount: number;
}): string => {
  if (!hasSelectedCollisionBatchLinks) {
    return "Simplification state: no URDF collisions in selection";
  }
  if (hasMixedBatchSimplifyState) {
    return "Simplification state: mixed";
  }
  return selectedBatchSimplifiedCount === selectedBatchCollisionCount
    ? "Simplification state: enabled"
    : "Simplification state: disabled";
};

export const resolveMergedCollisionStateLabel = ({
  hasMixedBatchMergeState,
  hasSelectedCollisionBatchLinks,
  selectedBatchCollisionCount,
  selectedBatchMergedCount,
}: {
  hasMixedBatchMergeState: boolean;
  hasSelectedCollisionBatchLinks: boolean;
  selectedBatchCollisionCount: number;
  selectedBatchMergedCount: number;
}): string => {
  if (!hasSelectedCollisionBatchLinks) {
    return "Merged collision state: no URDF collisions in selection";
  }
  if (hasMixedBatchMergeState) {
    return "Merged collision state: mixed";
  }
  return selectedBatchMergedCount === selectedBatchCollisionCount
    ? "Merged collision state: active"
    : "Merged collision state: inactive";
};

export const resolveBatchLinkIndicatorClassName = ({
  isMerged,
  isSimplified,
}: {
  isMerged: boolean;
  isSimplified: boolean;
}): string => {
  if (isMerged) {
    return "border-cyan-500/60 bg-cyan-500/50";
  }
  if (isSimplified) {
    return "border-emerald-500/60 bg-emerald-500/50";
  }
  return "border-border/60 bg-transparent";
};
