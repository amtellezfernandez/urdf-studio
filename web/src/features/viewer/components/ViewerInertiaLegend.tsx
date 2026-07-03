import { CircleHelp } from "lucide-react";

import type { InertialVisualizationSettings } from "@/shared/types/feature";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  SYMMETRY_OVERLAY_LEGEND_ITEMS,
  SYMMETRY_OVERLAY_TOOLTIP_LINES,
} from "@/features/viewer/symmetryVisualizationLegend";
import {
  VIEWER_INERTIA_OVERLAY_TOOLTIP_LINES,
  buildViewerInertiaLegendItems,
  buildViewerInertiaSeverityLegendItems,
  getViewerInertiaReferenceColor,
} from "@/features/viewer/components/viewerInertiaLegendState";

type ViewerInertiaLegendProps = {
  hasSymmetryVisualization: boolean;
  inertialVisualization: InertialVisualizationSettings;
};

export function ViewerInertiaLegend({
  hasSymmetryVisualization,
  inertialVisualization,
}: ViewerInertiaLegendProps) {
  const inertiaLegendItems = buildViewerInertiaLegendItems();
  const inertiaSeverityLegendItems = buildViewerInertiaSeverityLegendItems();
  const inertiaReferenceColorHex = getViewerInertiaReferenceColor();

  return (
    <TooltipProvider delayDuration={100}>
      <div className="absolute bottom-4 right-4 z-20 max-w-[28rem] rounded border border-border/40 bg-background/92 px-2.5 py-2 shadow-sm backdrop-blur-sm">
        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/75 hover:text-foreground"
                aria-label="How viewer overlays work"
              >
                <CircleHelp className="h-3 w-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="max-w-80 space-y-1.5 text-[11px] leading-snug text-muted-foreground"
            >
              {VIEWER_INERTIA_OVERLAY_TOOLTIP_LINES.map((line) => (
                <div key={line}>{line}</div>
              ))}
              {hasSymmetryVisualization
                ? SYMMETRY_OVERLAY_TOOLTIP_LINES.map((line) => (
                    <div key={line}>{line}</div>
                  ))
                : null}
            </TooltipContent>
          </Tooltip>
        </div>
        {inertialVisualization.showInertia ? (
          <div className="mt-2">
            <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
              Inertia
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
              {inertiaLegendItems.map((item) => (
                <span key={item.key} className="inline-flex items-center gap-1">
                  {item.markerColor ? (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.markerColor }}
                    />
                  ) : (
                    <span
                      className="h-2 w-2 rounded-sm border"
                      style={{
                        borderColor: item.borderColor,
                        backgroundColor: item.backgroundColor,
                      }}
                    />
                  )}
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {inertialVisualization.showInertia || inertialVisualization.showReferenceGeometry ? (
          <div className="mt-2">
            <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
              Reference And Severity
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
              {inertialVisualization.showReferenceGeometry ? (
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-sm border bg-transparent"
                    style={{ borderColor: inertiaReferenceColorHex }}
                  />
                  <span>Reference geometry</span>
                </span>
              ) : null}
              {inertialVisualization.showInertia
                ? inertiaSeverityLegendItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center gap-1">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.label} mismatch</span>
                    </span>
                  ))
                : null}
            </div>
          </div>
        ) : null}
        {hasSymmetryVisualization ? (
          <div className="mt-2">
            <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
              Symmetry
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
              {SYMMETRY_OVERLAY_LEGEND_ITEMS.map((item) => (
                <span key={item.key} className="inline-flex items-center gap-1">
                  <span
                    className="block h-px w-4"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
