import { Cuboid, LoaderCircle, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { WorkspaceTransferTargetId } from "@/features/world-share/workspaceTransferApi";

export type WorkspaceTransferTargetState = {
  id: WorkspaceTransferTargetId;
  label: string;
  detail: string;
  openLabel: string;
  openingLabel: string;
  isBusy: boolean;
  isActive?: boolean;
  canOpen: boolean;
  disabledLabel: string;
  onAction: () => void;
};

export type HealthActionPanelWorkspaceTransferState = {
  sceneSummary?: string;
  targets: WorkspaceTransferTargetState[];
};

type HealthActionPanelWorkspaceTransferProps = HealthActionPanelWorkspaceTransferState & {
  className: string;
};

const getAvailableTargetIcon = (target: WorkspaceTransferTargetState) => {
  if (target.isBusy) return <LoaderCircle className="h-2.5 w-2.5 animate-spin" />;
  return <Cuboid className="h-2.5 w-2.5" />;
};

const getDisabledTargetIcon = () => <Minus className="h-2.5 w-2.5" />;

const getAvailableTargetButtonClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "h-6 w-full min-w-0 justify-start gap-1 rounded-sm px-1.5 text-left text-[9px]",
    "border-neutral-700/70 bg-neutral-900/60 text-neutral-200 shadow-none hover:border-neutral-600 hover:bg-neutral-800/70",
    target.isActive && "border-slate-500/70 bg-slate-700/35 text-slate-100 hover:bg-slate-700/45"
  );

const getDisabledTargetButtonClassName = () =>
  cn(
    "h-6 w-full min-w-0 justify-start gap-1 rounded-sm px-1.5 text-left text-[9px]",
    "border-neutral-800/80 bg-neutral-950/65 text-neutral-500 shadow-none",
    "disabled:cursor-not-allowed disabled:opacity-100"
  );

const AvailableTargetButton = ({ target }: { target: WorkspaceTransferTargetState }) => (
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

const DisabledTargetButton = ({ target }: { target: WorkspaceTransferTargetState }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    className={getDisabledTargetButtonClassName()}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={target.onAction}
    disabled
    aria-label={target.disabledLabel}
    title={target.disabledLabel}
  >
    {getDisabledTargetIcon()}
    <span className="min-w-0 truncate">{target.label}</span>
  </Button>
);

const WorkspaceTransferRow = ({
  children,
  label,
  summary,
}: {
  children: ReactNode;
  label: string;
  summary?: string;
}) => (
  <div className="flex items-start gap-1">
    <div
      className={cn(
        "w-10 shrink-0 pt-0.5 text-[8px] font-medium uppercase tracking-wide",
        "text-foreground/65"
      )}
    >
      <div>{label}</div>
      {summary ? (
        <div className="mt-0.5 whitespace-nowrap text-[8px] font-normal normal-case tracking-normal text-foreground/45">
          {summary}
        </div>
      ) : null}
    </div>
    <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1">
      {children}
    </div>
  </div>
);

export const HealthActionPanelWorkspaceTransfer = ({
  className,
  sceneSummary,
  targets,
}: HealthActionPanelWorkspaceTransferProps) => {
  return (
    <div data-section="workspace-transfer" className={cn("space-y-1", className)}>
      <WorkspaceTransferRow label="Open" summary={sceneSummary}>
        {targets.map((target) =>
          target.canOpen ? (
            <AvailableTargetButton key={target.id} target={target} />
          ) : (
            <DisabledTargetButton key={target.id} target={target} />
          )
        )}
      </WorkspaceTransferRow>
    </div>
  );
};
