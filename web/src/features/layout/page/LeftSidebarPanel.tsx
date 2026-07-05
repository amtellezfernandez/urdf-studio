import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, ChevronsRight, Info, LoaderCircle, X } from "lucide-react";
import { CameraPreviewPanel } from "@/features/layout/panels/CameraPreviewPanel";
import type { MeshFiles } from "@/shared/types/feature";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import type {
  AssemblySubstitutionApplyHandler,
  AssemblySubstitutionSession,
} from "@/features/assembly/workspace/assemblyWorkspaceTypes";
import type {
  WorkspaceTransferState,
  WorkspaceTransferTargetState,
} from "@/features/layout/page/workspaceTransferState";
import { formatWorkspaceTransferAssetLabel } from "@/features/layout/page/workspaceTransferLabels";
import { AssemblyLeftUnionPanel } from "@/features/assembly/workspace/AssemblyLeftUnionPanel";
import { SIDEBAR_MIN_WIDTH } from "@/features/layout/jointListSidebarParams";
import {
  TOP_NAV_HEIGHT,
  VIEWPORT_HEIGHT_WITH_TOP_NAV,
} from "@/features/layout/page/constants";
import { SidebarDock } from "@/features/layout/page/SidebarDock";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { cn } from "@/shared/lib/utils";

type LeftSidebarPanelProps = {
  workspaceMode: WorkspaceMode;
  assemblyInspector: AssemblyInspectorData | null;
  assemblyHasPhysicalContact: boolean;
  assemblyContactPairCount: number;
  assemblyProposalRequested: boolean;
  onRequestAssemblyProposal: () => void;
  substitutionSession?: AssemblySubstitutionSession | null;
  onApplySubstitution?: AssemblySubstitutionApplyHandler;
  isLoading: boolean;
  availableJoints: string[];
  availableLinks: string[];
  cameraCount: number;
  onJointSelect: (joint: string | null) => void;
  selectedJoint: string | null;
  originalUrdfContent: string;
  vizUrdfContent: string;
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  onToggleCollapse: () => void;
  meshFiles: MeshFiles;
  topPanelHeight: number;
  onVerticalResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  cameraPreviewEmptyStateMessage?: string;
  workspaceTransfer?: WorkspaceTransferState | null;
  workspaceLauncherNeedsAttention?: boolean;
  workspaceLauncherStatusLabel?: string;
  onOpenWorkspaceLauncher?: () => void;
};

type WorkspaceTransferLauncherButtonProps = {
  needsAttention: boolean;
  onOpenWorkspaceLauncher?: () => void;
  statusLabel?: string;
};

type WorkspaceTransferPanelProps = {
  needsAttention: boolean;
  onOpenWorkspaceLauncher?: () => void;
  statusLabel?: string;
  summary: string;
  targets: WorkspaceTransferTargetState[];
};

const resolveSidebarWorkspaceTargets = (
  workspaceTransfer: WorkspaceTransferState | null | undefined
): WorkspaceTransferTargetState[] => {
  return workspaceTransfer?.targets ?? [];
};

const resolveWorkspaceTargetSummary = ({
  targets,
  workspaceLauncherStatusLabel,
  workspaceTransfer,
}: {
  targets: WorkspaceTransferTargetState[];
  workspaceLauncherStatusLabel?: string;
  workspaceTransfer: WorkspaceTransferState | null | undefined;
}): string =>
  targets.length > 0
    ? `${targets.length} targets${
        workspaceTransfer?.sceneSummary ? ` · ${workspaceTransfer.sceneSummary}` : ""
      }`
    : workspaceLauncherStatusLabel ?? "Workspace targets";

const getWorkspaceTransferBadgeClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "max-w-14 truncate rounded-[3px] border px-1.5 py-0.5 text-[8px] font-medium leading-none",
    target.transferStrategy === "planned"
      ? "border-border/35 bg-transparent text-muted-foreground/70"
      : target.createsTransferAsset
        ? "border-border/45 bg-background/20 text-muted-foreground"
        : "border-border/45 bg-background/25 text-foreground/75"
  );

const getWorkspaceTransferTargetClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "group flex min-h-7 w-full min-w-0 items-center gap-2 border-b border-border/25 px-2 py-1 text-left transition-colors last:border-b-0",
    target.canOpen
      ? "text-foreground hover:bg-muted/20"
      : "text-muted-foreground/70",
    target.isActive && "bg-muted/25 text-foreground",
    !target.canOpen && "disabled:cursor-not-allowed disabled:opacity-100",
    target.isBusy && "bg-muted/20"
  );

const getWorkspaceTransferStatusDotClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "h-1.5 w-1.5 shrink-0 rounded-full",
    target.isBusy
      ? "bg-sky-300"
      : target.needsAttention
        ? "bg-amber-300/90"
      : target.canOpen
        ? "bg-emerald-300/80"
        : "bg-muted-foreground/40"
  );

const WorkspaceTransferTargetButton = ({
  target,
}: {
  target: WorkspaceTransferTargetState;
}) => {
  const title =
    target.isBusy && target.onCancel
      ? target.cancelLabel ?? `Stop opening ${target.label}`
      : `${target.detail}. ${target.transferDescription} Status: ${target.statusLabel}.`;
  return (
    <button
      type="button"
      onClick={target.isBusy && target.onCancel ? target.onCancel : target.onAction}
      disabled={!target.canOpen}
      className={getWorkspaceTransferTargetClassName(target)}
      aria-label={
        target.canOpen
          ? target.isBusy
            ? target.cancelLabel ?? `Stop opening ${target.label}`
            : target.openLabel
          : target.disabledLabel
      }
      title={title}
    >
      <span className={getWorkspaceTransferStatusDotClassName(target)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {target.isBusy ? (
            <LoaderCircle className="h-2.5 w-2.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="min-w-0 truncate text-[10px] font-medium leading-tight">
            {target.isBusy ? target.openingLabel : target.label}
          </span>
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className={getWorkspaceTransferBadgeClassName(target)}>
          {formatWorkspaceTransferAssetLabel(target)}
        </span>
        {target.isBusy && target.onCancel ? (
          <X className="h-3 w-3 text-muted-foreground/65 transition-colors group-hover:text-foreground" aria-hidden="true" />
        ) : target.canOpen ? (
          <ArrowUpRight className="h-3 w-3 text-muted-foreground/55 transition-colors group-hover:text-foreground" aria-hidden="true" />
        ) : (
          <Info className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
        )}
      </span>
    </button>
  );
};

const WorkspaceTransferLauncherButton = ({
  needsAttention,
  onOpenWorkspaceLauncher,
  statusLabel,
}: WorkspaceTransferLauncherButtonProps) => (
  <button
    type="button"
    onClick={onOpenWorkspaceLauncher}
    disabled={!onOpenWorkspaceLauncher}
    className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border/55 bg-background/35 px-2 text-[10px] font-medium text-foreground transition-colors hover:border-border/80 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-45"
    aria-label="Simulation Prep"
    title={statusLabel ? `Simulation Prep: ${statusLabel}` : "Simulation Prep"}
  >
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 rounded-full ${
        needsAttention ? "bg-amber-300/90" : "bg-emerald-300/80"
      }`}
    />
    <ArrowUpRight className="h-3 w-3" />
  </button>
);

const WorkspaceTransferPanel = ({
  needsAttention,
  onOpenWorkspaceLauncher,
  statusLabel,
  summary,
  targets,
}: WorkspaceTransferPanelProps) => (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/45 bg-background/45">
    <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/30 px-2 py-2">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Simulation Prep
        </div>
        <div className="mt-1 truncate text-xs text-foreground">Simulators + tools</div>
        <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{summary}</div>
      </div>
      <WorkspaceTransferLauncherButton
        needsAttention={needsAttention}
        onOpenWorkspaceLauncher={onOpenWorkspaceLauncher}
        statusLabel={statusLabel}
      />
    </div>
    {targets.length > 0 ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {targets.map((target) => (
          <WorkspaceTransferTargetButton key={target.id} target={target} />
        ))}
      </div>
    ) : (
      <div className="px-2 py-2 text-[9px] leading-snug text-muted-foreground">
        Start the backend to list compatible simulators and tools.
      </div>
    )}
  </div>
);

const LeftSidebarPanelBase = (props: LeftSidebarPanelProps) => {
  const {
    workspaceMode,
    assemblyInspector,
    assemblyHasPhysicalContact,
    assemblyContactPairCount,
    assemblyProposalRequested,
    onRequestAssemblyProposal,
    substitutionSession,
    onApplySubstitution,
    originalUrdfContent,
    vizUrdfContent,
    sidebarWidth,
    isSidebarCollapsed,
    onToggleCollapse,
    meshFiles,
    topPanelHeight,
    onVerticalResizeStart,
    onSidebarResizeStart,
    urdfBasePath,
    packageRoots,
    cameraPreviewEmptyStateMessage,
    workspaceTransfer,
    workspaceLauncherNeedsAttention,
    workspaceLauncherStatusLabel,
    onOpenWorkspaceLauncher,
  } = props;
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  const cameras = useCameraStore((state) => state.cameras);
  const workspaceTargets = resolveSidebarWorkspaceTargets(workspaceTransfer);
  const workspaceTargetSummary = resolveWorkspaceTargetSummary({
    targets: workspaceTargets,
    workspaceLauncherStatusLabel,
    workspaceTransfer,
  });

  if (workspaceModeUi.isAssembly) {
    return (
      <AssemblyLeftUnionPanel
        assemblyInspector={assemblyInspector}
        hasPhysicalContact={assemblyHasPhysicalContact}
        contactPairCount={assemblyContactPairCount}
        proposalRequested={assemblyProposalRequested}
        onRequestProposal={onRequestAssemblyProposal}
        substitutionSession={substitutionSession}
        onApplySubstitution={onApplySubstitution}
        sidebarWidth={sidebarWidth}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleCollapse={onToggleCollapse}
        onSidebarResizeStart={onSidebarResizeStart}
      />
    );
  }

  return (
    <SidebarDock
      side="left"
      sidebarWidth={sidebarWidth}
      isCollapsed={isSidebarCollapsed}
      onToggleCollapse={onToggleCollapse}
      onResizeStart={onSidebarResizeStart}
      CollapseIcon={ChevronsRight}
    >
      <div
        data-left-sidebar-split-container="true"
        className="sidebar-panel fixed left-0 z-30 flex flex-col border-r border-border/35 bg-[hsl(var(--sidebar-bg))] shadow-xl backdrop-blur-sm transition-transform duration-200 ease-out"
        style={{
          width: sidebarWidth,
          minWidth: SIDEBAR_MIN_WIDTH,
          top: TOP_NAV_HEIGHT,
          height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
          transform: isSidebarCollapsed ? "translateX(-100%)" : undefined,
          pointerEvents: isSidebarCollapsed ? "none" : "auto",
        }}
        aria-hidden={isSidebarCollapsed}
      >
        <div
          className="min-h-0 shrink-0 overflow-hidden border-b border-border/25"
          style={{ flexBasis: `${topPanelHeight * 100}%` }}
        >
          <div className="flex h-full min-h-0 flex-col p-2">
            <WorkspaceTransferPanel
              needsAttention={Boolean(workspaceLauncherNeedsAttention)}
              onOpenWorkspaceLauncher={onOpenWorkspaceLauncher}
              statusLabel={workspaceLauncherStatusLabel}
              summary={workspaceTargetSummary}
              targets={workspaceTargets}
            />
          </div>
        </div>
        <div
          onPointerDown={onVerticalResizeStart}
          className="group relative z-10 h-2 shrink-0 cursor-row-resize bg-border/15 transition-colors hover:bg-border/35"
          title="Drag to resize cameras"
          aria-label="Resize cameras panel"
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="absolute inset-x-0 top-1/2 mx-auto h-0.5 w-12 -translate-y-1/2 rounded-full bg-border/45 transition-colors group-hover:bg-border/80" />
        </div>
        <div className="min-h-0 flex-1">
          <CameraPreviewPanel
            cameras={cameras}
            meshFiles={meshFiles}
            originalUrdf={originalUrdfContent}
            vizUrdf={vizUrdfContent}
            urdfBasePath={urdfBasePath}
            packageRoots={packageRoots}
            cameraPreviewEmptyStateMessage={cameraPreviewEmptyStateMessage}
          />
        </div>
      </div>
    </SidebarDock>
  );
};

LeftSidebarPanelBase.displayName = "LeftSidebarPanel";

export const LeftSidebarPanel = memo(LeftSidebarPanelBase);
