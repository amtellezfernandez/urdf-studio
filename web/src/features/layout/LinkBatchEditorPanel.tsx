import { cn } from "@/shared/lib/utils";
import {
  resolveBatchLinkIndicatorClassName,
  resolveBatchSelectionSummary,
  resolveMergedCollisionStateLabel,
  resolveSimplificationStateLabel,
} from "@/features/layout/linkBatchEditorPanelHelpers";

type LinkBatchEditorPanelProps = {
  canClearMergedCollision: boolean;
  canMergeCollisions: boolean;
  canSimplifyCollisions: boolean;
  hasMixedBatchMergeState: boolean;
  hasMixedBatchSimplifyState: boolean;
  hasSelectedCollisionBatchLinks: boolean;
  mergedLinkSet: ReadonlySet<string>;
  onApplyCollisionMerge: () => void;
  onClearCollisionMerge: () => void;
  onClearSelection: () => void;
  onRestoreCollisionMeshes: () => void;
  onSimplifyCollisions: () => void;
  selectedBatchCollisionCount: number;
  selectedBatchLinkNames: string[];
  selectedBatchMergedCount: number;
  selectedBatchSimplifiedCount: number;
  simplifiedLinkSet: ReadonlySet<string>;
};

export const LinkBatchEditorPanel = ({
  canClearMergedCollision,
  canMergeCollisions,
  canSimplifyCollisions,
  hasMixedBatchMergeState,
  hasMixedBatchSimplifyState,
  hasSelectedCollisionBatchLinks,
  mergedLinkSet,
  onApplyCollisionMerge,
  onClearCollisionMerge,
  onClearSelection,
  onRestoreCollisionMeshes,
  onSimplifyCollisions,
  selectedBatchCollisionCount,
  selectedBatchLinkNames,
  selectedBatchMergedCount,
  selectedBatchSimplifiedCount,
  simplifiedLinkSet,
}: LinkBatchEditorPanelProps) => (
  <div className="p-2 space-y-2">
    <div className="text-xs text-foreground">
      {resolveBatchSelectionSummary(selectedBatchLinkNames.length)}
    </div>
    <div className="text-[11px] text-muted-foreground">
      {resolveSimplificationStateLabel({
        hasMixedBatchSimplifyState,
        hasSelectedCollisionBatchLinks,
        selectedBatchCollisionCount,
        selectedBatchSimplifiedCount,
      })}
    </div>
    <div className="text-[11px] text-muted-foreground">
      {resolveMergedCollisionStateLabel({
        hasMixedBatchMergeState,
        hasSelectedCollisionBatchLinks,
        selectedBatchCollisionCount,
        selectedBatchMergedCount,
      })}
    </div>
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        className="h-6 rounded-sm border border-emerald-500/50 bg-emerald-500/20 px-2 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/30"
        onClick={onSimplifyCollisions}
        disabled={!canSimplifyCollisions}
      >
        Simplify Collisions
      </button>
      <button
        type="button"
        className="h-6 rounded-sm border border-border/60 bg-muted/30 px-2 text-[10px] font-medium text-foreground hover:bg-muted/50"
        onClick={onRestoreCollisionMeshes}
        disabled={!canSimplifyCollisions}
      >
        Use Full Mesh
      </button>
      <button
        type="button"
        className="h-6 rounded-sm border border-cyan-500/50 bg-cyan-500/20 px-2 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/30"
        onClick={onApplyCollisionMerge}
        disabled={!canMergeCollisions}
        title="Replace merged collision group with the current selected links"
      >
        Merge As One Collision
      </button>
      <button
        type="button"
        className="h-6 rounded-sm border border-border/60 bg-muted/30 px-2 text-[10px] font-medium text-foreground hover:bg-muted/50"
        onClick={onClearCollisionMerge}
        disabled={!canClearMergedCollision}
        title="Remove selected links from merged collision group"
      >
        Clear Merged Collision
      </button>
      <button
        type="button"
        className="h-6 rounded-sm border border-border/50 bg-transparent px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30"
        onClick={onClearSelection}
      >
        Clear Selection
      </button>
    </div>
    <div className="max-h-48 overflow-y-auto rounded-sm border border-border/30 bg-background/40 p-1">
      {selectedBatchLinkNames.map((linkName) => (
        <div key={linkName} className="flex items-center gap-1 py-0.5 px-1 text-[10px]">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-[2px] border",
              resolveBatchLinkIndicatorClassName({
                isMerged: mergedLinkSet.has(linkName),
                isSimplified: simplifiedLinkSet.has(linkName),
              })
            )}
          />
          <span className="truncate">{linkName}</span>
        </div>
      ))}
    </div>
  </div>
);
