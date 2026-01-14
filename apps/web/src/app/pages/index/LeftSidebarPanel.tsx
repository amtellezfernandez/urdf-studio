import type React from "react";
import { Sidebar } from "@/features/layout/Sidebar";
import { ChevronsRight } from "lucide-react";
import type { CollisionVisibility } from "@/features/urdf/LinkEditor";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import type { MeshFiles, ViewerEpisode } from "@/features/types";
import { SIDEBAR_RESIZER_WIDTH } from "@/app/pages/index/constants";

type LeftSidebarPanelProps = {
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
  onJointNameChange: (oldName: string, newName: string) => void;
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
  onEpisodesResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDatasetActionsReady: (actions: {
    loadFromLocal: () => void;
    loadFromHuggingFace: () => void;
    exportToLocal: () => void;
    exportToHuggingFace: () => void;
    openRerunViewer: () => void;
    isImportingFromHF: boolean;
    isExportingDataset: boolean;
    isUploadingToHF: boolean;
    hasEpisodes: boolean;
    isRerunViewerOpen: boolean;
  }) => void;
  onSidebarResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
};

export const LeftSidebarPanel = ({
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
}: LeftSidebarPanelProps) => (
  <>
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
    />

    {!isSidebarCollapsed && (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onSidebarResizeStart}
        className="fixed z-40 cursor-col-resize select-none"
        style={{
          top: "32px",
          bottom: 0,
          left: sidebarWidth - SIDEBAR_RESIZER_WIDTH / 2,
          width: SIDEBAR_RESIZER_WIDTH,
        }}
      >
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70" />
      </div>
    )}

    {isSidebarCollapsed && (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="fixed bottom-6 left-4 z-40 flex items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ChevronsRight className="h-3 w-3" />
        Panel
      </button>
    )}
  </>
);
