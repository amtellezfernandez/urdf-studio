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
  | "povCamerasOverlayProps"
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
  availableLinks: LeftSidebarProps["availableLinks"];
  cameraCount: LeftSidebarProps["cameraCount"];
  jointLimits: ViewerLayoutProps["jointLimits"];
  jointAxes: ViewerLayoutProps["jointAxes"];
  originalJointAxes: RightSidebarProps["originalJointAxes"];
  originalUrdfContent: ViewerLayoutProps["originalUrdfContent"];
  vizUrdfContent: ViewerLayoutProps["vizUrdfContent"];
  onJointChange: ViewerLayoutProps["handleJointChange"];
  onJointSelect: LeftSidebarProps["onJointSelect"];
  selectedJoint: LeftSidebarProps["selectedJoint"];
  onVizUrdfChange: ViewerLayoutProps["handleVizUrdfChange"];
  onJointAxisChange: RightSidebarProps["onJointAxisChange"];
  onJointOriginChange: RightSidebarProps["onJointOriginChange"];
  onResetAxis: RightSidebarProps["onResetAxis"];
  onJointTypeChange: RightSidebarProps["onJointTypeChange"];
  onJointNameChange: RightSidebarProps["onJointNameChange"];
  onDeleteJoint: RightSidebarProps["onDeleteJoint"];
  deletedJoints: RightSidebarProps["deletedJoints"];
};

type LeftSidebarWorkflowParams = {
  sidebarWidth: LeftSidebarProps["sidebarWidth"];
  isSidebarCollapsed: LeftSidebarProps["isSidebarCollapsed"];
  onToggleSidebarCollapse: LeftSidebarProps["onToggleCollapse"];
  meshFiles: LeftSidebarProps["meshFiles"];
  leftSidebarTopPanelHeight: LeftSidebarProps["topPanelHeight"];
  onLeftSidebarVerticalResizeStart: LeftSidebarProps["onVerticalResizeStart"];
  onSidebarResizeStart: LeftSidebarProps["onSidebarResizeStart"];
  urdfBasePath: LeftSidebarProps["urdfBasePath"];
  packageRoots: LeftSidebarProps["packageRoots"];
  workspaceTransfer: LeftSidebarProps["workspaceTransfer"];
};

type ViewerPaneParams = {
  isRightSidebarCollapsed: ViewerLayoutProps["isRightSidebarCollapsed"];
  rightSidebarWidth: ViewerLayoutProps["rightSidebarWidth"];
  urdfEditorSplitView: ViewerLayoutProps["urdfEditorSplitView"];
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
  rotationPlaneVisible: ViewerLayoutProps["rotationPlaneVisible"];
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
  showUrdfEditor: ViewerLayoutProps["showUrdfEditor"];
  urdfViewMode: ViewerLayoutProps["urdfViewMode"];
  endEffectorLink: ViewerLayoutProps["endEffectorLink"];
  handleFrameChange: ViewerLayoutProps["handleFrameChange"];
  onFixMissingMeshRefs: ViewerLayoutProps["onFixMissingMeshRefs"];
  getExportUrdfContent: ViewerLayoutProps["getExportUrdfContent"];
  setUrdfEditorSplitView: ViewerLayoutProps["setUrdfEditorSplitView"];
  setUrdfViewMode: ViewerLayoutProps["setUrdfViewMode"];
  onUrdfEditorToggle: ViewerLayoutProps["setShowUrdfEditor"];
  setIsPlaying: ViewerLayoutProps["setIsPlaying"];
  setHasAnimationFrames: ViewerLayoutProps["setHasAnimationFrames"];
  setRobotBoundingBox: ViewerLayoutProps["setRobotBoundingBox"];
  setRobot: ViewerLayoutProps["setRobot"];
  onIkApplied: ViewerLayoutProps["handleIkApplied"];
  ikDragSuppressed: ViewerLayoutProps["ikDragSuppressed"];
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
  onCollisionVisibilityChange: RightSidebarProps["onCollisionVisibilityChange"];
  onCollisionSimplifyLinksChange: RightSidebarProps["onCollisionSimplifyLinksChange"];
  onCollisionMergedLinksChange: RightSidebarProps["onCollisionMergedLinksChange"];
  endEffectorCandidates: RightSidebarProps["endEffectorCandidates"];
  onMarkAsEndEffector: RightSidebarProps["onMarkAsEndEffector"];
  onGenerateInertialDraft: RightSidebarProps["onGenerateInertialDraft"];
  simulationPrepPanelOpen: RightSidebarProps["simulationPrepPanelOpen"];
  voxelDerivedInertialLinks: RightSidebarProps["voxelDerivedInertialLinks"];
  robot: RightSidebarProps["robot"];
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
  availableLinks: params.availableLinks,
  cameraCount: params.cameraCount,
  onJointSelect: params.onJointSelect,
  selectedJoint: params.selectedJoint,
  originalUrdfContent: params.originalUrdfContent,
  vizUrdfContent: params.vizUrdfContent,
  sidebarWidth: params.sidebarWidth,
  isSidebarCollapsed: params.isSidebarCollapsed,
  onToggleCollapse: params.onToggleSidebarCollapse,
  meshFiles: params.meshFiles,
  topPanelHeight: params.leftSidebarTopPanelHeight,
  onVerticalResizeStart: params.onLeftSidebarVerticalResizeStart,
  onSidebarResizeStart: params.onSidebarResizeStart,
  urdfBasePath: params.urdfBasePath,
  packageRoots: params.packageRoots,
  workspaceTransfer: params.workspaceTransfer,
  workspaceLauncherNeedsAttention: params.topNavBarProps.workspaceLauncherNeedsAttention,
  workspaceLauncherStatusLabel: params.topNavBarProps.workspaceLauncherStatusLabel,
  onOpenWorkspaceLauncher: params.topNavBarProps.onOpenWorkspaceLauncher,
});

const buildViewerLayoutProps = (params: UseIndexPageLayoutPropsParams): ViewerLayoutProps => ({
  workspaceMode: params.workspaceMode,
  isSidebarCollapsed: params.isSidebarCollapsed,
  isRightSidebarCollapsed: params.isRightSidebarCollapsed,
  sidebarWidth: params.sidebarWidth,
  rightSidebarWidth: params.rightSidebarWidth,
  showUrdfEditor: params.showUrdfEditor,
  urdfEditorSplitView: params.urdfEditorSplitView,
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
  setUrdfEditorSplitView: params.setUrdfEditorSplitView,
  setUrdfViewMode: params.setUrdfViewMode,
  setShowUrdfEditor: params.onUrdfEditorToggle,
  setIsPlaying: params.setIsPlaying,
  setHasAnimationFrames: params.setHasAnimationFrames,
  handleFrameChange: params.handleFrameChange,
  setRobotBoundingBox: params.setRobotBoundingBox,
  setRobot: params.setRobot,
  handleIkApplied: params.onIkApplied,
  ikDragSuppressed: params.ikDragSuppressed,
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
  onFixMissingMeshRefs: params.onFixMissingMeshRefs,
  thumbnailMode: params.thumbnailMode,
});

const buildRightSidebarProps = (params: UseIndexPageLayoutPropsParams): RightSidebarProps => ({
  workspaceMode: params.workspaceMode,
  assemblyInspector: params.assemblyInspector,
  onDuplicateAssemblyRobot: params.onDuplicateAssemblyRobot,
  substitutionSession: params.substitutionSession,
  onApplySubstitution: params.onApplySubstitution,
  availableJoints: params.availableJoints,
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
    povCamerasOverlayProps: params.povCamerasOverlayProps,
    creationDialogsProps: params.creationDialogsProps,
  };

  return {
    leftSidebarProps,
    pageLayoutProps,
    rightSidebarProps,
    viewerLayoutProps,
  };
};
