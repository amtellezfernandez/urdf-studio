import { describe, expect, it } from "vitest";
import {
  resolveBatchLinkIndicatorClassName,
  resolveBatchSelectionSummary,
  resolveMergedCollisionStateLabel,
  resolveSimplificationStateLabel,
} from "@/features/layout/linkBatchEditorPanelHelpers";

describe("linkBatchEditorPanelHelpers", () => {
  it("formats the selected batch summary", () => {
    expect(resolveBatchSelectionSummary(1)).toBe("1 link selected");
    expect(resolveBatchSelectionSummary(2)).toBe("2 links selected");
  });

  it("resolves simplification and merged collision state labels", () => {
    expect(
      resolveSimplificationStateLabel({
        hasMixedBatchSimplifyState: true,
        hasSelectedCollisionBatchLinks: true,
        selectedBatchCollisionCount: 2,
        selectedBatchSimplifiedCount: 1,
      })
    ).toBe("Simplification state: mixed");

    expect(
      resolveMergedCollisionStateLabel({
        hasMixedBatchMergeState: false,
        hasSelectedCollisionBatchLinks: false,
        selectedBatchCollisionCount: 0,
        selectedBatchMergedCount: 0,
      })
    ).toBe("Merged collision state: no URDF collisions in selection");
  });

  it("resolves the batch link indicator class name", () => {
    expect(resolveBatchLinkIndicatorClassName({ isMerged: true, isSimplified: false })).toBe(
      "border-cyan-500/60 bg-cyan-500/50"
    );
    expect(resolveBatchLinkIndicatorClassName({ isMerged: false, isSimplified: true })).toBe(
      "border-emerald-500/60 bg-emerald-500/50"
    );
    expect(resolveBatchLinkIndicatorClassName({ isMerged: false, isSimplified: false })).toBe(
      "border-border/60 bg-transparent"
    );
  });
});
