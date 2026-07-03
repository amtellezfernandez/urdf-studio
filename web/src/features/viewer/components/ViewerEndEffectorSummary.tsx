import {
  buildViewerEndEffectorSummaryModel,
  type ViewerVector3,
} from "@/features/viewer/components/viewerEndEffectorSummaryState";

type ViewerEndEffectorSummaryProps = {
  centerOfMassPosition: ViewerVector3 | null;
  endEffectorLinks: readonly string[];
  endEffectorPosition: ViewerVector3 | null;
  primaryEndEffectorLink: string | null | undefined;
  totalMassKg: number;
};

export function ViewerEndEffectorSummary({
  centerOfMassPosition,
  endEffectorLinks,
  endEffectorPosition,
  primaryEndEffectorLink,
  totalMassKg,
}: ViewerEndEffectorSummaryProps) {
  const summary = buildViewerEndEffectorSummaryModel({
    centerOfMassPosition,
    endEffectorLinks,
    endEffectorPosition,
    primaryEndEffectorLink,
    totalMassKg,
  });

  return (
    <div className="absolute bottom-4 left-4 z-20 max-w-[25rem] rounded border border-border/40 bg-background/92 px-1.5 py-1 shadow-sm backdrop-blur-sm">
      <div className="truncate font-mono text-[8.5px] leading-tight text-foreground">
        {summary.headerText} ({summary.handleCount}) {summary.handlesText}
      </div>
      <div className="truncate font-mono text-[8.5px] leading-tight text-foreground/90">
        Primary {summary.primaryEndEffectorLinkText} {summary.primaryEndEffectorPositionText}
      </div>
      <div className="truncate font-mono text-[8.5px] leading-tight text-foreground/90">
        Mass {summary.massText} · COM {summary.centerOfMassText}
      </div>
    </div>
  );
}
