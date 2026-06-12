import { Cuboid, LoaderCircle, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { SimulatorId } from "@/features/world-share/simulatorRuntimeApi";

export type SimulatorRuntimeTargetId = SimulatorId;

export type SimulatorRuntimeTargetState = {
  id: SimulatorRuntimeTargetId;
  label: string;
  detail: string;
  openLabel: string;
  openingLabel: string;
  isBusy: boolean;
  isActive?: boolean;
  canOpen: boolean;
  plannedLabel: string;
  onAction: () => void;
};

export type HealthActionPanelSimulatorRuntimeState = {
  targets: SimulatorRuntimeTargetState[];
};

type HealthActionPanelSimulatorRuntimeProps = HealthActionPanelSimulatorRuntimeState & {
  className: string;
};

const getAvailableTargetIcon = (target: SimulatorRuntimeTargetState) => {
  if (target.isBusy) return <LoaderCircle className="h-2.5 w-2.5 animate-spin" />;
  return <Cuboid className="h-2.5 w-2.5" />;
};

const getUnavailableTargetIcon = () => <Minus className="h-2.5 w-2.5" />;

const getAvailableTargetButtonClassName = (target: SimulatorRuntimeTargetState) =>
  cn(
    "h-6 min-w-0 justify-start gap-1 rounded-sm px-1.5 text-left text-[9px]",
    "border-neutral-700/70 bg-neutral-900/60 text-neutral-200 shadow-none hover:border-neutral-600 hover:bg-neutral-800/70",
    target.isActive && "border-slate-500/70 bg-slate-700/35 text-slate-100 hover:bg-slate-700/45"
  );

const getUnavailableTargetButtonClassName = () =>
  cn(
    "h-6 min-w-0 justify-start gap-1 rounded-sm px-1.5 text-left text-[9px]",
    "border-neutral-800/80 bg-neutral-950/65 text-neutral-500 shadow-none",
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
    aria-label={target.isBusy ? target.openingLabel : target.openLabel}
    title={target.detail}
  >
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {getAvailableTargetIcon(target)}
    </span>
    <span className="min-w-0 truncate font-medium">
      {target.isBusy ? target.openingLabel : target.label}
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
    aria-label={target.plannedLabel}
    title={target.plannedLabel}
  >
    {getUnavailableTargetIcon()}
    <span className="min-w-0 truncate">{target.label}</span>
  </Button>
);

const SimulatorRuntimeRow = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="flex items-start gap-1">
    <div
      className={cn(
        "w-9 shrink-0 pt-1 text-[8px] font-medium uppercase tracking-wide",
        "text-foreground/65"
      )}
    >
      {label}
    </div>
    <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">{children}</div>
  </div>
);

export const HealthActionPanelSimulatorRuntime = ({
  className,
  targets,
}: HealthActionPanelSimulatorRuntimeProps) => {
  return (
    <div data-section="simulator-runtime" className={cn("space-y-1", className)}>
      <SimulatorRuntimeRow label="Sim">
        {targets.map((target) =>
          target.canOpen ? (
            <AvailableTargetButton key={target.id} target={target} />
          ) : (
            <UnavailableTargetButton key={target.id} target={target} />
          )
        )}
      </SimulatorRuntimeRow>
    </div>
  );
};
