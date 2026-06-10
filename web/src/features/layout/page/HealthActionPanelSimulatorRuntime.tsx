import { CheckCircle2, LoaderCircle, Minus, Play } from "lucide-react";
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

const getAvailableTargetIcon = (target: SimulatorRuntimeTargetState) => {
  if (target.isBusy) return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
  if (target.isActive || target.isReady) return <CheckCircle2 className="h-3.5 w-3.5" />;
  return <Play className="h-3.5 w-3.5" />;
};

const getUnavailableTargetIcon = () => <Minus className="h-3 w-3" />;

const getAvailableTargetButtonClassName = (target: SimulatorRuntimeTargetState) =>
  cn(
    "h-9 min-w-0 justify-start gap-2 rounded-md px-2 text-left text-[11px]",
    "border-border/50 bg-background/55 text-foreground shadow-none hover:border-border/70 hover:bg-muted/30",
    (target.isActive || target.isReady) &&
      "border-emerald-400/45 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
  );

const getUnavailableTargetButtonClassName = () =>
  cn(
    "h-6 min-w-0 justify-start gap-1.5 rounded-md px-2 text-[10px]",
    "border-neutral-800 bg-neutral-900/70 text-neutral-500 shadow-none",
    "disabled:cursor-not-allowed disabled:opacity-100"
  );

const AvailableTargetButton = ({ target }: { target: SimulatorRuntimeTargetState }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    className={getAvailableTargetButtonClassName(target)}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={target.onAction}
    disabled={target.isBusy}
    aria-label={target.isBusy ? target.busyLabel : target.actionLabel}
    title={target.detail}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border/50 bg-background/60">
      {getAvailableTargetIcon(target)}
    </span>
    <span className="min-w-0 truncate font-medium">
      {target.isBusy ? target.busyLabel : target.label}
    </span>
  </Button>
);

const UnavailableTargetButton = ({ target }: { target: SimulatorRuntimeTargetState }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    className={getUnavailableTargetButtonClassName()}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={target.onAction}
    disabled
    aria-label={target.unavailableLabel}
    title={target.unavailableLabel}
  >
    {getUnavailableTargetIcon()}
    <span className="min-w-0 truncate">{target.label}</span>
  </Button>
);

export const HealthActionPanelSimulatorRuntime = ({
  className,
  targets,
}: HealthActionPanelSimulatorRuntimeProps) => {
  const availableTargets = targets.filter((target) => target.isAvailable);
  const unavailableTargets = targets.filter((target) => !target.isAvailable);

  return (
    <div data-section="simulator-runtime" className={className}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
          Open in
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {availableTargets.map((target) => (
          <AvailableTargetButton key={target.id} target={target} />
        ))}
      </div>
      {unavailableTargets.length > 0 ? (
        <div className="mt-2 border-t border-border/40 pt-2">
          <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">
            Soon available
          </div>
          <div className="grid grid-cols-3 gap-1">
            {unavailableTargets.map((target) => (
              <UnavailableTargetButton key={target.id} target={target} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
