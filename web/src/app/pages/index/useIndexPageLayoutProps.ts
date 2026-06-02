import type { PageLayoutProps } from "@/features/layout/page/PageLayout";

type LeftSidebarProps = PageLayoutProps["leftSidebarProps"];
type ViewerLayoutProps = PageLayoutProps["viewerLayoutProps"];
type RightSidebarProps = PageLayoutProps["rightSidebarProps"];

type LayoutShellParams = Pick<
  PageLayoutProps,
  | "isLoading"
  | "topNavBarProps"
  | "urdfStatusBannerProps"
  | "loadIssuesPanelProps"
  | "healthActionPanelProps"
  | "exportDialogProps"
  | "povCamerasOverlayProps"
  | "mappingPanelsProps"
  | "creationDialogsProps"
>;

type WorkspaceModeParams = Pick<
  LeftSidebarProps,
  | "workspaceMode"
  | "assemblyInspector"
  | "assemblyHasPhysicalContact"
  | "assemblyContactPairCount"
  | "assemblyProposalRequested"
  | "onRequestAssemblyProposal"
  | "substitutionSession"
  | "onApplySubstitution"
>;

type JointEditingParams = {
  availableJoints: LeftSidebarProps["availableJoints"];
  jointLimits: LeftSidebarProps["jointLimits"];
  jointAxes: LeftSidebarProps["jointAxes"];
  originalJointAxes: LeftSidebarProps["originalJointAxes"];
  originalUrdfContent: LeftSidebarProps["originalUrdfContent"];
  vizUrdfContent: LeftSidebarProps["vizUrdfContent"];
  onJointChange: LeftSidebarProps["onJointChange"];
  onJointSelect: LeftSidebarProps["onJointSelect"];
  selectedJoint: LeftSidebarProps["selectedJoint"];
  onVizUrdfChange: LeftSidebarProps["onVizUrdfChange"];
  onJointAxisChange: LeftSidebarProps["onJointAxisChange"];
  onJointOriginChange: RightSidebarProps["onJointOriginChange"];
  onResetAxis: LeftSidebarProps["onResetAxis"];
  onJointTypeChange: LeftSidebarProps["onJointTypeChange"];
  onJointNameChange: LeftSidebarProps["onJointNameChange"];
  onDeleteJoint: LeftSidebarProps["onDeleteJoint"];
  deletedJoints: LeftSidebarProps["deletedJoints"];
};

type LeftSidebarWorkflowParams = {
  getExportUrdfContent: LeftSidebarProps["getExportUrdfContent"];
  onMotionDataUpload: LeftSidebarProps["onMotionDataUpload"];
  onPlayAnimation: LeftSidebarProps["onPlayAnimation"];
  isPlaying: LeftSidebarProps["isPlaying"];
  motionDataFileName: LeftSidebarProps["motionDataFileName"];
  hasAnimationFrames: LeftSidebarProps["hasAnimationFrames"];
  currentFrame: LeftSidebarProps["currentFrame"];
  totalFrames: LeftSidebarProps["totalFrames"];
  sidebarWidth: LeftSidebarProps["sidebarWidth"];
  isSidebarCollapsed: LeftSidebarProps["isSidebarCollapsed"];
  onToggleSidebarCollapse: LeftSidebarProps["onToggleCollapse"];
  meshFiles: LeftSidebarProps["meshFiles"];
  onCollisionVisibilityChange: LeftSidebarProps["onCollisionVisibilityChange"];
  rotationPlaneVisible: LeftSidebarProps["rotationPlaneVisible"];
  onRotationPlaneVisibilityChange: LeftSidebarProps["onRotationPlaneVisibilityChange"];
  onFrameChange: LeftSidebarProps["onFrameChange"];
  onUrdfEditorToggle: LeftSidebarProps["onUrdfEditorToggle"];
  showUrdfEditor: LeftSidebarProps["showUrdfEditor"];
  viewerSplitView: LeftSidebarProps["viewerSplitView"];
  onViewerSplitViewChange: LeftSidebarProps["onViewerSplitViewChange"];
  onViewerEpisodeChange: LeftSidebarProps["onViewerEpisodeChange"];
  onViewerOpenChange: LeftSidebarProps["onViewerOpenChange"];
  onEpisodeSaveHandlerChange: LeftSidebarProps["onEpisodeSaveHandlerChange"];
  episodesViewHeight: LeftSidebarProps["episodesViewHeight"];
  onEpisodesResizeStart: LeftSidebarProps["onEpisodesResizeStart"];
  onDatasetActionsReady: LeftSidebarProps["onDatasetActionsReady"];
  onSidebarResizeStart: LeftSidebarProps["onSidebarResizeStart"];
  activeWorldSnapshotRef: LeftSidebarProps["activeWorldSnapshotRef"];
  urdfBasePath: LeftSidebarProps["urdfBasePath"];
  packageRoots: LeftSidebarProps["packageRoots"];
};

type ViewerPaneParams = {
  isRightSidebarCollapsed: ViewerLayoutProps["isRightSidebarCollapsed"];
  rightSidebarWidth: ViewerLayoutProps["rightSidebarWidth"];
  urdfEditorSplitView: ViewerLayoutProps["urdfEditorSplitView"];
  recordingViewHeight: ViewerLayoutProps["recordingViewHeight"];
  urdfContentVersion: ViewerLayoutProps["urdfContentVersion"];
  assemblyIssueReportUrl: ViewerLayoutProps["assemblyIssueReportUrl"];
  assemblyPrimaryModel: ViewerLayoutProps["assemblyPrimaryModel"];
  urdfFile: ViewerLayoutProps["urdfFile"];
  assemblySecondaryModels: ViewerLayoutProps["assemblySecondaryModels"];
  urdfAnalysis: ViewerLayoutProps["urdfAnalysis"];
  hoveredJoint: ViewerLayoutProps["hoveredJoint"];
  hoveredLink: ViewerLayoutProps["hoveredLink"];
  selectedLink: ViewerLayoutProps["selectedLink"];
  jointValues: ViewerLayoutProps["jointValues"];
  collisionVisibility: ViewerLayoutProps["collisionVisibility"];
  collisionsVisible: ViewerLayoutProps["collisionsVisible"];
  collisionSimplifyLinks: ViewerLayoutProps["collisionSimplifyLinks"];
  collisionMergedLinks: ViewerLayoutProps["collisionMergedLinks"];
  inertialVisualization: ViewerLayoutProps["inertialVisualization"];
  simulationPrepPanelOpen: ViewerLayoutProps["simulationPrepPanelOpen"];
  simulationPrepResetPoseRequestKey: ViewerLayoutProps["simulationPrepResetPoseRequestKey"];
  simulationPrepRobotMirrorVisualization: ViewerLayoutProps["simulationPrepRobotMirrorVisualization"];
  simulationPrepRobotMirrorDeemphasizedLinkNames:
    ViewerLayoutProps["simulationPrepRobotMirrorDeemphasizedLinkNames"];
  simulationPrepSymmetryVisualization: ViewerLayoutProps["simulationPrepSymmetryVisualization"];
  simulationPrepSymmetryOverlayCenterMode: ViewerLayoutProps["simulationPrepSymmetryOverlayCenterMode"];
  urdfViewMode: ViewerLayoutProps["urdfViewMode"];
  endEffectorLink: ViewerLayoutProps["endEffectorLink"];
  viewerEpisode: ViewerLayoutProps["viewerEpisode"];
  datasetConstraintSettings: ViewerLayoutProps["datasetConstraintSettings"];
  episodeSaveHandler: ViewerLayoutProps["episodeSaveHandler"];
  handleFrameChange: ViewerLayoutProps["handleFrameChange"];
  onFixMissingMeshRefs: ViewerLayoutProps["onFixMissingMeshRefs"];
  setUrdfEditorSplitView: ViewerLayoutProps["setUrdfEditorSplitView"];
  setUrdfViewMode: ViewerLayoutProps["setUrdfViewMode"];
  setMotionDataFile: ViewerLayoutProps["setMotionDataFile"];
  setIsPlaying: ViewerLayoutProps["setIsPlaying"];
  setHasAnimationFrames: ViewerLayoutProps["setHasAnimationFrames"];
  setRobotBoundingBox: ViewerLayoutProps["setRobotBoundingBox"];
  robotBoundingBox: ViewerLayoutProps["robotBoundingBox"];
  robot: ViewerLayoutProps["robot"];
  setRobot: ViewerLayoutProps["setRobot"];
  onIkApplied: ViewerLayoutProps["handleIkApplied"];
  ikDragSuppressed: ViewerLayoutProps["ikDragSuppressed"];
  onViewerResizeStart: ViewerLayoutProps["handleViewerResizeStart"];
  onLinkSelect: ViewerLayoutProps["setSelectedLink"];
  onJointHover: ViewerLayoutProps["setHoveredJoint"];
  onLinkHover: ViewerLayoutProps["setHoveredLink"];
  onRobotJointsLoaded: ViewerLayoutProps["handleRobotJointsLoaded"];
  updateUrdfFile: ViewerLayoutProps["updateUrdfFile"];
  onInertiaReliabilityChange: ViewerLayoutProps["onInertiaReliabilityChange"];
  thumbnailMode: ViewerLayoutProps["thumbnailMode"];
};

type RightSidebarParams = {
  onDuplicateAssemblyRobot: RightSidebarProps["onDuplicateAssemblyRobot"];
  substitutionSession: RightSidebarProps["substitutionSession"];
  onApplySubstitution: RightSidebarProps["onApplySubstitution"];
  episodeJointNames: RightSidebarProps["episodeJointNames"];
  availableLinks: RightSidebarProps["availableLinks"];
  hoveredLink: RightSidebarProps["hoveredLink"];
  rightSidebarCollapsed: RightSidebarProps["isRightSidebarCollapsed"];
  onJointLimitsChange: RightSidebarProps["onJointLimitsChange"];
  onJointLinkChange: RightSidebarProps["onJointLinkChange"];
  onJointVelocityChange: RightSidebarProps["onJointVelocityChange"];
  onJointEffortChange: RightSidebarProps["onJointEffortChange"];
  angleUnit: RightSidebarProps["angleUnit"];
  onAngleUnitChange: RightSidebarProps["onAngleUnitChange"];
  onMaterialChange: RightSidebarProps["onMaterialChange"];
  onLinkNameChange: RightSidebarProps["onLinkNameChange"];
  onCollisionSimplifyLinksChange: RightSidebarProps["onCollisionSimplifyLinksChange"];
  onCollisionMergedLinksChange: RightSidebarProps["onCollisionMergedLinksChange"];
  endEffectorCandidates: RightSidebarProps["endEffectorCandidates"];
  onMarkAsEndEffector: RightSidebarProps["onMarkAsEndEffector"];
  onGenerateInertialDraft: RightSidebarProps["onGenerateInertialDraft"];
  simulationPrepPanelOpen: RightSidebarProps["simulationPrepPanelOpen"];
  voxelDerivedInertialLinks: RightSidebarProps["voxelDerivedInertialLinks"];
  onRightSidebarResizeStart: RightSidebarProps["onRightSidebarResizeStart"];
  onToggleRightSidebarCollapse: RightSidebarProps["onToggleCollapse"];
};

export type UseIndexPageLayoutPropsParams = LayoutShellParams &
  WorkspaceModeParams &
  JointEditingParams &
  LeftSidebarWorkflowParams &
  ViewerPaneParams &
  RightSidebarParams;

const buildLeftSidebarProps = (params: UseIndexPageLayoutPropsParams): LeftSidebarProps => ({
  workspaceMode: params.workspaceMode,
  assemblyInspector: params.assemblyInspector,
  assemblyHasPhysicalContact: params.assemblyHasPhysicalContact,
  assemblyContactPairCount: params.assemblyContactPairCount,
  assemblyProposalRequested: params.assemblyProposalRequested,
  onRequestAssemblyProposal: params.onRequestAssemblyProposal,
  substitutionSession: params.substitutionSession,
  onApplySubstitution: params.onApplySubstitution,
  isLoading: params.isLoading,
  availableJoints: params.availableJoints,
  jointLimits: params.jointLimits,
  jointAxes: params.jointAxes,
  originalJointAxes: params.originalJointAxes,
  originalUrdfContent: params.originalUrdfContent,
  vizUrdfContent: params.vizUrdfContent,
  onJointChange: params.onJointChange,
  onJointSelect: params.onJointSelect,
  selectedJoint: params.selectedJoint,
  onVizUrdfChange: params.onVizUrdfChange,
  onJointAxisChange: params.onJointAxisChange,
  onResetAxis: params.onResetAxis,
  onJointTypeChange: params.onJointTypeChange,
  onJointNameChange: params.onJointNameChange,
  onDeleteJoint: params.onDeleteJoint,
  deletedJoints: params.deletedJoints,
  getExportUrdfContent: params.getExportUrdfContent,
  onMotionDataUpload: params.onMotionDataUpload,
  onPlayAnimation: params.onPlayAnimation,
  isPlaying: params.isPlaying,
  motionDataFileName: params.motionDataFileName,
  hasAnimationFrames: params.hasAnimationFrames,
  currentFrame: params.currentFrame,
  totalFrames: params.totalFrames,
  sidebarWidth: params.sidebarWidth,
  isSidebarCollapsed: params.isSidebarCollapsed,
  onToggleCollapse: params.onToggleSidebarCollapse,
  meshFiles: params.meshFiles,
  onCollisionVisibilityChange: params.onCollisionVisibilityChange,
  rotationPlaneVisible: params.rotationPlaneVisible,
  onRotationPlaneVisibilityChange: params.onRotationPlaneVisibilityChange,
  onFrameChange: params.onFrameChange,
  onUrdfEditorToggle: params.onUrdfEditorToggle,
  showUrdfEditor: params.showUrdfEditor,
  viewerSplitView: params.viewerSplitView,
  onViewerSplitViewChange: params.onViewerSplitViewChange,
  onViewerEpisodeChange: params.onViewerEpisodeChange,
  onViewerOpenChange: params.onViewerOpenChange,
  onEpisodeSaveHandlerChange: params.onEpisodeSaveHandlerChange,
  episodesViewHeight: params.episodesViewHeight,
  onEpisodesResizeStart: params.onEpisodesResizeStart,
  onDatasetActionsReady: params.onDatasetActionsReady,
  onSidebarResizeStart: params.onSidebarResizeStart,
  activeWorldSnapshotRef: params.activeWorldSnapshotRef,
  urdfBasePath: params.urdfBasePath,
  packageRoots: params.packageRoots,
});

const buildViewerLayoutProps = (params: UseIndexPageLayoutPropsParams): ViewerLayoutProps => ({
  workspaceMode: params.workspaceMode,
  isSidebarCollapsed: params.isSidebarCollapsed,
  isRightSidebarCollapsed: params.isRightSidebarCollapsed,
  sidebarWidth: params.sidebarWidth,
  rightSidebarWidth: params.rightSidebarWidth,
  showUrdfEditor: params.showUrdfEditor,
  urdfEditorSplitView: params.urdfEditorSplitView,
  recordingViewHeight: params.recordingViewHeight,
  urdfContentVersion: params.urdfContentVersion,
  assemblyIssueReportUrl: params.assemblyIssueReportUrl,
  assemblyPrimaryModel: params.assemblyPrimaryModel,
  assemblyContactPairCount: params.assemblyContactPairCount,
  urdfFile: params.urdfFile,
  assemblySecondaryModels: params.assemblySecondaryModels,
  urdfBasePath: params.urdfBasePath,
  packageRoots: params.packageRoots,
  urdfAnalysis: params.urdfAnalysis,
  meshFiles: params.meshFiles,
  hoveredJoint: params.hoveredJoint,
  hoveredLink: params.hoveredLink,
  selectedJoint: params.selectedJoint,
  selectedLink: params.selectedLink,
  jointValues: params.jointValues,
  jointLimits: params.jointLimits,
  jointAxes: params.jointAxes,
  collisionVisibility: params.collisionVisibility,
  rotationPlaneVisible: params.rotationPlaneVisible,
  collisionsVisible: params.collisionsVisible,
  collisionSimplifyLinks: params.collisionSimplifyLinks,
  collisionMergedLinks: params.collisionMergedLinks,
  inertialVisualization: params.inertialVisualization,
  simulationPrepPanelOpen: params.simulationPrepPanelOpen,
  simulationPrepResetPoseRequestKey: params.simulationPrepResetPoseRequestKey,
  simulationPrepRobotMirrorVisualization: params.simulationPrepRobotMirrorVisualization,
  simulationPrepRobotMirrorDeemphasizedLinkNames:
    params.simulationPrepRobotMirrorDeemphasizedLinkNames,
  simulationPrepSymmetryVisualization: params.simulationPrepSymmetryVisualization,
  simulationPrepSymmetryOverlayCenterMode: params.simulationPrepSymmetryOverlayCenterMode,
  originalUrdfContent: params.originalUrdfContent,
  vizUrdfContent: params.vizUrdfContent,
  urdfViewMode: params.urdfViewMode,
  endEffectorLink: params.endEffectorLink,
  viewerEpisode: params.viewerEpisode,
  datasetConstraintSettings: params.datasetConstraintSettings,
  currentFrame: params.currentFrame,
  episodeSaveHandler: params.episodeSaveHandler,
  setUrdfEditorSplitView: params.setUrdfEditorSplitView,
  setUrdfViewMode: params.setUrdfViewMode,
  setShowUrdfEditor: params.onUrdfEditorToggle,
  setMotionDataFile: params.setMotionDataFile,
  setIsPlaying: params.setIsPlaying,
  setHasAnimationFrames: params.setHasAnimationFrames,
  handleFrameChange: params.handleFrameChange,
  setRobotBoundingBox: params.setRobotBoundingBox,
  robotBoundingBox: params.robotBoundingBox,
  robot: params.robot,
  setRobot: params.setRobot,
  handleIkApplied: params.onIkApplied,
  ikDragSuppressed: params.ikDragSuppressed,
  handleViewerResizeStart: params.onViewerResizeStart,
  setSelectedJoint: params.onJointSelect,
  setSelectedLink: params.onLinkSelect,
  setHoveredJoint: params.onJointHover,
  setHoveredLink: params.onLinkHover,
  handleJointChange: params.onJointChange,
  handleRobotJointsLoaded: params.onRobotJointsLoaded,
  handleVizUrdfChange: params.onVizUrdfChange,
  updateUrdfFile: params.updateUrdfFile,
  onInertiaReliabilityChange: params.onInertiaReliabilityChange,
  getExportUrdfContent: params.getExportUrdfContent,
  setCurrentFrame: params.onFrameChange,
  onFixMissingMeshRefs: params.onFixMissingMeshRefs,
  onViewerOpenChange: params.onViewerOpenChange,
  thumbnailMode: params.thumbnailMode,
});

const buildRightSidebarProps = (params: UseIndexPageLayoutPropsParams): RightSidebarProps => ({
  workspaceMode: params.workspaceMode,
  assemblyInspector: params.assemblyInspector,
  onDuplicateAssemblyRobot: params.onDuplicateAssemblyRobot,
  substitutionSession: params.substitutionSession,
  onApplySubstitution: params.onApplySubstitution,
  availableJoints: params.availableJoints,
  episodeJointNames: params.episodeJointNames,
  availableLinks: params.availableLinks,
  jointLimits: params.jointLimits,
  selectedJoint: params.selectedJoint,
  selectedLink: params.selectedLink,
  hoveredLink: params.hoveredLink,
  onJointSelect: params.onJointSelect,
  onLinkSelect: params.onLinkSelect,
  hoveredJoint: params.hoveredJoint,
  onJointHover: params.onJointHover,
  deletedJoints: params.deletedJoints,
  rightSidebarWidth: params.rightSidebarWidth,
  isRightSidebarCollapsed: params.rightSidebarCollapsed,
  vizUrdfContent: params.vizUrdfContent,
  urdfAnalysis: params.urdfAnalysis,
  jointAxes: params.jointAxes,
  originalJointAxes: params.originalJointAxes,
  onJointChange: params.onJointChange,
  onJointAxisChange: params.onJointAxisChange,
  onJointOriginChange: params.onJointOriginChange,
  onResetAxis: params.onResetAxis,
  onJointTypeChange: params.onJointTypeChange,
  onJointLimitsChange: params.onJointLimitsChange,
  onJointVelocityChange: params.onJointVelocityChange,
  onJointEffortChange: params.onJointEffortChange,
  onJointNameChange: params.onJointNameChange,
  onDeleteJoint: params.onDeleteJoint,
  onJointLinkChange: params.onJointLinkChange,
  angleUnit: params.angleUnit,
  onAngleUnitChange: params.onAngleUnitChange,
  meshFiles: params.meshFiles,
  onMaterialChange: params.onMaterialChange,
  onLinkNameChange: params.onLinkNameChange,
  onUrdfChange: params.onVizUrdfChange,
  collisionVisibility: params.collisionVisibility,
  onCollisionVisibilityChange: params.onCollisionVisibilityChange,
  collisionSimplifyLinks: params.collisionSimplifyLinks,
  onCollisionSimplifyLinksChange: params.onCollisionSimplifyLinksChange,
  collisionMergedLinks: params.collisionMergedLinks,
  onCollisionMergedLinksChange: params.onCollisionMergedLinksChange,
  endEffectorLink: params.endEffectorLink,
  endEffectorCandidates: params.endEffectorCandidates,
  onMarkAsEndEffector: params.onMarkAsEndEffector,
  onGenerateInertialDraft: params.onGenerateInertialDraft,
  simulationPrepPanelOpen: params.simulationPrepPanelOpen,
  voxelDerivedInertialLinks: params.voxelDerivedInertialLinks,
  robot: params.robot,
  onRightSidebarResizeStart: params.onRightSidebarResizeStart,
  onToggleCollapse: params.onToggleRightSidebarCollapse,
});

export const useIndexPageLayoutProps = (params: UseIndexPageLayoutPropsParams) => {
  const leftSidebarProps = buildLeftSidebarProps(params);
  const viewerLayoutProps = buildViewerLayoutProps(params);
  const rightSidebarProps = buildRightSidebarProps(params);

  const pageLayoutProps: PageLayoutProps = {
    isLoading: params.isLoading,
    topNavBarProps: params.topNavBarProps,
    leftSidebarProps,
    viewerLayoutProps,
    rightSidebarProps,
    urdfStatusBannerProps: params.urdfStatusBannerProps,
    loadIssuesPanelProps: params.loadIssuesPanelProps,
    healthActionPanelProps: params.healthActionPanelProps,
    exportDialogProps: params.exportDialogProps,
    povCamerasOverlayProps: params.povCamerasOverlayProps,
    mappingPanelsProps: params.mappingPanelsProps,
    creationDialogsProps: params.creationDialogsProps,
  };

  return {
    leftSidebarProps,
    pageLayoutProps,
    rightSidebarProps,
    viewerLayoutProps,
  };
};
