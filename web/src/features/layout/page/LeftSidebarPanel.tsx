import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, ChevronsRight, Cuboid, LoaderCircle, Minus } from "lucide-react";
import { CameraPreviewPanel } from "@/features/layout/panels/CameraPreviewPanel";
import type { MeshFiles } from "@/shared/types/feature";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import type {
  HealthActionPanelWorkspaceTransferState,
  WorkspaceTransferTargetState,
} from "@/features/layout/page/HealthActionPanelWorkspaceTransfer";
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
  substitutionSession?: {
    hostRobotName: string;
    hostUrdfContent: string;
    hostLinkOptions: string[];
    replacementRobotName: string;
    replacementUrdfContent: string;
    replacementUrdfPath: string;
    replacementLinkOptions: string[];
    replacementRootLinkOptions: string[];
    packageRoots?: PackageRootMap;
  } | null;
  onApplySubstitution?: (hostRootLink: string, replacementRootLink: string) => void;
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
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  cameraPreviewEmptyStateMessage?: string;
  workspaceTransfer?: HealthActionPanelWorkspaceTransferState | null;
  workspaceLauncherNeedsAttention?: boolean;
  workspaceLauncherStatusLabel?: string;
  onOpenWorkspaceLauncher?: () => void;
};

const resolveSidebarWorkspaceTargets = (
  workspaceTransfer: HealthActionPanelWorkspaceTransferState | null | undefined
): WorkspaceTransferTargetState[] => {
  return workspaceTransfer?.targets ?? [];
};

const getWorkspaceTransferBadgeClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "max-w-14 truncate rounded-sm border px-1 py-0.5 text-[8px] leading-none",
    target.transferStrategy === "planned"
      ? "border-neutral-700/70 bg-neutral-900/70 text-neutral-400"
      : target.createsTransferAsset
        ? "border-border/45 bg-background/35 text-muted-foreground"
        : "border-border/45 bg-background/35 text-foreground/80"
  );

const getWorkspaceTransferTargetClassName = (target: WorkspaceTransferTargetState) =>
  cn(
    "flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-left transition-colors",
    target.canOpen
      ? "border-border/60 bg-background/55 text-foreground hover:border-border hover:bg-muted/35"
      : "border-border/35 bg-muted/15 text-muted-foreground/70",
    target.isActive && "border-slate-500/70 bg-slate-700/25 text-slate-100",
    (!target.canOpen || target.isBusy) && "disabled:cursor-not-allowed disabled:opacity-100"
  );

const WorkspaceTransferTargetButton = ({
  target,
}: {
  target: WorkspaceTransferTargetState;
}) => {
  const title = `${target.detail}. ${target.transferDescription} Status: ${target.statusLabel}.`;
  return (
    <button
      type="button"
      onClick={target.onAction}
      disabled={!target.canOpen || target.isBusy}
      className={getWorkspaceTransferTargetClassName(target)}
      aria-label={target.canOpen ? target.openLabel : target.disabledLabel}
      title={title}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border/40 bg-background/45 text-muted-foreground">
        {target.isBusy ? (
          <LoaderCircle className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
        ) : (
          <Cuboid className="h-2.5 w-2.5" aria-hidden="true" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[9px] font-medium leading-tight">
          {target.isBusy ? target.openingLabel : target.label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className={getWorkspaceTransferBadgeClassName(target)}>
            {formatWorkspaceTransferAssetLabel(target)}
          </span>
          {target.canOpen ? (
            <ArrowUpRight className="h-2.5 w-2.5 text-muted-foreground/65" aria-hidden="true" />
          ) : (
            <Minus className="h-2.5 w-2.5 text-muted-foreground/45" aria-hidden="true" />
          )}
        </span>
      </span>
    </button>
  );
};

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
  const workspaceTargetSummary =
    workspaceTargets.length > 0
      ? `${workspaceTargets.length} targets${
          workspaceTransfer?.sceneSummary ? ` · ${workspaceTransfer.sceneSummary}` : ""
        }`
      : workspaceLauncherStatusLabel ?? "Workspace targets";

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
        <div className="shrink-0 border-b border-border/40 p-2">
          <div className="rounded-md border border-border/60 bg-background/55 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Open In
                </div>
                <div className="mt-1 truncate text-xs text-foreground">
                  Simulators + tools
                </div>
                <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                  {workspaceTargetSummary}
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenWorkspaceLauncher}
                disabled={!onOpenWorkspaceLauncher}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Open In"
                title={
                  workspaceLauncherStatusLabel
                    ? `Open In: ${workspaceLauncherStatusLabel}`
                    : "Open In"
                }
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    workspaceLauncherNeedsAttention ? "bg-amber-300/90" : "bg-emerald-300/80"
                  }`}
                />
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
            {workspaceTargets.length > 0 ? (
              <div className="mt-2 max-h-80 space-y-0.5 overflow-y-auto pr-0.5">
                {workspaceTargets.map((target) => (
                  <WorkspaceTransferTargetButton key={target.id} target={target} />
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-md border border-dashed border-border/45 bg-muted/15 px-2 py-1.5 text-[9px] leading-snug text-muted-foreground">
                Start the backend to list compatible simulators and tools.
              </div>
            )}
          </div>
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
