import type React from "react";
import { Viewer3D } from "@/components/Viewer3D";
import { URDFComparison } from "@/components/URDFComparison";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";
import type { MeshFiles, UrdfViewMode, WindowWithViewerHandlers, ViewerEpisode } from "@/features/types";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import type { CollisionVisibility } from "@/components/LinkEditor";
import { VIEWER_RESIZER_HEIGHT } from "@/pages/index/constants";

type ViewerLayoutProps = {
  isSidebarCollapsed: boolean;
  isRightSidebarCollapsed: boolean;
  sidebarWidth: number;
  rightSidebarWidth: number;
  showUrdfEditor: boolean;
  urdfEditorSplitView: boolean;
  recordingViewHeight: number;
  urdfContentVersion: number;
  urdfFile: File | null;
  meshFiles: MeshFiles;
  hoveredJoint: string | null;
  selectedJoint: string | null;
  selectedLink: string | null;
  jointValues: Record<string, number>;
  jointLimits: JointLimits;
  jointAxes: JointAxisMap;
  collisionVisibility: CollisionVisibility;
  rotationPlaneVisible: boolean;
  originalUrdfContent: string;
  vizUrdfContent: string;
  urdfViewMode: UrdfViewMode;
  endEffectorLink: string | null;
  viewerEpisode: ViewerEpisode | null;
  currentFrame: number;
  episodeSaveHandler?: (episode: ViewerEpisode, saveAsNew: boolean, newName?: string) => void;
  onViewerOpenChange?: (open: boolean) => void;
  setUrdfEditorSplitView: (split: boolean) => void;
  setUrdfViewMode: (mode: UrdfViewMode) => void;
  setShowUrdfEditor: (show: boolean) => void;
  setMotionDataFile: (file: File | null) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setHasAnimationFrames: (hasFrames: boolean) => void;
  handleFrameChange: (frame: number, total: number) => void;
  setRobotBoundingBox: (box: THREE.Box3 | null) => void;
  setRobot: (robot: URDFRobot | null) => void;
  handleIkApplied: (values: Record<string, number>) => void;
  handleViewerResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  setSelectedJoint: (joint: string | null) => void;
  setSelectedLink: (link: string | null) => void;
  setHoveredJoint: (joint: string | null) => void;
  handleJointChange: (jointName: string, value: number) => void;
  handleRobotJointsLoaded: (jointNames: string[], jointValues: Record<string, number>) => void;
  handleVizUrdfChange: (content: string) => void;
  getExportUrdfContent: () => string;
  setCurrentFrame: (frame: number) => void;
};

export const ViewerLayout = ({
  isSidebarCollapsed,
  isRightSidebarCollapsed,
  sidebarWidth,
  rightSidebarWidth,
  showUrdfEditor,
  urdfEditorSplitView,
  recordingViewHeight,
  urdfContentVersion,
  urdfFile,
  meshFiles,
  hoveredJoint,
  selectedJoint,
  selectedLink,
  jointValues,
  jointLimits,
  jointAxes,
  collisionVisibility,
  rotationPlaneVisible,
  originalUrdfContent,
  vizUrdfContent,
  urdfViewMode,
  endEffectorLink,
  viewerEpisode,
  currentFrame,
  episodeSaveHandler,
  onViewerOpenChange,
  setUrdfEditorSplitView,
  setUrdfViewMode,
  setShowUrdfEditor,
  setMotionDataFile,
  setIsPlaying,
  setHasAnimationFrames,
  handleFrameChange,
  setRobotBoundingBox,
  setRobot,
  handleIkApplied,
  handleViewerResizeStart,
  setSelectedJoint,
  setSelectedLink,
  setHoveredJoint,
  handleJointChange,
  handleRobotJointsLoaded,
  handleVizUrdfChange,
  getExportUrdfContent,
  setCurrentFrame,
}: ViewerLayoutProps) => {
  const viewerKey = `urdf-${urdfContentVersion}`;
  const viewerProps = {
    urdfFile,
    initialMeshFiles: meshFiles,
    selectedJoint: hoveredJoint || selectedJoint,
    selectedLink,
    jointValues,
    jointLimits,
    jointAxes,
    onJointSelect: setSelectedJoint,
    onLinkSelect: setSelectedLink,
    onJointHover: setHoveredJoint,
    onJointChange: handleJointChange,
    onRobotJointsLoaded: handleRobotJointsLoaded,
    onMotionFileChange: setMotionDataFile,
    onPlayingChange: setIsPlaying,
    onAnimationFramesChange: setHasAnimationFrames,
    onFrameChange: handleFrameChange,
    collisionVisibility,
    rotationPlaneVisible,
    onRobotBoundingBoxChange: setRobotBoundingBox,
    onRobotLoaded: setRobot,
    endEffectorLink,
    onIkApplied: handleIkApplied,
  };

  return (
    <main
      className="flex-1 flex flex-col overflow-hidden bg-background transition-[margin-left,margin-right] duration-200 ease-out"
      style={{
        marginLeft: isSidebarCollapsed ? 0 : sidebarWidth,
        marginRight: isRightSidebarCollapsed ? 0 : rightSidebarWidth,
        marginTop: "28px",
      }}
    >
      <div className="flex-1 min-h-0 relative">
        {showUrdfEditor && urdfEditorSplitView ? (
          <div className="flex flex-col h-full">
            {/* Simulation in top half */}
            <div className="flex-1 min-h-0 border-b border-border/20">
              <Viewer3D key={viewerKey} {...viewerProps} />
            </div>
            {/* Editor in bottom half */}
            <div className="flex-1 min-h-0">
              <URDFComparison
                originalUrdf={originalUrdfContent}
                vizUrdf={vizUrdfContent}
                isOpen={true}
                onClose={() => setShowUrdfEditor(false)}
                onVizUrdfChange={handleVizUrdfChange}
                getExportUrdf={getExportUrdfContent}
                meshFiles={meshFiles}
                githubToken={
                  typeof window !== "undefined" ? import.meta.env.VITE_GITHUB_TOKEN || null : null
                }
                inline={true}
                splitView={true}
                onSplitViewToggle={setUrdfEditorSplitView}
                selectedView={urdfViewMode}
                onSelectedViewChange={setUrdfViewMode}
              />
            </div>
          </div>
        ) : showUrdfEditor ? (
          <div className="flex flex-col h-full">
            {/* Simulation in top half */}
            <div className="flex-1 min-h-0 border-b border-border/20">
              <Viewer3D key={viewerKey} {...viewerProps} />
            </div>
            {/* Editor in bottom half */}
            <div className="flex-1 min-h-0">
              <URDFComparison
                originalUrdf={originalUrdfContent}
                vizUrdf={vizUrdfContent}
                isOpen={true}
                onClose={() => setShowUrdfEditor(false)}
                onVizUrdfChange={handleVizUrdfChange}
                getExportUrdf={getExportUrdfContent}
                meshFiles={meshFiles}
                githubToken={
                  typeof window !== "undefined" ? import.meta.env.VITE_GITHUB_TOKEN || null : null
                }
                inline={true}
                splitView={true}
                onSplitViewToggle={setUrdfEditorSplitView}
                selectedView={urdfViewMode}
                onSelectedViewChange={setUrdfViewMode}
              />
            </div>
          </div>
        ) : showUrdfEditor ? (
          <URDFComparison
            originalUrdf={originalUrdfContent}
            vizUrdf={vizUrdfContent}
            isOpen={true}
            onClose={() => setShowUrdfEditor(false)}
            onVizUrdfChange={handleVizUrdfChange}
            getExportUrdf={getExportUrdfContent}
            meshFiles={meshFiles}
            selectedView={urdfViewMode}
            onSelectedViewChange={setUrdfViewMode}
            githubToken={
              typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN
                ? import.meta.env.VITE_GITHUB_TOKEN
                : null
            }
            inline={true}
            splitView={false}
            onSplitViewToggle={setUrdfEditorSplitView}
          />
        ) : (
          <div className="flex flex-col h-full">
            {/* 3D Viewer in top half */}
            <div
              className="min-h-0 border-b border-border/20"
              style={{ flex: `0 0 ${(1 - recordingViewHeight) * 100}%` }}
            >
              <Viewer3D key={viewerKey} {...viewerProps} />
            </div>
            {/* Vertical Resizer - always visible */}
            <div
              onPointerDown={handleViewerResizeStart}
              className="cursor-row-resize select-none bg-border/30 hover:bg-border/60 transition-colors relative group flex-shrink-0 z-10"
              style={{ height: VIEWER_RESIZER_HEIGHT }}
              aria-label="Resize viewer"
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-0.5 bg-border/40 group-hover:bg-border/80 transition-colors rounded-full" />
              </div>
            </div>
            {/* Recording view in bottom half - always shows header */}
            <div
              className="min-h-0 overflow-hidden flex flex-col"
              style={{
                flex: `0 0 ${recordingViewHeight * 100}%`,
              }}
            >
              {viewerEpisode ? (
                <EpisodeViewer3DModal
                  episode={viewerEpisode}
                  open={true}
                  onOpenChange={(open) => {
                    // Don't allow closing - always keep it open
                    if (!open) {
                      onViewerOpenChange?.(true);
                    }
                  }}
                  inline={true}
                  globalCurrentFrame={currentFrame}
                  onSetGlobalFrame={(frame: number) => {
                    (window as WindowWithViewerHandlers).viewer3dSetFrame?.(frame);
                    setCurrentFrame(frame);
                  }}
                  showOnlyHeader={recordingViewHeight <= 0.08}
                  onSaveEpisode={episodeSaveHandler}
                />
              ) : (
                <div className="flex-1 min-h-0 flex items-center justify-center bg-background border-t border-border">
                  <div className="flex flex-col items-center gap-3 text-center px-6">
                    <div className="text-sm font-medium text-muted-foreground">
                      No episodes available
                    </div>
                    <div className="text-xs text-muted-foreground/70 max-w-md">
                      Record an episode or import episodes from files to view them here.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
