import { CheckCircle2, LoaderCircle, Play } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { SimulatorId } from "@/features/world-share/simulatorRuntimeApi";

export type SimulatorRuntimeTargetId = SimulatorId;

export type SimulatorRuntimeTargetState = {
  id: SimulatorRuntimeTargetId;
  label: string;
  detail: string;
  actionLabel: string;
  busyLabel: string;
  isBusy: boolean;
  isActive?: boolean;
  isAvailable: boolean;
  isReady?: boolean | null;
  unavailableLabel: string;
  onAction: () => void;
};

export type HealthActionPanelSimulatorRuntimeState = {
  targets: SimulatorRuntimeTargetState[];
};

type HealthActionPanelSimulatorRuntimeProps = HealthActionPanelSimulatorRuntimeState & {
  className: string;
  statusLabel?: string | null;
};

const getTargetIcon = (target: SimulatorRuntimeTargetState) => {
  if (target.isBusy) return <LoaderCircle className="h-3 w-3 animate-spin" />;
  if (target.isActive || target.isReady) return <CheckCircle2 className="h-3 w-3" />;
  if (target.isAvailable) return <Play className="h-3 w-3" />;
  return null;
};

const getTargetButtonClassName = (target: SimulatorRuntimeTargetState) =>
  cn(
    "h-7 min-w-0 justify-start gap-1 rounded-md px-1.5 text-[10px]",
    target.isAvailable
      ? "border-border/50 bg-background/45 text-foreground hover:bg-accent"
      : "border-neutral-700 bg-neutral-800/85 text-neutral-400 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-100",
    (target.isActive || target.isReady) && "border-emerald-400/50 text-emerald-200"
  );

export const HealthActionPanelSimulatorRuntime = ({
  className,
  targets,
}: HealthActionPanelSimulatorRuntimeProps) => (
  <div data-section="simulator-runtime" className={className}>
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-foreground/80">
        Open in
      </div>
      <div className="truncate text-[9px] text-muted-foreground">same robot + world</div>
    </div>
    <div className="grid grid-cols-3 gap-1">
      {targets.map((target) => (
        <Button
          key={target.id}
          type="button"
          variant="outline"
          size="sm"
          className={getTargetButtonClassName(target)}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={target.onAction}
          disabled={target.isBusy || !target.isAvailable}
          aria-label={
            target.isBusy
              ? target.busyLabel
              : target.isAvailable
                ? target.actionLabel
                : target.unavailableLabel
          }
          title={target.isAvailable ? target.detail : target.unavailableLabel}
        >
          {getTargetIcon(target)}
          <span className="min-w-0 truncate">{target.isBusy ? target.busyLabel : target.label}</span>
        </Button>
      ))}
    </div>
  </div>
);
