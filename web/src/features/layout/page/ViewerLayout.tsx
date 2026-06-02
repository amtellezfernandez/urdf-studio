import type React from "react";
import { Suspense, lazy } from "react";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaSymmetryCenterMode } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import type {
  InertialVisualizationSettings,
  MeshFiles,
  RobotBasePose,
  UrdfViewMode,
  ViewerEpisode,
} from "@/shared/types/feature";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";
import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { AssemblySecondaryModel } from "@/features/assembly/types";
import type { WorkspaceMode } from "@/features/workspace/types";
import {
  TOP_NAV_HEIGHT,
} from "@/features/layout/page/constants";
import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { WorkspaceViewerContent } from "@/features/layout/page/WorkspaceViewerContent";
import { toViewer3DProps } from "@/features/layout/page/viewer3DProps";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { IkAppliedMetadata } from "@/features/viewer/useIkSolver";
import type { DatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";

const URDFComparison = lazy(() =>
  import("@/features/urdf/editor/URDFComparison").then((module) => ({ default: module.URDFComparison }))
);
type ViewerLayoutProps = {
  workspaceMode: WorkspaceMode;
  assemblyIssueReportUrl?: string;
  assemblyPrimaryModel?: { id: string; name: string };
  assemblyContactPairCount: number;
  isSidebarCollapsed: boolean;
  isRightSidebarCollapsed: boolean;
  sidebarWidth: number;
  rightSidebarWidth: number;
  showUrdfEditor: boolean;
  urdfEditorSplitView: boolean;
  recordingViewHeight: number;
  urdfContentVersion: number;
  urdfFile: File | null;
  assemblySecondaryModels: AssemblySecondaryModel[];
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  urdfAnalysis: UrdfAnalysis | null;
  meshFiles: MeshFiles;
  hoveredJoint: string | null;
  hoveredLink: string | null;
  selectedJoint: string | null;
  selectedLink: string | null;
  jointValues: Record<string, number>;
  jointLimits: JointLimits;
  jointAxes: JointAxisMap;
  collisionVisibility: CollisionVisibility;
  rotationPlaneVisible: boolean;
  collisionsVisible: boolean;
  collisionSimplifyLinks: string[];
  collisionMergedLinks: string[];
  inertialVisualization: InertialVisualizationSettings;
  simulationPrepPanelOpen?: boolean;
  simulationPrepResetPoseRequestKey?: string | null;
  simulationPrepRobotMirrorVisualization?: RobotMirrorSymmetryCheck | null;
  simulationPrepRobotMirrorDeemphasizedLinkNames?: string[] | null;
  simulationPrepSymmetryVisualization?: RepeatedInertiaSymmetryChain | null;
  simulationPrepSymmetryOverlayCenterMode?: RepeatedInertiaSymmetryCenterMode;
  originalUrdfContent: string;
  vizUrdfContent: string;
  urdfViewMode: UrdfViewMode;
  endEffectorLink: string | null;
  viewerEpisode: ViewerEpisode | null;
  datasetConstraintSettings?: DatasetConstraintSettings;
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
  robotBoundingBox: THREE.Box3 | null;
  robot: URDFRobot | null;
  setRobot: (robot: URDFRobot | null) => void;
  handleIkApplied: (
    values: Record<string, number>,
    metadata: IkAppliedMetadata,
  ) => void;
  ikDragSuppressed?: boolean;
  handleViewerResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  setSelectedJoint: (joint: string | null) => void;
  setSelectedLink: (link: string | null) => void;
  setHoveredJoint: (joint: string | null) => void;
  setHoveredLink: (link: string | null) => void;
  handleJointChange: (jointName: string, value: number) => void;
  handleRobotJointsLoaded: (jointNames: string[], jointValues: Record<string, number>) => void;
  handleVizUrdfChange: (content: string) => void;
  updateUrdfFile: (content: string) => void;
  getExportUrdfContent: () => string;
  setCurrentFrame: (frame: number) => void;
  thumbnailMode?: boolean;
  onFixMissingMeshRefs?: () => void;
  runtimeRobotBasePose?: RobotBasePose | null;
  onObjectSelect?: Viewer3DProps["onObjectSelect"];
  onInertiaReliabilityChange?: Viewer3DProps["onInertiaReliabilityChange"];
  enableObjectActionsInReadOnly?: boolean;
};

export const ViewerLayout = ({
  workspaceMode,
  assemblyIssueReportUrl,
  assemblyPrimaryModel,
  assemblyContactPairCount,
  isSidebarCollapsed,
  isRightSidebarCollapsed,
  sidebarWidth,
  rightSidebarWidth,
  showUrdfEditor,
  urdfEditorSplitView,
  recordingViewHeight,
  urdfContentVersion,
  urdfFile,
  assemblySecondaryModels,
  urdfBasePath,
  packageRoots,
  urdfAnalysis,
  meshFiles,
  hoveredJoint,
  hoveredLink,
  selectedJoint,
  selectedLink,
  jointValues,
  jointLimits,
  jointAxes,
  collisionVisibility,
  rotationPlaneVisible,
  collisionsVisible,
  collisionSimplifyLinks,
  collisionMergedLinks,
  inertialVisualization,
  simulationPrepPanelOpen = false,
  simulationPrepResetPoseRequestKey = null,
  simulationPrepRobotMirrorVisualization = null,
  simulationPrepRobotMirrorDeemphasizedLinkNames = null,
  simulationPrepSymmetryVisualization = null,
  simulationPrepSymmetryOverlayCenterMode = "robot-center",
  originalUrdfContent,
  vizUrdfContent,
  urdfViewMode,
  endEffectorLink,
  viewerEpisode,
  datasetConstraintSettings,
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
  robotBoundingBox,
  robot,
  setRobot,
  handleIkApplied,
  ikDragSuppressed = false,
  handleViewerResizeStart,
  setSelectedJoint,
  setSelectedLink,
  setHoveredJoint,
  setHoveredLink,
  handleJointChange,
  handleRobotJointsLoaded,
  handleVizUrdfChange,
  updateUrdfFile,
  getExportUrdfContent,
  setCurrentFrame,
  onInertiaReliabilityChange,
  thumbnailMode = false,
  onFixMissingMeshRefs,
}: ViewerLayoutProps) => {
  const viewerKey = `urdf-${urdfContentVersion}`;
  const viewerProps = toViewer3DProps({
    workspaceMode,
    assemblyPrimaryModel,
    urdfFile,
    assemblySecondaryModels,
    urdfBasePath,
    packageRoots,
    urdfAnalysis,
    meshFiles,
    hoveredJoint,
    hoveredLink,
    selectedJoint,
    selectedLink,
    jointValues,
    jointLimits,
    jointAxes,
    collisionVisibility,
    collisionsVisible,
    collisionSimplifyLinks,
    collisionMergedLinks,
    rotationPlaneVisible,
    inertialVisualization,
    simulationPrepPanelOpen,
    simulationPrepResetPoseRequestKey,
    simulationPrepRobotMirrorVisualization,
    simulationPrepRobotMirrorDeemphasizedLinkNames,
    simulationPrepSymmetryVisualization,
    simulationPrepSymmetryOverlayCenterMode,
    setSelectedJoint,
    setSelectedLink,
    setHoveredJoint,
    setHoveredLink,
    handleJointChange,
    handleRobotJointsLoaded,
    setMotionDataFile,
    setIsPlaying,
    setHasAnimationFrames,
    handleFrameChange,
    setRobotBoundingBox,
    setRobot,
    endEffectorLink,
    handleIkApplied,
    ikDragSuppressed,
    vizUrdfContent,
    updateUrdfFile,
    onInertiaReliabilityChange,
    thumbnailMode,
    preferLegacyRuntime: true,
  });

  if (thumbnailMode) {
    return (
      <main className="h-screen w-screen overflow-hidden bg-transparent">
        <ViewerHost
          viewerKey={viewerKey}
          viewerProps={viewerProps}
          fallbackClassName="h-full w-full bg-transparent"
        />
      </main>
    );
  }

  return (
    <main
      className="flex-1 flex flex-col overflow-hidden bg-background transition-[margin-left,margin-right] duration-200 ease-out"
      style={{
        marginLeft: isSidebarCollapsed ? 0 : sidebarWidth,
        marginRight: isRightSidebarCollapsed ? 0 : rightSidebarWidth,
        marginTop: TOP_NAV_HEIGHT,
      }}
    >
      <div className="flex-1 min-h-0 relative">
        {showUrdfEditor ? (
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 border-b border-border/20">
              <ViewerHost
                viewerKey={viewerKey}
                viewerProps={viewerProps}
                fallbackClassName="h-full w-full bg-background"
              />
            </div>
            <div className="flex-1 min-h-0">
              <Suspense fallback={<div className="h-full w-full bg-background" />}>
                <URDFComparison
                  originalUrdf={originalUrdfContent}
                  vizUrdf={vizUrdfContent}
                  isOpen={true}
                  onClose={() => setShowUrdfEditor(false)}
                  onVizUrdfChange={handleVizUrdfChange}
                  getExportUrdf={getExportUrdfContent}
                  meshFiles={meshFiles}
                  urdfBasePath={urdfBasePath}
                  packageRoots={packageRoots}
                  onFixMissingMeshRefs={onFixMissingMeshRefs}
                  inline={true}
                  splitView={urdfEditorSplitView}
                  onSplitViewToggle={setUrdfEditorSplitView}
                  selectedView={urdfViewMode}
                  onSelectedViewChange={setUrdfViewMode}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <WorkspaceViewerContent
            workspaceMode={workspaceMode}
            viewerKey={viewerKey}
            viewerProps={viewerProps}
            showUrdfEditor={false}
            assemblyIssueReportUrl={assemblyIssueReportUrl}
            assemblyContactPairCount={assemblyContactPairCount}
            assemblySecondaryModelsCount={assemblySecondaryModels.length}
            primaryRobotName={urdfFile ? urdfFile.name.replace(/^viz-/, "") : "No primary robot"}
            recordingViewHeight={recordingViewHeight}
            handleViewerResizeStart={handleViewerResizeStart}
            viewerEpisode={viewerEpisode}
            onViewerOpenChange={onViewerOpenChange}
            robotBoundingBox={robotBoundingBox}
            robot={robot}
            jointLimits={jointLimits}
            currentFrame={currentFrame}
            setCurrentFrame={setCurrentFrame}
            datasetConstraintSettings={datasetConstraintSettings}
            episodeSaveHandler={episodeSaveHandler}
          />
        )}
      </div>
    </main>
  );
};
