import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { Sidebar } from "@/features/layout/Sidebar";
import { ChevronsRight } from "lucide-react";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import type { MeshFiles, ViewerEpisode } from "@/shared/types/feature";
import type { DatasetActions } from "@/features/dataset/datasetActions";
import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { AssemblyInspectorData } from "@/features/assembly/inspector/buildAssemblyInspectorData";
import { AssemblyLeftUnionPanel } from "@/features/assembly/workspace/AssemblyLeftUnionPanel";
import { SidebarDock } from "@/features/layout/page/SidebarDock";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";

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
  jointLimits: JointLimits;
  jointAxes: JointAxisMap;
  originalJointAxes: JointAxisMap;
  originalUrdfContent: string;
  vizUrdfContent: string;
  onJointChange: (jointName: string, value: number) => void;
  onJointSelect: (joint: string | null) => void;
  selectedJoint: string | null;
  onVizUrdfChange: (content: string) => void;
  onJointAxisChange: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis: (jointName: string) => void;
  onJointTypeChange: (
    jointName: string,
    jointType: string,
    lowerLimit?: number,
    upperLimit?: number
  ) => void;
  onJointNameChange: (oldName: string, newName: string) => boolean | void;
  onDeleteJoint: (jointName: string) => void;
  deletedJoints: Set<string>;
  getExportUrdfContent: () => string;
  onMotionDataUpload: (file: File) => void;
  onPlayAnimation: () => void;
  isPlaying: boolean;
  motionDataFileName?: string;
  hasAnimationFrames: boolean;
  currentFrame: number;
  totalFrames: number;
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  onToggleCollapse: () => void;
  meshFiles: MeshFiles;
  onCollisionVisibilityChange: (visibility: CollisionVisibility) => void;
  rotationPlaneVisible: boolean;
  onRotationPlaneVisibilityChange: (visible: boolean) => void;
  onFrameChange: (frame: number) => void;
  onUrdfEditorToggle: (show: boolean) => void;
  showUrdfEditor: boolean;
  viewerSplitView: boolean;
  onViewerSplitViewChange: (splitView: boolean) => void;
  onViewerEpisodeChange: (episode: ViewerEpisode | null) => void;
  onViewerOpenChange: (open: boolean) => void;
  onEpisodeSaveHandlerChange: (
    handler:
      | ((episode: ViewerEpisode, saveAsNew: boolean, newName?: string) => void)
      | undefined
  ) => void;
  episodesViewHeight: number;
  onEpisodesResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDatasetActionsReady: (actions: DatasetActions) => void;
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  activeWorldSnapshotRef?: EpisodeMetadata["world_snapshot_ref"] | null;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  cameraPreviewEmptyStateMessage?: string;
};

const LeftSidebarPanelBase = ({
  workspaceMode,
  assemblyInspector,
  assemblyHasPhysicalContact,
  assemblyContactPairCount,
  assemblyProposalRequested,
  onRequestAssemblyProposal,
  substitutionSession,
  onApplySubstitution,
  isLoading,
  availableJoints,
  jointLimits,
  jointAxes,
  originalJointAxes,
  originalUrdfContent,
  vizUrdfContent,
  onJointChange,
  onJointSelect,
  selectedJoint,
  onVizUrdfChange,
  onJointAxisChange,
  onResetAxis,
  onJointTypeChange,
  onJointNameChange,
  onDeleteJoint,
  deletedJoints,
  getExportUrdfContent,
  onMotionDataUpload,
  onPlayAnimation,
  isPlaying,
  motionDataFileName,
  hasAnimationFrames,
  currentFrame,
  totalFrames,
  sidebarWidth,
  isSidebarCollapsed,
  onToggleCollapse,
  meshFiles,
  onCollisionVisibilityChange,
  rotationPlaneVisible,
  onRotationPlaneVisibilityChange,
  onFrameChange,
  onUrdfEditorToggle,
  showUrdfEditor,
  viewerSplitView,
  onViewerSplitViewChange,
  onViewerEpisodeChange,
  onViewerOpenChange,
  onEpisodeSaveHandlerChange,
  episodesViewHeight,
  onEpisodesResizeStart,
  onDatasetActionsReady,
  onSidebarResizeStart,
  activeWorldSnapshotRef = null,
  urdfBasePath,
  packageRoots,
  cameraPreviewEmptyStateMessage,
}: LeftSidebarPanelProps) => {
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);

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
    <Sidebar
      isLoading={isLoading}
      availableJoints={availableJoints}
      jointLimits={jointLimits}
      jointAxes={jointAxes}
      originalJointAxes={originalJointAxes}
      originalUrdf={originalUrdfContent}
      vizUrdf={vizUrdfContent}
      onJointChange={onJointChange}
      onJointSelect={onJointSelect}
      selectedJoint={selectedJoint}
      onVizUrdfChange={onVizUrdfChange}
      onJointAxisChange={onJointAxisChange}
      onResetAxis={onResetAxis}
      onJointTypeChange={onJointTypeChange}
      onJointNameChange={onJointNameChange}
      onDeleteJoint={onDeleteJoint}
      deletedJoints={deletedJoints}
      getExportUrdf={getExportUrdfContent}
      onMotionDataUpload={onMotionDataUpload}
      onPlayAnimation={onPlayAnimation}
      isPlaying={isPlaying}
      motionDataFileName={motionDataFileName}
      hasAnimationFrames={hasAnimationFrames}
      currentFrame={currentFrame}
      totalFrames={totalFrames}
      width={sidebarWidth}
      isCollapsed={isSidebarCollapsed}
      onToggleCollapse={onToggleCollapse}
      meshFiles={meshFiles}
      onCollisionVisibilityChange={onCollisionVisibilityChange}
      rotationPlaneVisible={rotationPlaneVisible}
      onRotationPlaneVisibilityChange={onRotationPlaneVisibilityChange}
      onFrameChange={onFrameChange}
      onUrdfEditorToggle={onUrdfEditorToggle}
      showUrdfEditor={showUrdfEditor}
      viewerSplitView={viewerSplitView}
      onViewerSplitViewChange={onViewerSplitViewChange}
      onViewerEpisodeChange={onViewerEpisodeChange}
      onViewerOpenChange={onViewerOpenChange}
      onEpisodeSaveHandlerChange={onEpisodeSaveHandlerChange}
      episodesViewHeight={episodesViewHeight}
      onEpisodesResizeStart={onEpisodesResizeStart}
      onDatasetActionsReady={onDatasetActionsReady}
      activeWorldSnapshotRef={activeWorldSnapshotRef}
      urdfBasePath={urdfBasePath}
      packageRoots={packageRoots}
      cameraPreviewEmptyStateMessage={cameraPreviewEmptyStateMessage}
    />
    </SidebarDock>
  );
};

LeftSidebarPanelBase.displayName = "LeftSidebarPanel";

export const LeftSidebarPanel = memo(LeftSidebarPanelBase);
