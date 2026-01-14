import { AlertTriangle, Wrench, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";

type LoadIssuesPanelProps = {
  open: boolean;
  urdfError?: string | null;
  unmatchedURDFRefs: string[];
  onOpenMeshStatus: () => void;
  onFixMeshPaths: () => void;
  onOpenUrdfEditor: () => void;
  onClose: () => void;
};

export const LoadIssuesPanel = ({
  open,
  urdfError,
  unmatchedURDFRefs,
  onOpenMeshStatus,
  onFixMeshPaths,
  onOpenUrdfEditor,
  onClose,
}: LoadIssuesPanelProps) => {
  if (!open) return null;

  const hasUrdfError = Boolean(urdfError);
  const hasMeshIssues = unmatchedURDFRefs.length > 0;
  const previewRefs = unmatchedURDFRefs.slice(0, 3);

  return (
    <div className="fixed top-12 right-4 z-50 w-[360px] rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-start gap-3 border-b border-border/60 p-3">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">Load issues detected</div>
          <div className="text-xs text-muted-foreground">
            Fix these to ensure accurate visuals and playback.
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss load issues"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-3">
        {hasUrdfError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <div className="font-medium">URDF parse error</div>
            <div className="mt-1 text-[11px] text-destructive/90 line-clamp-3">
              {urdfError}
            </div>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onOpenUrdfEditor}>
                Open URDF Editor
              </Button>
            </div>
          </div>
        )}

        {hasMeshIssues && (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
            <div className="font-medium flex items-center gap-2">
              <Wrench className="h-3 w-3 text-muted-foreground" />
              Missing mesh files ({unmatchedURDFRefs.length})
            </div>
            {previewRefs.length > 0 && (
              <ul className="mt-1 text-[11px] text-muted-foreground list-disc list-inside space-y-0.5">
                {previewRefs.map((ref) => (
                  <li key={ref} className="truncate">{ref}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onFixMeshPaths}>
                Fix Mesh Paths
              </Button>
              <Button size="sm" variant="outline" onClick={onOpenMeshStatus}>
                Show Mesh Details
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
