import { cn } from "@/shared/lib/utils";

type RosVizDiagnosticsPanelProps = {
  show: boolean;
  poseSummary: string;
  diagnostic: string;
  lastError: string | null;
};

export const RosVizDiagnosticsPanel = ({
  show,
  poseSummary,
  diagnostic,
  lastError,
}: RosVizDiagnosticsPanelProps) => {
  if (!show) {
    return null;
  }

  return (
    <div className={cn("pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded border border-border/40 bg-background/85 px-2 py-1 text-[10px] text-foreground/90 backdrop-blur-sm")}>
      <div className="truncate font-mono">{poseSummary}</div>
      <div className="truncate text-muted-foreground">{lastError ? `ERROR: ${lastError}` : diagnostic}</div>
    </div>
  );
};
