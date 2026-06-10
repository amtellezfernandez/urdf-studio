import { X } from "lucide-react";
import { Button } from "@/shared/ui/button";

type LoadIssuesPanelProps = {
  open: boolean;
  urdfError?: string | null;
  unmatchedURDFRefs: string[];
  absoluteFileMeshRefs?: string[];
  missingPackageRefs?: string[];
  collisionMeshTotal?: number;
  collisionMeshMatched?: number;
  collisionMeshMissing?: string[];
  meshRootHints?: string[];
  simulationPrepStatusLabel?: string | null;
  simulationPrepNeedsAttention?: boolean;
  onFixMeshPaths: () => void;
  onOpenSimulationPrep?: () => void;
  onOpenUrdfEditor: () => void;
  onClose: () => void;
};

const PREVIEW_ITEM_LIMIT = 2;

export const LoadIssuesPanel = ({
  open,
  urdfError,
  unmatchedURDFRefs,
  absoluteFileMeshRefs = [],
  missingPackageRefs = [],
  collisionMeshTotal = 0,
  collisionMeshMatched = 0,
  collisionMeshMissing = [],
  meshRootHints = [],
  simulationPrepStatusLabel = null,
  simulationPrepNeedsAttention = false,
  onFixMeshPaths,
  onOpenSimulationPrep,
  onOpenUrdfEditor,
  onClose,
}: LoadIssuesPanelProps) => {
  if (!open) return null;

  const hasUrdfError = Boolean(urdfError);
  const hasMeshIssues = unmatchedURDFRefs.length > 0;
  const hasAbsoluteFileRefs = absoluteFileMeshRefs.length > 0;
  const hasMissingPackages = missingPackageRefs.length > 0;
  const hasMeshReferenceIssues = hasMeshIssues || hasAbsoluteFileRefs || hasMissingPackages;
  const hasCollisionMeshIssues = collisionMeshMissing.length > 0;
  const hasMeshResolutionIssues = hasMeshReferenceIssues || hasCollisionMeshIssues;
  const hasAttention = hasUrdfError || hasMeshReferenceIssues || hasCollisionMeshIssues;
  const shouldShowSimulationPrepRedirect =
    !hasAttention && simulationPrepNeedsAttention && Boolean(onOpenSimulationPrep);
  const previewRefs = unmatchedURDFRefs.slice(0, PREVIEW_ITEM_LIMIT);
  const previewAbsoluteRefs = absoluteFileMeshRefs.slice(0, PREVIEW_ITEM_LIMIT);
  const previewMissingPackages = missingPackageRefs.slice(0, PREVIEW_ITEM_LIMIT);
  const previewCollisionMissing = collisionMeshMissing.slice(0, PREVIEW_ITEM_LIMIT);
  const actionButtons = [
    hasMeshResolutionIssues
      ? (
          <Button key="fix-mesh-paths" size="sm" onClick={onFixMeshPaths}>
            Correct Mesh Paths
          </Button>
        )
      : null,
    hasUrdfError
      ? (
          <Button key="open-editor" size="sm" variant="outline" onClick={onOpenUrdfEditor}>
            Open URDF Editor
          </Button>
        )
      : null,
  ].filter(Boolean);

  const cleanLoadSummary = [
    "Valid",
    "Mesh refs OK",
    meshRootHints.length > 0 ? `Mesh dirs: ${meshRootHints.join(", ")}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" • ");
  const meshSummaryLabel =
    hasMeshReferenceIssues || hasCollisionMeshIssues
      ? "Mesh refs need attention"
      : "Mesh refs OK";

  return (
    <div className="fixed top-12 right-4 z-50 w-[360px] rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">
            {hasAttention ? "Load needs attention" : cleanLoadSummary}
          </div>
          {hasAttention ? (
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {cleanLoadSummary}
            </div>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss load issues"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3 text-xs text-foreground">
        {hasAttention ? (
          <>
            <div className="space-y-1">
              <div className="font-medium">{hasUrdfError ? "Validation issue" : "Valid"}</div>
              {hasUrdfError && urdfError ? (
                <div className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                  {urdfError}
                </div>
              ) : null}
            </div>

            <div className="space-y-1">
              <div className="font-medium">{meshSummaryLabel}</div>
              {previewRefs.length > 0 ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Example{previewRefs.length > 1 ? "s" : ""}: {previewRefs.join(", ")}
                </div>
              ) : null}
              {previewAbsoluteRefs.length > 0 ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Absolute file refs: {previewAbsoluteRefs.join(", ")}
                </div>
              ) : null}
              {previewMissingPackages.length > 0 ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Missing packages: {previewMissingPackages.join(", ")}
                </div>
              ) : null}
              {meshRootHints.length > 0 ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Mesh dirs: {meshRootHints.join(", ")}
                </div>
              ) : null}
              {previewCollisionMissing.length > 0 ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Missing collision meshes: {previewCollisionMissing.join(", ")}
                </div>
              ) : null}
              {hasCollisionMeshIssues ? (
                <div className="text-[11px] leading-4 text-muted-foreground">
                  Collision coverage: {collisionMeshMatched}/{collisionMeshTotal} resolved
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {shouldShowSimulationPrepRedirect ? (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
            <div className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">
              <span className="font-medium text-foreground">Simulation Prep</span>
              {simulationPrepStatusLabel
                ? ` needs attention: ${simulationPrepStatusLabel}`
                : " needs attention"}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 border-border/60 bg-transparent px-2 text-[10px] font-normal leading-none text-muted-foreground hover:text-foreground"
              onClick={onOpenSimulationPrep}
            >
              Open
            </Button>
          </div>
        ) : null}

        {actionButtons.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-2">{actionButtons}</div>
        ) : null}
      </div>
    </div>
  );
};
