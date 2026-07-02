import { ArrowUpRight, Cuboid, LoaderCircle, Minus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { WorkspaceTransferTargetId } from "@/features/world-share/workspaceTransferApi";
import type {
  WorkspaceTransferAssetFormat,
  WorkspaceTransferStrategy,
  WorkspaceTransferTargetKind,
} from "@/features/world-share/workspaceTransferParams";
import { formatWorkspaceTransferAssetLabel } from "@/features/layout/page/workspaceTransferLabels";

export type WorkspaceTransferTargetState = {
  id: WorkspaceTransferTargetId;
  label: string;
  targetKind: WorkspaceTransferTargetKind;
  detail: string;
  robotAssetFormat: WorkspaceTransferAssetFormat;
  sceneAssetFormat: WorkspaceTransferAssetFormat;
  transferStrategy: WorkspaceTransferStrategy;
  transferLabel: string;
  transferDescription: string;
  createsTransferAsset: boolean;
  statusLabel: string;
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
  if (target.isBusy) return <LoaderCircle className="h-3 w-3 animate-spin" />;
  return <Cuboid className="h-3 w-3" />;
};

const getDisabledTargetIcon = () => <Minus className="h-3 w-3" />;

const getTargetRowClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "group flex min-h-10 w-full min-w-0 items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors",
    target.canOpen
      ? "border-border/50 bg-background/40 text-foreground hover:border-border/75 hover:bg-muted/25"
      : "border-border/30 bg-background/20 text-muted-foreground/70",
    target.isActive && "border-sky-500/35 bg-sky-500/10 text-sky-100",
    (!target.canOpen || target.isBusy) && "disabled:cursor-not-allowed disabled:opacity-100"
  );

const getTransferBadgeClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "max-w-16 truncate whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[8px] font-medium leading-none",
    target.transferStrategy === "planned"
      ? "border-border/35 bg-muted/20 text-muted-foreground"
      : target.createsTransferAsset
        ? "border-border/45 bg-background/35 text-muted-foreground"
        : "border-border/45 bg-background/35 text-foreground/80"
  );

const getStatusDotClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "h-1.5 w-1.5 rounded-full",
    target.isBusy
      ? "bg-sky-300"
      : target.canOpen
        ? "bg-emerald-300/85"
        : "bg-muted-foreground/45"
  );

const formatTargetCount = (count: number): string =>
  `${count} target${count === 1 ? "" : "s"}`;

const WorkspaceTransferTargetRow = ({ target }: { target: WorkspaceTransferTargetState }) => {
  const isDisabled = !target.canOpen || target.isBusy;
  const actionLabel = target.isBusy
    ? target.openingLabel
    : target.canOpen
      ? target.openLabel
      : target.disabledLabel;
  const title = target.canOpen
    ? `${target.detail}. ${target.transferDescription} Status: ${target.statusLabel}.`
    : target.disabledLabel;

  return (
    <button
      type="button"
      className={getTargetRowClassName(target)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={target.onAction}
      disabled={isDisabled}
      aria-label={actionLabel}
      title={title}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border/45 bg-muted/20 text-muted-foreground">
        {target.canOpen ? getAvailableTargetIcon(target) : getDisabledTargetIcon()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[10px] font-medium leading-tight">
            {target.isBusy ? target.openingLabel : target.label}
          </span>
          <span className={getStatusDotClassName(target)} aria-hidden="true" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[8px] leading-none text-muted-foreground">
          <span className="truncate">{target.detail}</span>
          <span className="shrink-0 text-muted-foreground/45">·</span>
          <span className="shrink-0">{target.statusLabel}</span>
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className={getTransferBadgeClassName(target)}>
          {formatWorkspaceTransferAssetLabel(target)}
        </span>
        {target.canOpen ? (
          <ArrowUpRight className="h-3 w-3 text-muted-foreground/65 transition-colors group-hover:text-foreground" />
        ) : null}
      </span>
    </button>
  );
};

export const HealthActionPanelWorkspaceTransfer = ({
  className,
  sceneSummary,
  targets,
}: HealthActionPanelWorkspaceTransferProps) => {
  return (
    <div data-section="workspace-transfer" className={cn("space-y-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-foreground/85">Targets</div>
          <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
            Simulators + tools{sceneSummary ? ` · ${sceneSummary}` : ""}
          </div>
        </div>
        <div className="rounded-sm border border-border/40 bg-background/35 px-1.5 py-0.5 text-[8px] font-medium leading-none text-muted-foreground">
          {formatTargetCount(targets.length)}
        </div>
      </div>
      <div className="space-y-1">
        {targets.map((target) => (
          <WorkspaceTransferTargetRow key={target.id} target={target} />
        ))}
      </div>
    </div>
  );
};
