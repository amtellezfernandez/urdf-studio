import { Suspense, useState, useCallback, useMemo, startTransition, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  readLatestDatasetReviewSessionId,
  writeLatestDatasetReviewSessionId,
} from "@/shared/config/datasetReviewRoutes";
import {
  buildUrdfOpsBrowserUrl,
  URDF_OPS_TABS,
} from "@/shared/config/urdfOpsRoutes";
import { useDatasetActions } from "@/features/dataset";
import {
  buildDatasetReviewSnapshot,
  writeDatasetReviewSnapshot,
} from "@/features/dataset/datasetReviewSnapshot";
import { toast } from "sonner";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  applyUrdfCameraToThreeViewQuaternion,
  autoComputeCameraPoseDefault,
  remapCameraPoseBetweenParentLinks,
  remapCameraPoseToParentJointFrame,
  resolveCameraParentLinkNameFromJoint,
  getUrdfCameraToThreeViewEuler,
  resolveCameraParentJointNameFromLink,
  useCameraPanels,
} from "@/features/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import type { FileWithPath } from "@/shared/types/file";
import type { URDFRobot } from "urdf-loader";
import { useUrdfEditHandlers } from "@/features/layout/page/useUrdfEditHandlers";
import { useUrdfUtilityHandlers } from "@/features/layout/page/useUrdfUtilityHandlers";
import { useDatasetPlaybackHandlers } from "@/features/layout/page/useDatasetPlaybackHandlers";
import { useUrdfMaterialHandlers } from "@/features/layout/page/useUrdfMaterialHandlers";
import { PageLayout, type PageLayoutProps } from "@/features/layout/page/PageLayout";
import type { CollaborationInviteAction } from "@/features/layout/page/top-nav/types";
import { createDefaultDatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import type { IkAppliedMetadata } from "@/features/viewer/useIkSolver";
import { emitStudioKinematicTeleopSample } from "@/features/teleop/recording/studioKinematicTeleopEvents";
import { useOperatorLeaderTeleopStore } from "@/features/teleop/operator-control/operatorLeaderTeleopStore";
import type { RotationAxis, UrdfViewMode, AngleUnit } from "@/shared/types/feature";
import { useUrdfLoader } from "@/features/urdf/loader/useUrdfLoader";
import { useUrdfSelection } from "@/features/urdf/selection";
import { useObjectCreatorStore, useObjectStore } from "@/features/objects";
import { useLayout } from "@/features/layout";
import { useExportHandlers, useJointMappingPersistence } from "@/features/dataset/exports";
import { useThemeAndGPUMode } from "@/features/theme";
import { useWorkspaceController } from "@/features/workspace/useWorkspaceController";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { resolveFeatureGateAvailability } from "@/shared/lib/featureGateUi";
import { DEMO_MODE } from "@/shared/config/demo";
import {
  isRunRuntimeDemoScanMessage,
  isSetRuntimeDemoSpeedMessage,
  isSetRuntimeDemoTrajectoryMessage,
  RUNTIME_POSE_SAMPLE_MESSAGE_TYPE,
  SELECT_RUNTIME_OBJECT_MESSAGE_TYPE,
} from "@/shared/contracts/previewBridge";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { useGitHubSourceStore } from "@/shared/store/useGitHubSourceStore";
import { useButterClawRuntimeObjects } from "@/studio_ui/runtimeviz/useButterClawRuntimeObjects";
import { useAssemblyStore } from "@/features/assembly/store/useAssemblyStore";
import { useAssemblyPlacementStore } from "@/features/assembly/store/useAssemblyPlacementStore";
import { useIkConfigSync } from "@/features/ik/useIkConfigSync";
import { useIkdRuntimeAuto } from "@/features/ik/useIkdRuntimeAuto";
import { useIkRegistrySync } from "@/features/ik/useIkRegistrySync";
import { useIkSolverStore } from "@/features/ik/useIkSolverStore";
import {
  buildAssemblyUrdf,
  createAssemblySpec,
  validateAssemblySpec,
} from "@/shared/lib/urdfCore";
import { normalizeMeshPathForMatch, resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import { validateInertiaTensor } from "@/features/viewer/inertialMath";
import { isWorldHubConfigured } from "@/shared/config/worldHub";
import {
  DEFAULT_RECORDING_VIEW_HEIGHT,
  MIN_CAMERAS_PANEL_HEIGHT,
  MIN_EPISODES_PANEL_HEIGHT,
  TOP_NAV_HEIGHT,
} from "@/features/layout/page/constants";
import { useButterClawRuntimePose } from "@/studio_ui/runtimeviz/useButterClawRuntimePose";
import { ROBOT_NAME_PATTERN, parseRobotNameFromUrdf } from "@/app/pages/index/indexPageHelpers";
import { useIndexPageParams } from "@/app/pages/index/useIndexPageParams";
import { useAssemblyWorkspaceState } from "@/app/pages/index/useAssemblyWorkspaceState";
import { useWorldSceneManager, downloadTextDocument } from "@/app/pages/index/useWorldSceneManager";
import { useCameraRuntimeOrchestration } from "@/app/pages/index/useCameraRuntimeOrchestration";
import { useIluSessionBridge } from "@/app/pages/index/useIluSessionBridge";
import { useIluAssemblyBridge } from "@/app/pages/index/useIluAssemblyBridge";
import { useIndexPageLayoutProps } from "@/app/pages/index/useIndexPageLayoutProps";
import { useIndexViewerProps } from "@/app/pages/index/useIndexViewerProps";
import { resolveViewerDraftPreview } from "@/app/pages/index/viewerDraftPreview";
import {
  FolderUploadScreen,
  IkDebuggerPanel,
  OperatorTeleopPanelShell,
  WorldPublishDialog,
  WorldRegistryPanel,
  WorldRolloutReviewPanel,
} from "@/app/pages/index/indexPageLazyComponents";
import { WorldSceneImportDialog } from "@/features/world-share/WorldSceneImportDialog";
import {
  buildMeshFilesCacheKey,
  buildPackageRootsCacheKey,
  collectSynthesizedPhysicsLinkNames,
  formatSignedAxisLabel,
  useInitialCollaborationSession,
  useRepeatedInertiaSymmetryLinkCentersLocal,
  useStudioIssueReportUrl,
  type CanonicalSynthesisPreviewSession,
  type CollaborationToastId,
  type FramePreflightSession,
  type InertialSynthesisSession,
  type OperatorTeleopPanelView,
  type PhysicsActionRequest,
  type PhysicsPreflightSession,
  type PrepareCollaborationInviteLinkParams,
  type RepeatedInertiaGroupActionState,
  type RepeatedInertiaGroupOutcome,
  type RepeatedInertiaSymmetryOutcome,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  createDefaultInertialVisualizationSettings,
  createEmptyRobotMirrorVisualizationState,
  buildRobotMirrorSymmetryVisualizationScopeKey,
  buildRepeatedInertiaVisualizationScopeKey,
  buildRepeatedInertiaSymmetryFamilyOutcomeKey,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
  mergeDisplayedRepeatedInertiaSymmetryChains,
  resolveRobotMirrorVisualizationState,
  resolveActiveSimulationPrepRobotMirrorVisualization,
  resolveActiveSimulationPrepSymmetryVisualization,
  resolveSimulationPrepVisualizationScope,
  syncSimulationPrepInertiaVisualizationScope,
  type RobotMirrorVisualizationState,
  type SimulationPrepVisualizationPreview,
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
  withSimulationPrepInertiaVisualization,
} from "@/features/layout/page/simulationPrepViewerState";
import { IndexModeGate } from "@/app/pages/index/IndexModeGate";
import { useIluCalibrationFocus } from "@/app/pages/index/useIluCalibrationFocus";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import {
  describeCollaborationLinkAccess,
} from "@/features/collaboration/collaborationTransport";
import { useUrdfCollaboration } from "@/features/collaboration/useUrdfCollaboration";
import type { CollaborationLinkAccess } from "@/features/collaboration/collaborationTypes";
import { resolveSubstitutionReplacement } from "@/features/dataset/substitutionApply";
import { applySubstitutionSubtree } from "@/features/dataset/substitutionSubtree";
import {
  buildOrientationStatus,
  buildOrientationReviewSummary,
  getActionableOrientationSuggestion,
} from "@/shared/lib/orientationReview";
import {
  buildRobotFramePolicySummary,
  type RobotFrameLintResult,
} from "@/features/urdf/lint/robotFrameLinter";
import {
  buildUrdfBakePreviewStats,
  buildVirtualBakePreview,
  type UrdfBakePreviewSession,
} from "@/features/urdf/bake/virtualBake";
import {
  captureKinematicState,
} from "@/features/urdf/synthesis/kinematicSynthesizer";
import {
  buildInertialAuditSummary,
  buildInertialMassDeltaSummary,
  buildInertialSynthesisSummary,
  type InertialAuditSummary,
  type InertialMassDeltaSummary,
  type InertialRepairMode,
  type InertialSynthesisResult,
} from "@/features/urdf/inertia/inertialSynthesis";
import {
  INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
  type InertialDensityPresetId,
} from "@/features/urdf/inertia/inertialSynthesisParams";
import {
  executeCanonicalSynthesisViaBackend,
  framePreflightViaBackend,
  generatePhysicsDraftViaBackend,
  generatePhysicsPreflightViaBackend,
} from "@/features/urdf/inertia/robotMasteringApi";
import {
  applyRepeatedInertiaGroupManualFix,
  REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR,
} from "@/features/urdf/inertia/repeatedInertiaManualFix";
import { ROBOT_MASTERING_PREFLIGHT_DEBOUNCE_MS } from "@/features/urdf/inertia/robotMasteringApiParams";
import {
  buildSimulationPrepUpdateToastPlan,
  buildSimulationPrepChecklistRefreshMessage,
  buildSimulationPrepPhysicsActionStatusMap,
  buildSimulationPrepDraftFingerprint,
  buildPhysicsDraftSummaryText,
  buildPhysicsIssueSummary,
  buildSimulationPrepStatus,
  canQueueSimulationPrepPhysicsAction,
  resolveSimulationPrepPreflightRequestDecision,
  resolveSimulationPrepPhysicsSourceContent,
  resolveSimulationPrepChecklistRefreshStatus,
  type SimulationPrepChecklistRefreshResult,
  type SimulationPrepPhysicsActionKey,
} from "@/features/layout/page/simulationPrepState";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  buildRepeatedInertiaSymmetryChainKey,
  buildRepeatedInertiaSymmetryChains,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import { buildRobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  applyRobotMirrorParallelFix,
  applyRobotMirrorSymmetryFix,
  resolveRobotMirrorActionableSelection,
  type RobotMirrorFixMode,
  type RobotMirrorFixAvailability,
  type RobotMirrorOutcome,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import { buildRobotMirrorSelectionLinks } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { collectRobotMirrorPlaneTouchingLinkNamesFromRobot } from "@/features/layout/page/robotMirrorSymmetryVisualization";
import {
  REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE,
  type RepeatedInertiaSymmetryCenterMode,
} from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import { applyRepeatedInertiaSymmetryFix } from "@/features/layout/page/repeatedInertiaSymmetryFix";
import type { InertiaReliabilityEntry } from "@/features/viewer/InertialVisualization";

const Index = () => {
  const navigate = useNavigate();
  useIkConfigSync({ enabled: FEATURE_GATES.ikRemoteSolve.enabled });
  useIkRegistrySync({ enabled: FEATURE_GATES.ikRemoteSolve.enabled });
  const selectedIkSolverId = useIkSolverStore((state) => state.selectedSolverId);
  useIkdRuntimeAuto({ selectedSolverId: selectedIkSolverId });
  const availableIkSolvers = useIkSolverStore((state) => state.availableSolvers);
  const setSelectedIkSolverId = useIkSolverStore((state) => state.setSelectedSolverId);
  const { gpuMode, setGPUMode } = useThemeAndGPUMode();
  const workspaceController = useWorkspaceController();
  const workspaceMode = workspaceController.mode;
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  const isAssemblyWorkspace = workspaceModeUi.isAssembly;
  const {
    hasExplicitWorldImport,
    iluAssemblyParam,
    iluCalibrateParam,
    iluFocusJointParam,
    iluSessionParam,
    thumbnailParams,
    worldImportParams,
  } = useIndexPageParams();
  const initialCollaborationSession = useInitialCollaborationSession();
  const hasExplicitWorldLayoutImport = worldImportParams.worldLayoutImportUrl.trim().length > 0;
  const skipDefaultWorldLayoutAutoImportRef = useRef(false);
  const thumbnailMode = thumbnailParams.enabled;
  const runtimePreviewMode = thumbnailParams.preview;
  useButterClawRuntimeObjects({
    enabled: runtimePreviewMode,
    demoMode: runtimePreviewMode && thumbnailParams.runtimeDemo,
  });
  const runtimeRobotBasePose = useButterClawRuntimePose({
    enabled: runtimePreviewMode && !thumbnailParams.runtimeDemo,
  });
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const addCamera = useCameraStore((state) => state.addCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const updateCamera = useCameraStore((state) => state.updateCamera);
  const clearCameras = useCameraStore((state) => state.clearCameras);
  const addObject = useObjectStore((state) => state.addObject);
  const clearObjects = useObjectStore((state) => state.clearObjects);
  const objects = useObjectStore((state) => state.objects);
  const removeObject = useObjectStore((state) => state.removeObject);
  const updateTrackedJoint = useObjectStore((state) => state.updateTrackedJoint);
  const githubSource = useGitHubSourceStore((state) => state.source);
  const setGitHubSource = useGitHubSourceStore((state) => state.setSource);
  const clearGitHubSource = useGitHubSourceStore((state) => state.clearSource);
  const {
    selectedJoint,
    setSelectedJoint,
    selectedLink,
    setSelectedLink,
    hoveredJoint,
    setHoveredJoint,
    hoveredLink,
    setHoveredLink,
    endEffectorLink,
    setEndEffectorLink,
    endEffectorCandidates,
    deletedJoints,
    toggleDeletedJoint,
    jointValues,
    setJointValue: setStoreJointValue,
    setJointValues,
    clearSelection,
    setContext: setSelectionContext,
  } = useUrdfSelection();
  const [availableJoints, setAvailableJoints] = useState<string[]>([]);
  const {
    urdfFile,
    activeUrdfPath,
    urdfDocuments,
    urdfBasePath,
    packageRoots,
    meshFiles,
    isLoading,
    hasLoadedFiles,
    urdfAnalysis,
    jointLimits,
    jointAxes,
    originalJointAxes,
    availableLinks,
    originalUrdfContent,
    vizUrdfContent,
    originalVizUrdfContent,
    savedVizUrdfContent,
    debugMeshInfo,
    unmatchedURDFRefs,
    absoluteFileMeshRefs,
    missingPackageRefs,
    urdfValidationError,
    showLoadIssues,
    urdfLoadRevision,
    setShowLoadIssues,
    setSavedVizUrdfContent,
    setOriginalVizUrdfContent,
    setJointLimits,
    setJointAxes,
    setOriginalJointAxes,
    setVizUrdfContent,
    setUrdfFile,
    createUrdfFile,
    updateUrdfFile,
    resetLoadedUrdf,
    loadUrdfText,
    loadFilesFromFolder,
    hydrateLoadedAssetsFromFiles,
    addMeshFilesFromFiles,
  } = useUrdfLoader({
    onClearSelection: clearSelection,
    onAutoSelectEndEffector: setEndEffectorLink,
  });
  const loadFilesFromFolderWithFreshCameras = useCallback(
    async (fileList: FileList, options?: { preserveCameras?: boolean }) => {
      if (!options?.preserveCameras) {
        clearCameras();
      }
      await loadFilesFromFolder(fileList);
    },
    [clearCameras, loadFilesFromFolder]
  );
  const loadDemoUrdfTextWithFreshCameras = useCallback(
    (content: string, options?: Parameters<typeof loadUrdfText>[1]) => {
      clearCameras();
      loadUrdfText(content, options);
    },
    [clearCameras, loadUrdfText]
  );
  const [urdfContentVersion, setUrdfContentVersion] = useState<number>(0);
  const markUrdfContentReloaded = useCallback(
    () => setUrdfContentVersion((prev) => prev + 1),
    []
  );
  const [collaborationInviteAction, setCollaborationInviteAction] =
    useState<CollaborationInviteAction | null>(null);
  const collaborationInviteActionRef =
    useRef<CollaborationInviteAction | null>(null);
  const {
    collaborationOwner,
    collaborationOwnerToken,
    collaborationPeerCount,
    collaborationSharingEnabled,
    collaborationSessionId,
    collaborationStatus,
    collaborationTeleopCapabilityToken,
    createShareLink: createCollaborationShareLink,
    rotateShareLink: rotateCollaborationShareLink,
    setCollaborationSharingEnabled,
    updateUrdfFileWithCollaboration,
  } = useUrdfCollaboration({
    activeUrdfPath,
    hasLoadedFiles,
    initialSession: initialCollaborationSession,
    loadUrdfText,
    markUrdfContentReloaded,
    updateUrdfFile,
    urdfBasePath,
    urdfFileName: urdfFile?.name,
    vizUrdfContent,
  });
  const { isAttachingIluSession } = useIluSessionBridge({
    clearGitHubSource,
    hydrateLoadedAssetsFromFiles,
    iluSessionParam,
    loadUrdfText,
    markUrdfContentReloaded,
    setOriginalVizUrdfContent,
    setSavedVizUrdfContent,
    setGitHubSource,
    updateUrdfFile,
    vizUrdfContent,
  });
  const assemblySelectedRobots = useAssemblyStore((state) => state.selectedRobots);
  const duplicateAssemblyRobot = useAssemblyStore((state) => state.duplicateRobot);
  const setAssemblySelectedUrdfPaths = useAssemblyStore((state) => state.setSelectedUrdfPaths);
  const assemblyContactPairs = useAssemblyPlacementStore((state) => state.contactPairs);
  const assemblyPoses = useAssemblyPlacementStore((state) => state.poses);
  const clearAssemblySelection = useAssemblyStore((state) => state.clear);
  const clearAssemblyPlacement = useAssemblyPlacementStore((state) => state.clear);
  const {
    assemblyHasPhysicalContact,
    assemblyInspector,
    assemblyIssueReportUrl,
    assemblyPrimaryModel,
    assemblyProposalRequested,
    assemblySecondaryModels,
    substitutionSession,
    requestAssemblyProposal,
  } = useAssemblyWorkspaceState({
    activeUrdfPath,
    assemblyContactPairs,
    assemblyPoses,
    assemblySelectedRobots,
    clearAssemblyPlacement,
    clearAssemblySelection,
    isAssemblyWorkspace,
    packageRoots,
    urdfDocuments,
    vizUrdfContent,
  });
  const { isAttachingIluAssembly } = useIluAssemblyBridge({
    iluAssemblyParam,
    loadFilesFromFolder: loadFilesFromFolderWithFreshCameras,
    clearGitHubSource,
    clearAssemblySelection,
    clearAssemblyPlacement,
    setAssemblySelectedUrdfPaths,
    onWorkspaceModeChange: workspaceController.setMode,
  });
  const handleRequestAssemblyProposal = useCallback(() => {
    if (!assemblyHasPhysicalContact) {
      toast.message("No contact detected yet. Generating a heuristic proposal.");
    }
    requestAssemblyProposal();
  }, [assemblyHasPhysicalContact, requestAssemblyProposal]);
  const studioIssueReportUrl = useStudioIssueReportUrl({
    enabled: workspaceModeUi.showStudioIssueReport,
    urdfFileName: urdfFile?.name,
    workspaceMode,
  });
  const playbackHandlers = useViewerPlaybackStore((state) => state.handlers);
  const { datasetActions, handleDatasetActionsReady } = useDatasetActions();
  const datasetReviewSessionId = datasetActions?.datasetSessionSummary?.session_id ?? null;
  const datasetReviewSnapshot = useMemo(
    () => buildDatasetReviewSnapshot(datasetActions?.episodes ?? []),
    [datasetActions?.episodes]
  );
  useEffect(() => {
    writeDatasetReviewSnapshot(datasetReviewSnapshot);
    if (datasetReviewSessionId) {
      writeLatestDatasetReviewSessionId(datasetReviewSessionId);
      return;
    }
    if (
      !datasetReviewSnapshot &&
      (!datasetActions?.hasEpisodes || datasetActions.datasetSessionStatus !== "syncing")
    ) {
      writeLatestDatasetReviewSessionId(null);
    }
  }, [
    datasetActions?.datasetSessionStatus,
    datasetActions?.hasEpisodes,
    datasetReviewSessionId,
    datasetReviewSnapshot,
  ]);
  const [inertiaReliability, setInertiaReliability] = useState<InertiaReliabilityEntry[]>([]);
  const [activeInertiaVisualizationScopeKey, setActiveInertiaVisualizationScopeKey] = useState<string | null>(null);
  const [hoveredInertiaVisualizationPreview, setHoveredInertiaVisualizationPreview] =
    useState<SimulationPrepVisualizationPreview | null>(null);
  const [repeatedInertiaSymmetryCenterMode, setRepeatedInertiaSymmetryCenterMode] =
    useState<RepeatedInertiaSymmetryCenterMode>(
      REPEATED_INERTIA_SYMMETRY_DEFAULT_CENTER_MODE
    );
  const [repeatedInertiaSymmetryActingChainKey, setRepeatedInertiaSymmetryActingChainKey] =
    useState<string | null>(null);
  const [repeatedInertiaSymmetryActingProgress, setRepeatedInertiaSymmetryActingProgress] =
    useState<{
      chainKey: string;
      appliedStepCount: number;
      totalStepCount: number;
    } | null>(null);
  const [pinnedRepeatedInertiaSymmetryChains, setPinnedRepeatedInertiaSymmetryChains] = useState<
    RepeatedInertiaSymmetryChain[]
  >([]);
  const [repeatedInertiaSymmetryOutcomeByChainKey, setRepeatedInertiaSymmetryOutcomeByChainKey] =
    useState<Record<string, RepeatedInertiaSymmetryOutcome>>({});
  const [repeatedInertiaGroupAction, setRepeatedInertiaGroupAction] =
    useState<RepeatedInertiaGroupActionState | null>(null);
  const [repeatedInertiaResolvedGroupKeys, setRepeatedInertiaResolvedGroupKeys] = useState<string[]>(
    []
  );
  const [selectedRobotMirrorLinkNames, setSelectedRobotMirrorLinkNames] = useState<string[]>([]);
  const [isRobotMirrorActing, setIsRobotMirrorActing] = useState(false);
  const [activeRobotMirrorAction, setActiveRobotMirrorAction] = useState<RobotMirrorFixMode | null>(
    null
  );
  const [robotMirrorOutcome, setRobotMirrorOutcome] = useState<RobotMirrorOutcome | null>(null);
  const [robotMirrorFixAvailability, setRobotMirrorFixAvailability] = useState<{
    isLoading: boolean;
    value: RobotMirrorFixAvailability;
  }>({
    isLoading: false,
    value: {
      centerOnlyActionableTargetCount: 0,
      centerOnlyAvailable: false,
      orientationOnlyActionableTargetCount: 0,
      orientationOnlyAvailable: false,
    },
  });
  const [robotMirrorVisualizationState, setRobotMirrorVisualizationState] =
    useState<RobotMirrorVisualizationState>(createEmptyRobotMirrorVisualizationState());
  const [repeatedInertiaOutcomeByGroupKey, setRepeatedInertiaOutcomeByGroupKey] = useState<
    Record<string, RepeatedInertiaGroupOutcome>
  >({});
  const {
    isPlaying,
    setIsPlaying,
    hasAnimationFrames,
    setHasAnimationFrames,
    currentFrame,
    setCurrentFrame,
    totalFrames,
    rotationPlaneVisible,
    setRotationPlaneVisible,
    collisionsVisible,
    setCollisionsVisible,
    collisionSimplifyLinks,
    setCollisionSimplifyLinks,
    collisionMergedLinks,
    setCollisionMergedLinks,
    collisionVisibility,
    setCollisionVisibility,
    viewerSplitView,
    setViewerSplitView,
    inertialVisualization,
    setInertialVisualization,
    handleMotionDataUpload,
    handlePlayAnimation,
    handleFrameChange,
    motionDataFile,
    setMotionDataFile,
    viewerEpisode,
    setViewerEpisode,
    isViewerOpen,
    setIsViewerOpen,
    episodeSaveHandler,
    handleEpisodeSaveHandlerChange,
    episodeJointNames,
  } = useDatasetPlaybackHandlers();
  const {
    sidebarWidth,
    setSidebarWidth,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    rightSidebarWidth,
    setRightSidebarWidth,
    isRightSidebarCollapsed,
    recordingViewHeight,
    handleSidebarToggle,
    handleRightSidebarToggle,
    handleSidebarResizeStart,
    handleRightSidebarResizeStart,
    handleViewerResizeStart,
  } = useLayout();
  const [sidebarEpisodesViewHeight, setSidebarEpisodesViewHeight] = useState(
    DEFAULT_RECORDING_VIEW_HEIGHT
  );
  const clampSidebarEpisodesViewHeight = useCallback(
    (height: number, containerHeight: number) => {
      if (!Number.isFinite(height)) {
        return DEFAULT_RECORDING_VIEW_HEIGHT;
      }
      if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
        return Math.min(0.95, Math.max(0.05, height));
      }
      const minBottomRatio = Math.min(0.95, MIN_CAMERAS_PANEL_HEIGHT / containerHeight);
      const maxBottomRatioFromTop = 1 - MIN_EPISODES_PANEL_HEIGHT / containerHeight;
      const maxBottomRatio = Math.max(minBottomRatio, Math.min(0.95, maxBottomRatioFromTop));
      return Math.min(maxBottomRatio, Math.max(minBottomRatio, height));
    },
    []
  );
  const [showUrdfEditor, setShowUrdfEditor] = useState(false);
  const [urdfViewMode, setUrdfViewMode] = useState<UrdfViewMode>("split");
  const [runningPhysicsActionKey, setRunningPhysicsActionKey] =
    useState<SimulationPrepPhysicsActionKey | null>(null);
  const [queuedPhysicsActions, setQueuedPhysicsActions] = useState<PhysicsActionRequest[]>([]);
  const hasSimulationPrepFixActionInFlight = useMemo(
    () =>
      runningPhysicsActionKey !== null ||
      queuedPhysicsActions.length > 0 ||
      repeatedInertiaGroupAction !== null ||
      repeatedInertiaSymmetryActingChainKey !== null ||
      isRobotMirrorActing,
    [
      isRobotMirrorActing,
      queuedPhysicsActions.length,
      repeatedInertiaGroupAction,
      repeatedInertiaSymmetryActingChainKey,
      runningPhysicsActionKey,
    ]
  );
  const [rotationAxis, setRotationAxis] = useState<RotationAxis>("z");
  const [urdfEditorSplitView, setUrdfEditorSplitView] = useState(false);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>("rad");
  const [isIkPanelOpen, setIsIkPanelOpen] = useState(false);
  const [teleopPanelView, setTeleopPanelView] =
    useState<OperatorTeleopPanelView>("hardware");
  const [teleopPanelMounted, setTeleopPanelMounted] = useState(false);
  const [teleopPanelOpen, setTeleopPanelOpen] = useState(false);
  const leaderInputConnected = useOperatorLeaderTeleopStore(
    (state) => state.connected,
  );
  const followerHardwareConnected = useOperatorLeaderTeleopStore(
    (state) => state.followerHardwareConnected,
  );
  const closeTeleopPanel = useCallback(() => {
    setTeleopPanelOpen(false);
    setTeleopPanelMounted((mounted) => mounted && teleopPanelView !== "camera");
  }, [teleopPanelView]);
  const toggleTeleopPanelView = useCallback(
    (view: OperatorTeleopPanelView) => {
      if (teleopPanelOpen && teleopPanelView === view) {
        setTeleopPanelOpen(false);
        setTeleopPanelMounted(view !== "camera");
        return;
      }
      setTeleopPanelMounted(true);
      setTeleopPanelView(view);
      setTeleopPanelOpen(true);
    },
    [teleopPanelOpen, teleopPanelView],
  );
  const [bakePreviewSession, setBakePreviewSession] = useState<UrdfBakePreviewSession | null>(null);
  const [canonicalSynthesisPreview, setCanonicalSynthesisPreview] =
    useState<CanonicalSynthesisPreviewSession | null>(null);
  const [inertialSynthesisSession, setInertialSynthesisSession] =
    useState<InertialSynthesisSession | null>(null);
  const [framePreflightSession, setFramePreflightSession] =
    useState<FramePreflightSession | null>(null);
  const [isFramePreflightLoading, setIsFramePreflightLoading] = useState(false);
  const framePreflightRequestIdRef = useRef(0);
  const framePreflightRequestedSourceRef = useRef<string | null>(null);
  const [physicsPreflightSession, setPhysicsPreflightSession] =
    useState<PhysicsPreflightSession | null>(null);
  const [isPhysicsPreflightLoading, setIsPhysicsPreflightLoading] = useState(false);
  const physicsPreflightRequestIdRef = useRef(0);
  const physicsPreflightRequestedSourceRef = useRef<string | null>(null);
  const [showHealthActionPanel, setShowHealthActionPanel] = useState(false);
  const [simulationPrepResetPoseRequestKey, setSimulationPrepResetPoseRequestKey] = useState<
    string | null
  >(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const lastEpisodesResizePointerDownRef = useRef<{ t: number; y: number } | null>(null);
  const {
    isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    handleSave,
    handleRevert,
    canRevert,
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  } = useExportHandlers({
    vizUrdfContent,
    savedVizUrdfContent,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    setSavedVizUrdfContent,
    cameras,
  });
  const {
    mappingDialogData,
    selectedMapping,
    showMappingDialog,
    showMappingListPanel,
    savedMappings,
    openMappingList,
    closeMappingList,
    selectMapping,
    deleteMappingById,
    applyMapping,
    closeMappingDialog,
  } = useJointMappingPersistence();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reclampEpisodesSplit = () => {
      const container = document.querySelector<HTMLElement>(".sidebar-panel");
      if (!container) return;
      setSidebarEpisodesViewHeight((current) =>
        clampSidebarEpisodesViewHeight(current, container.clientHeight)
      );
    };

    reclampEpisodesSplit();
    window.addEventListener("resize", reclampEpisodesSplit);
    return () => window.removeEventListener("resize", reclampEpisodesSplit);
  }, [clampSidebarEpisodesViewHeight, isSidebarCollapsed]);

  // Object creation state
  const {
    isOpen: objectCreatorOpen,
    type: objectCreatorType,
    open: openObjectCreator,
    close: closeObjectCreator,
    robotBoundingBox,
    setRobotBoundingBox,
  } = useObjectCreatorStore();
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const repeatedInertiaSymmetryLinkCentersLocal = useRepeatedInertiaSymmetryLinkCentersLocal(robot);
  const resolvedRobotName = useMemo(
    () => parseRobotNameFromUrdf(vizUrdfContent || originalUrdfContent),
    [vizUrdfContent, originalUrdfContent]
  );
  const {
    activeWorldSnapshotRef,
    handleExportCurrentWorldSceneLayer,
    handleExportCurrentWorldScenePackage,
    handleImportDefaultWorldLayoutFromDialog,
    handleImportWorldLayoutFromEntry,
    handleImportWorldLayoutFromLinkDialog,
    handleImportWorldLayoutFromUrl,
    handleImportWorldScenePackage,
    handleExportWorldRolloutCampaign,
    handleImportWorldRolloutResults,
    handleListWorldScenePackages,
    handleLoadGeneratedWorldScenePackage,
    handleLoadWorldScenePackageFromRegistry,
    handleOpenWorldHubBrowser,
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
    handlePublishGeneratedWorldScenePackage,
    handleRunLocalWorldRollout,
    handleSubmitWorldPublishDialog,
    handleValidateCurrentWorldScenePackage,
    isImportingWorldLayout,
    isPublishingWorldPackage,
    publishTargetLabel,
    refreshWorldRegistry,
    setIsImportingWorldLayout,
    setWorldLayoutImportDialogOpen,
    setWorldLayoutImportUrlDraft,
    setWorldPublishDialogOpen,
    setWorldPublishDraft,
    setWorldRolloutReviewOpen,
    setWorldRegistryFilterText,
    setWorldRegistryOpen,
    worldRolloutReview,
    worldRolloutReviewOpen,
    worldLayoutImportDialogOpen,
    worldLayoutImportUrlDraft,
    worldPublishDialogOpen,
    worldPublishDraft,
    worldRegistryEntries,
    worldRegistryFilterText,
    worldRegistryLoading,
    worldRegistryOpen,
  } = useWorldSceneManager({
    addCamera,
    addObject,
    cameras,
    clearCameras,
    clearObjects,
    hasExplicitWorldImport,
    hasExplicitWorldLayoutImport,
    hasLoadedFiles,
    jointValues,
    objects,
    originalUrdfContent,
    resolvedRobotName,
    skipDefaultWorldLayoutAutoImportRef,
    setJointValues,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    vizUrdfContent,
    worldImportParams,
  });
  const {
    effectiveRuntimePose,
    handleImportDemoWorldLayoutFromDialog,
    handlePlayDemoMotion,
    runtimePreviewLoadError,
  } = useCameraRuntimeOrchestration({
    activeUrdfPath,
    addCamera,
    addObject,
    availableJoints,
    availableLinks,
    cameras,
    datasetActions,
    endEffectorLink,
    hasLoadedFiles,
    hydrateDemoAssetsFromFiles: hydrateLoadedAssetsFromFiles,
    jointLimits,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
    playbackHandlers,
    removeCamera,
    removeObject,
    robot,
    robotBoundingBox,
    runtimePreviewMode,
    runtimeRobotBasePose,
    setGPUMode,
    setIsImportingWorldLayout,
    setIsViewerOpen,
    setViewerEpisode,
    setWorldLayoutImportDialogOpen,
    setWorldLayoutImportUrlDraft,
    skipDefaultWorldLayoutAutoImportRef,
    thumbnailMode,
    thumbnailParams,
    updateCamera,
    updateTrackedJoint,
    urdfAnalysis,
    urdfFileName: urdfFile?.name,
    vizUrdfContent,
    originalUrdfContent,
  });

  const handleExportAssemblyUrdf = useCallback(() => {
    if (isAssemblyWorkspace && !assemblyHasPhysicalContact) {
      toast.error("Assembly export requires at least one physical robot contact.");
      return;
    }
    const normalizedActivePath =
      activeUrdfPath && activeUrdfPath.length > 0
        ? normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath
        : null;
    const modelsFromSelection = assemblySelectedRobots
      .map((robot) => {
        const normalizedPath = normalizeMeshPathForMatch(robot.urdfPath) || robot.urdfPath;
        const content =
          urdfDocuments[normalizedPath] ||
          (normalizedActivePath && normalizedPath === normalizedActivePath ? vizUrdfContent : "");
        if (!content.trim()) return null;
        return {
          id: robot.instanceId,
          name: robot.name,
          urdfContent: content,
        };
      })
      .filter((model): model is { id: string; name: string; urdfContent: string } => Boolean(model));

    const models =
      modelsFromSelection.length > 0
        ? modelsFromSelection
        : vizUrdfContent.trim().length > 0
          ? [
              {
                id: "primary_robot",
                name: urdfFile?.name.replace(/^viz-/, "") || "primary.urdf",
                urdfContent: vizUrdfContent,
              },
            ]
          : [];

    if (models.length === 0) {
      toast.error("No assembly robots available for export.");
      return;
    }

    try {
      const spec = createAssemblySpec(
        models.map((model) => ({
          ...model,
          isPrimary: assemblySelectedRobots.some(
            (robot) => robot.instanceId === model.id && robot.isPrimary
          ),
        })),
        {
          robotName: "assembled_robot",
          poses: assemblyPoses,
          primaryRobotId:
            assemblySelectedRobots.find((robot) => robot.isPrimary)?.instanceId ||
            assemblySelectedRobots[0]?.instanceId ||
            null,
        }
      );
      const validation = validateAssemblySpec(spec);
      if (!validation.isValid) {
        toast.error(validation.errors[0] || "Assembly export is invalid.");
        return;
      }
      const urdf = buildAssemblyUrdf(spec);
      downloadTextDocument(urdf, "assembled_robot.urdf", "application/xml");
      toast.success(`Exported assembly URDF (${models.length} robot${models.length > 1 ? "s" : ""})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export assembly URDF");
    }
  }, [
    activeUrdfPath,
    assemblyHasPhysicalContact,
    assemblyPoses,
    assemblySelectedRobots,
    isAssemblyWorkspace,
    urdfFile?.name,
    urdfDocuments,
    vizUrdfContent,
  ]);
  const handleDuplicateAssemblyRobot = useCallback(
    (instanceId: string) => {
      duplicateAssemblyRobot(instanceId);
      toast.success("Duplicated robot instance in assembly.");
    },
    [duplicateAssemblyRobot]
  );
  const handleApplySubstitution = useCallback((hostRootLink: string, replacementRootLink: string) => {
    if (!substitutionSession) {
      toast.error("Substitution session is not active.");
      return;
    }
    if (!hostRootLink || !replacementRootLink) {
      toast.error("Choose both a host target link and a replacement root link.");
      return;
    }

    try {
      const {
        hostFilename,
        nextUrdfDocuments,
        replacementContent,
      } = resolveSubstitutionReplacement({
        hostUrdfPath: substitutionSession.hostUrdfPath,
        replacementUrdfPath: substitutionSession.replacementUrdfPath,
        activeUrdfPath,
        urdfDocuments,
        vizUrdfContent,
      });
      const nextHostUrdf = applySubstitutionSubtree({
        hostUrdfContent: substitutionSession.hostUrdfContent,
        replacementUrdfContent: replacementContent,
        hostRootLink,
        replacementRootLink,
        replacementUrdfPath: substitutionSession.replacementUrdfPath,
        packageRoots: substitutionSession.packageRoots,
      });
      loadUrdfText(nextHostUrdf.urdfContent, {
        filename: hostFilename,
        activePath: substitutionSession.hostUrdfPath,
        urdfDocuments: {
          ...nextUrdfDocuments,
          [substitutionSession.hostUrdfPath]: nextHostUrdf.urdfContent,
        },
        meshFiles,
        packageRoots,
      });
      clearAssemblySelection();
      clearAssemblyPlacement();
      workspaceController.setMode("studio");
      toast.success(
        `Replaced ${hostRootLink} on ${substitutionSession.hostRobotName} with ${replacementRootLink} from ${substitutionSession.replacementRobotName}.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply substitution.");
    }
  }, [
    activeUrdfPath,
    clearAssemblyPlacement,
    clearAssemblySelection,
    loadUrdfText,
    meshFiles,
    packageRoots,
    substitutionSession,
    urdfDocuments,
    vizUrdfContent,
    workspaceController,
  ]);
  // Camera creation state
  const {
    showCameraCreator,
    setShowCameraCreator,
    showCameraUpload,
    setShowCameraUpload,
    showPovCameras,
    setShowPovCameras,
  } = useCameraPanels();

  const defaultConstraintSettings = useMemo(
    () => createDefaultDatasetConstraintSettings(),
    []
  );

  // Keep selection context in sync for auto end-effector selection and validity checks
  useEffect(() => {
    setSelectionContext({ vizUrdfContent, availableLinks, urdfAnalysis });
  }, [vizUrdfContent, availableLinks, urdfAnalysis, setSelectionContext]);

  const handleJointChange = useCallback((jointName: string, value: number) => {
    const timestamp =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    setStoreJointValue(jointName, value, {
      enforceVelocity: false,
      timestamp,
    });
  }, [setStoreJointValue]);

  const handleIkApplied = useCallback((
    values: Record<string, number>,
    metadata?: IkAppliedMetadata,
  ) => {
    const timestamp =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    Object.entries(values).forEach(([jointName, value]) => {
      if (!Number.isFinite(value)) return;
      setStoreJointValue(jointName, value, {
        // IK apply should be immediate; velocity limiting makes camera-attached motion lag.
        enforceVelocity: false,
        timestamp,
      });
    });
    if (metadata) {
      emitStudioKinematicTeleopSample({
        inputSource: metadata.inputSource,
        jointTargets: values,
        sourceTsMs: Date.now(),
      });
    }
  }, [setStoreJointValue]);


  const {
    handleVizUrdfChange,
    handleLinkNameChange,
    handleJointAxisChange,
    handleJointOriginChange,
    handleResetAxis,
    handleJointTypeChange,
    handleJointLimitsChange,
    handleJointVelocityChange,
    handleJointEffortChange,
    handleJointNameChange,
    handleJointLinkChange,
    handleResetRotation,
  } = useUrdfEditHandlers({
    vizUrdfContent,
    originalVizUrdfContent,
    originalJointAxes,
    selectedJoint,
    setSelectedJoint,
    setAvailableJoints,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    setUrdfContentVersion,
  });

  const {
    handleCanonicalOrder,
    handlePrettyPrint,
    handleNormalizeAxes,
    handleAlignOrientation,
    handleFixMeshPaths,
    handleRotateRobot,
    getExportUrdfContent,
    robotName,
    handleDeleteJoint,
  } = useUrdfUtilityHandlers({
    vizUrdfContent,
    deletedJoints,
    toggleDeletedJoint,
    handleVizUrdfChange,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    meshFiles,
    urdfBasePath,
    packageRoots,
    githubSource,
    addMeshFilesFromFiles,
  });

  const orientationCard = framePreflightSession?.orientationCard ?? null;
  const robotFrameLint: RobotFrameLintResult | null = framePreflightSession?.frameLint ?? null;
  const orientationSuggestion = useMemo(
    () => getActionableOrientationSuggestion(orientationCard),
    [orientationCard]
  );
  const orientationNeedsAttention = Boolean(
    orientationSuggestion || (robotFrameLint && robotFrameLint.verdict !== "canonical")
  );
  const orientationSummary = useMemo(() => {
    const orientationReviewSummary = buildOrientationReviewSummary(orientationCard);
    const framePolicySummary = buildRobotFramePolicySummary(robotFrameLint);

    if (!orientationReviewSummary) {
      return framePolicySummary;
    }
    if (!framePolicySummary || robotFrameLint?.verdict === "canonical") {
      return orientationReviewSummary;
    }

    return `${orientationReviewSummary} ${framePolicySummary}`;
  }, [orientationCard, robotFrameLint]);
  const orientationStatus = useMemo(
    () => {
      const status = buildOrientationStatus(orientationCard);
      if (!status) {
        return null;
      }
      return {
        ...status,
        summary: orientationSummary ?? status.summary,
      };
    },
    [orientationCard, orientationSummary]
  );
  const canAlignOrientation = useMemo(
    () => Boolean(orientationSuggestion && robotFrameLint?.rewriteSafe),
    [orientationSuggestion, robotFrameLint]
  );
  const canPreviewBakeVisualTransforms = robotFrameLint?.verdict === "unsafe-to-rewrite";
  const bakePreviewStats = useMemo(
    () => (bakePreviewSession ? buildUrdfBakePreviewStats(bakePreviewSession) : null),
    [bakePreviewSession]
  );
  const inertialAuditSummary = useMemo(() => buildInertialAuditSummary(urdfAnalysis), [urdfAnalysis]);
  const inertialDraftBaseContent = useMemo(
    () => canonicalSynthesisPreview?.draftContent ?? bakePreviewSession?.stagedContent ?? vizUrdfContent,
    [bakePreviewSession?.stagedContent, canonicalSynthesisPreview?.draftContent, vizUrdfContent]
  );
  const physicsGenerationSourceContent = useMemo(
    () =>
      resolveSimulationPrepPhysicsSourceContent({
        stagedDraftContent: inertialSynthesisSession?.draftContent,
        baseContent: inertialDraftBaseContent,
      }),
    [inertialDraftBaseContent, inertialSynthesisSession?.draftContent]
  );
  const hasPhysicsPreflightInputReady = useMemo(
    () => hasLoadedFiles && physicsGenerationSourceContent.trim().length > 0,
    [hasLoadedFiles, physicsGenerationSourceContent]
  );
  const meshFilesCacheKey = useMemo(() => buildMeshFilesCacheKey(meshFiles), [meshFiles]);
  const packageRootsCacheKey = useMemo(
    () => buildPackageRootsCacheKey(packageRoots),
    [packageRoots]
  );
  const queuedPhysicsActionKeys = useMemo(
    () => queuedPhysicsActions.map((request) => request.key),
    [queuedPhysicsActions]
  );
  const physicsActionStatusByKey = useMemo(
    () =>
      buildSimulationPrepPhysicsActionStatusMap({
        runningActionKey: runningPhysicsActionKey,
        queuedActionKeys: queuedPhysicsActionKeys,
      }),
    [queuedPhysicsActionKeys, runningPhysicsActionKey]
  );
  const inertialSynthesisSummary = useMemo(
    () =>
      inertialSynthesisSession ? buildInertialSynthesisSummary(inertialSynthesisSession.synthesis) : null,
    [inertialSynthesisSession]
  );
  const inertialMassDeltaSummary = useMemo<InertialMassDeltaSummary | null>(
    () =>
      inertialSynthesisSession
        ? buildInertialMassDeltaSummary({
            auditSummary: inertialSynthesisSession.audit,
            synthesisResult: inertialSynthesisSession.synthesis,
          })
        : null,
    [inertialSynthesisSession]
  );

  const handlePreviewBakeVisualTransforms = useCallback(() => {
    const preview = buildVirtualBakePreview(vizUrdfContent, {
      kinds: ["visual", "collision"],
    });
    if (preview.success === false) {
      toast.error(preview.error);
      return;
    }
    if (preview.entries.length === 0) {
      toast.info("No visual or collision origins need baking.");
      return;
    }

    setBakePreviewSession({
      sourceContent: vizUrdfContent,
      stagedContent: preview.content,
      preview,
    });
    toast.success(
      `Staged bake export for ${preview.entries.length} visual/collision entr${preview.entries.length === 1 ? "y" : "ies"}.`
    );
  }, [vizUrdfContent]);
  const handleClearBakePreviewSession = useCallback(() => {
    setBakePreviewSession(null);
  }, []);
  const handleCaptureCanonicalSynthesis = useCallback(async () => {
    const capturedState = captureKinematicState(robot, vizUrdfContent);
    if (!capturedState) {
      toast.error("Failed to capture the current robot state for canonical synthesis.");
      return;
    }
    try {
      const synthesisSourceContent = bakePreviewSession?.stagedContent ?? vizUrdfContent;
      const result = await executeCanonicalSynthesisViaBackend({
        sourceUrdf: vizUrdfContent,
        synthesisSourceUrdf: synthesisSourceContent,
        capturedState,
      });
      setCanonicalSynthesisPreview({
        sourceContent: vizUrdfContent,
        synthesisSourceContent: synthesisSourceContent,
        preview: result.preview,
        draftContent: result.draftContent,
      });
      setShowUrdfEditor(true);
      setUrdfViewMode("modified");
      toast.success(
        `Captured canonical synthesis draft for ${result.preview.jointCount} joint${result.preview.jointCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate a canonical URDF draft from the captured synthesis."
      );
    }
  }, [bakePreviewSession?.stagedContent, robot, setShowUrdfEditor, setUrdfViewMode, vizUrdfContent]);
  const handleClearCanonicalSynthesisPreview = useCallback(() => {
    setCanonicalSynthesisPreview(null);
  }, []);
  const stageGeneratedPhysicsDraft = useCallback(
    ({
      jobId,
      auditSummary,
      synthesisResult,
      draftUrdfContent,
    }: {
      jobId?: string | null;
      auditSummary: InertialAuditSummary | null;
      synthesisResult: InertialSynthesisResult;
      draftUrdfContent: string;
    }): string[] => {
      const synthesizedNames = collectSynthesizedPhysicsLinkNames(synthesisResult);
      setInertialSynthesisSession({
        jobId: jobId ?? null,
        sourceContent: vizUrdfContent,
        baseContent: inertialDraftBaseContent,
        audit: auditSummary,
        synthesis: synthesisResult,
        draftContent: draftUrdfContent,
      });
      if (showUrdfEditor) {
        setUrdfViewMode("modified");
      }
      return synthesizedNames;
    },
    [inertialDraftBaseContent, setUrdfViewMode, showUrdfEditor, vizUrdfContent]
  );
  const handleClearInertialSynthesisSession = useCallback(() => {
    setInertialSynthesisSession(null);
  }, []);
  const loadFramePreflight = useCallback(async ({
    force = false,
    sourceUrdf = vizUrdfContent,
  }: {
    force?: boolean;
    sourceUrdf?: string;
  } = {}) => {
    const trimmedUrdf = sourceUrdf.trim();
    if (!trimmedUrdf) {
      framePreflightRequestIdRef.current += 1;
      framePreflightRequestedSourceRef.current = null;
      setFramePreflightSession(null);
      setIsFramePreflightLoading(false);
      return "skipped" as const;
    }
    const requestDecision = resolveSimulationPrepPreflightRequestDecision({
      force,
      matchesCurrentSession: framePreflightSession?.sourceContent === sourceUrdf,
      isSameSourceInFlight:
        isFramePreflightLoading && framePreflightRequestedSourceRef.current === sourceUrdf,
    });
    if (requestDecision !== "start") {
      return requestDecision;
    }
    const requestId = framePreflightRequestIdRef.current + 1;
    framePreflightRequestIdRef.current = requestId;
    framePreflightRequestedSourceRef.current = sourceUrdf;
    setIsFramePreflightLoading(true);
    try {
      const result = await framePreflightViaBackend({
        sourceUrdf,
      });
      if (framePreflightRequestIdRef.current !== requestId) {
        return "superseded" as const;
      }
      setFramePreflightSession({
        sourceContent: sourceUrdf,
        ...result,
      });
      return "success" as const;
    } catch {
      if (framePreflightRequestIdRef.current !== requestId) {
        return "superseded" as const;
      }
      return "failed" as const;
    } finally {
      if (framePreflightRequestIdRef.current === requestId) {
        framePreflightRequestedSourceRef.current = null;
        setIsFramePreflightLoading(false);
      }
    }
  }, [framePreflightSession, isFramePreflightLoading, vizUrdfContent]);
  const loadPhysicsPreflight = useCallback(
    async ({
      force = false,
      showErrorToast = false,
      sourceUrdf = physicsGenerationSourceContent,
    }: {
      force?: boolean;
      showErrorToast?: boolean;
      sourceUrdf?: string;
    } = {}) => {
      if (!hasLoadedFiles || sourceUrdf.trim().length === 0) {
        physicsPreflightRequestIdRef.current += 1;
        physicsPreflightRequestedSourceRef.current = null;
        setPhysicsPreflightSession(null);
        setIsPhysicsPreflightLoading(false);
        return "skipped" as const;
      }
      const requestDecision = resolveSimulationPrepPreflightRequestDecision({
        force,
        matchesCurrentSession:
          physicsPreflightSession?.sourceContent === sourceUrdf &&
          physicsPreflightSession.urdfBasePath === urdfBasePath &&
          physicsPreflightSession.meshFilesCacheKey === meshFilesCacheKey &&
          physicsPreflightSession.packageRootsCacheKey === packageRootsCacheKey,
        isSameSourceInFlight:
          isPhysicsPreflightLoading && physicsPreflightRequestedSourceRef.current === sourceUrdf,
      });
      if (requestDecision !== "start") {
        return requestDecision;
      }
      const requestId = physicsPreflightRequestIdRef.current + 1;
      physicsPreflightRequestIdRef.current = requestId;
      physicsPreflightRequestedSourceRef.current = sourceUrdf;
      setIsPhysicsPreflightLoading(true);
      try {
        const result = await generatePhysicsPreflightViaBackend({
          sourceUrdf,
          meshFiles,
          urdfBasePath,
          packageRoots,
        });
        if (physicsPreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        setPhysicsPreflightSession({
          sourceContent: sourceUrdf,
          urdfBasePath,
          meshFilesCacheKey,
          packageRootsCacheKey,
          ...result,
        });
        return "success" as const;
      } catch (error) {
        if (physicsPreflightRequestIdRef.current !== requestId) {
          return "superseded" as const;
        }
        if (showErrorToast) {
          toast.error(error instanceof Error ? error.message : "Failed to load backend physics audit.");
        }
        return "failed" as const;
      } finally {
        if (physicsPreflightRequestIdRef.current === requestId) {
          physicsPreflightRequestedSourceRef.current = null;
          setIsPhysicsPreflightLoading(false);
        }
      }
    },
    [
      hasLoadedFiles,
      isPhysicsPreflightLoading,
      meshFiles,
      meshFilesCacheKey,
      packageRoots,
      packageRootsCacheKey,
      physicsGenerationSourceContent,
      physicsPreflightSession,
      urdfBasePath,
    ]
  );
  const handleOpenGeneratePhysicsDialog = useCallback(async () => {
    if (isPhysicsPreflightLoading) {
      return;
    }
    await loadPhysicsPreflight({ showErrorToast: true });
  }, [isPhysicsPreflightLoading, loadPhysicsPreflight]);
  const refreshSimulationPrepChecklist = useCallback(
    async ({ sourceUrdf }: { sourceUrdf: string }) => {
      const [frameResult, physicsResult] = await Promise.all([
        loadFramePreflight({ force: true, sourceUrdf }),
        loadPhysicsPreflight({ force: true, sourceUrdf }),
      ]);
      const refreshStatus = resolveSimulationPrepChecklistRefreshStatus({
        frameResult: frameResult as SimulationPrepChecklistRefreshResult,
        physicsResult: physicsResult as SimulationPrepChecklistRefreshResult,
      });
      return {
        frameResult,
        physicsResult,
        ...refreshStatus,
      };
    },
    [loadFramePreflight, loadPhysicsPreflight]
  );
  const applySimulationPrepUrdfUpdate = useCallback(
    async ({
      nextUrdfContent,
      pinnedSymmetryChain,
      pinnedSymmetryOutcome,
      robotMirrorOutcome,
      successMessage,
    }: {
      nextUrdfContent: string;
      pinnedSymmetryChain?: RepeatedInertiaSymmetryChain | null;
      pinnedSymmetryOutcome?: RepeatedInertiaSymmetryOutcome | null;
      robotMirrorOutcome?: RobotMirrorOutcome | null;
      successMessage: string;
    }) => {
      setBakePreviewSession(null);
      setCanonicalSynthesisPreview(null);
      setInertialSynthesisSession(null);
      setRepeatedInertiaResolvedGroupKeys([]);
      setRepeatedInertiaOutcomeByGroupKey({});
      setPinnedRepeatedInertiaSymmetryChains(
        pinnedSymmetryChain
          ? [
              {
                ...pinnedSymmetryChain,
                recommendedRepair: null,
              },
            ]
          : []
      );
      setRepeatedInertiaSymmetryOutcomeByChainKey(
        pinnedSymmetryChain && pinnedSymmetryOutcome
          ? {
              [buildRepeatedInertiaSymmetryFamilyOutcomeKey(pinnedSymmetryChain)]:
                pinnedSymmetryOutcome,
              [buildRepeatedInertiaSymmetryChainKey({
                symmetryRootLinkName: pinnedSymmetryChain.symmetryRootLinkName,
                outlierBranchRootLinkName: pinnedSymmetryChain.outlierBranchRootLinkName,
              })]: pinnedSymmetryOutcome,
            }
          : {}
      );
      setRobotMirrorOutcome(robotMirrorOutcome ?? null);
      updateUrdfFileWithCollaboration(nextUrdfContent);
      setUrdfContentVersion((currentVersion) => currentVersion + 1);
      const checklistRefresh = await refreshSimulationPrepChecklist({ sourceUrdf: nextUrdfContent });
      const toastPlan = buildSimulationPrepUpdateToastPlan({
        successMessage,
        checklistRefreshStatus: checklistRefresh.status,
      });
      toast.success(toastPlan.successMessage);
      if (toastPlan.followupMessage) {
        toast.error(toastPlan.followupMessage);
      }
    },
    [
      refreshSimulationPrepChecklist,
      setBakePreviewSession,
      setCanonicalSynthesisPreview,
      setInertialSynthesisSession,
      setPinnedRepeatedInertiaSymmetryChains,
      setRobotMirrorOutcome,
      setRepeatedInertiaOutcomeByGroupKey,
      setRepeatedInertiaResolvedGroupKeys,
      setRepeatedInertiaSymmetryOutcomeByChainKey,
      setUrdfContentVersion,
      updateUrdfFileWithCollaboration,
    ]
  );
  const handleGenerateInertialDraft = useCallback(
    async (linkName: string, densityPresetId: InertialDensityPresetId) => {
      try {
        const result = await generatePhysicsDraftViaBackend({
          sourceUrdf: physicsGenerationSourceContent,
          meshFiles,
          urdfBasePath,
          packageRoots,
          densityPresetId,
          repairMode: "replace-all",
          linkNames: [linkName],
          canonicalizeRepeatedMeshes: true,
        });
        const synthesizedNames = stageGeneratedPhysicsDraft({
          jobId: result.jobId,
          auditSummary: result.auditSummary,
          synthesisResult: result.synthesisResult,
          draftUrdfContent: result.draftUrdfContent,
        });
        await loadPhysicsPreflight({ sourceUrdf: result.draftUrdfContent });
        toast.success(`Generated inertial draft for ${synthesizedNames.join(", ")}.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to generate an inertial draft.");
      }
    },
    [
      loadPhysicsPreflight,
      meshFiles,
      packageRoots,
      physicsGenerationSourceContent,
      stageGeneratedPhysicsDraft,
      urdfBasePath,
    ]
  );
  const executePhysicsAction = useCallback(
    async (request: PhysicsActionRequest) => {
      try {
        if (request.key === "repair-missing-invalid" || request.key === "replace-all") {
          const result = await generatePhysicsDraftViaBackend({
            sourceUrdf: physicsGenerationSourceContent,
            meshFiles,
            urdfBasePath,
            packageRoots,
            densityPresetId: request.densityPresetId,
            repairMode: request.repairMode,
            canonicalizeRepeatedMeshes: true,
          });
          const synthesizedNames = stageGeneratedPhysicsDraft({
            jobId: result.jobId,
            auditSummary: result.auditSummary,
            synthesisResult: result.synthesisResult,
            draftUrdfContent: result.draftUrdfContent,
          });
          await loadPhysicsPreflight({ sourceUrdf: result.draftUrdfContent });
          toast.success(
            `Physics generated for ${synthesizedNames.length} link${synthesizedNames.length === 1 ? "" : "s"}. Review in Modified view when ready.`
          );
          return;
        }

        if (request.key === "voxel-recovery") {
          const voxelRecoveryLinkNames =
            physicsPreflightSession?.plausibilitySummary.excludedLinks
              .filter((entry) => entry.recoveryDisposition === "recover")
              .map((entry) => entry.linkName) ?? [];
          if (voxelRecoveryLinkNames.length === 0) {
            toast.error("No links currently need volumetric voxel recovery.");
            return;
          }
          const result = await generatePhysicsDraftViaBackend({
            sourceUrdf: physicsGenerationSourceContent,
            meshFiles,
            urdfBasePath,
            packageRoots,
            densityPresetId: request.densityPresetId,
            repairMode: "replace-all",
            linkNames: voxelRecoveryLinkNames,
            meshSolveMode: "voxel-only",
            canonicalizeRepeatedMeshes: true,
          });
          const synthesizedNames = stageGeneratedPhysicsDraft({
            jobId: result.jobId,
            auditSummary: result.auditSummary,
            synthesisResult: result.synthesisResult,
            draftUrdfContent: result.draftUrdfContent,
          });
          await loadPhysicsPreflight({ sourceUrdf: result.draftUrdfContent });
          const skippedCount = physicsPreflightSession?.plausibilitySummary.excludedLinks.length ?? 0;
          const targetedCount = result.synthesisResult.results.length;
          const unresolvedCount = result.synthesisResult.results.filter((entry) => entry.status === "skipped").length;
          toast.success(
            `Voxel recovery targeted ${targetedCount} of ${skippedCount} skipped link${skippedCount === 1 ? "" : "s"}, synthesized ${synthesizedNames.length}, and left ${unresolvedCount} unresolved. Review in Modified view when ready.`
          );
          return;
        }

        const regularizableLinkNames =
          physicsPreflightSession?.plausibilitySummary.excludedLinks
            .filter((entry) => entry.recoveryDisposition === "regularize")
            .map((entry) => entry.linkName) ?? [];
        if (regularizableLinkNames.length === 0) {
          toast.error("No near-miss links are currently available for PSD regularization.");
          return;
        }
        const result = await generatePhysicsDraftViaBackend({
          sourceUrdf: physicsGenerationSourceContent,
          meshFiles,
          urdfBasePath,
          packageRoots,
          densityPresetId: request.densityPresetId,
          repairMode: "replace-all",
          linkNames: regularizableLinkNames,
          meshSolveMode: "voxel-only",
          regularizeNearMissTensors: true,
          canonicalizeRepeatedMeshes: true,
        });
        const synthesizedNames = stageGeneratedPhysicsDraft({
          jobId: result.jobId,
          auditSummary: result.auditSummary,
          synthesisResult: result.synthesisResult,
          draftUrdfContent: result.draftUrdfContent,
        });
        await loadPhysicsPreflight({ sourceUrdf: result.draftUrdfContent });
        const targetedCount = result.synthesisResult.results.length;
        const unresolvedCount = result.synthesisResult.results.filter((entry) => entry.status === "skipped").length;
        toast.success(
          `PSD regularization targeted ${targetedCount} near-miss link${targetedCount === 1 ? "" : "s"}, synthesized ${synthesizedNames.length}, and left ${unresolvedCount} unresolved. Review in Modified view when ready.`
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : request.key === "voxel-recovery"
              ? "Failed to run volumetric voxelization."
              : request.key === "psd-regularize"
                ? "Failed to regularize near-miss inertials."
                : "Failed to generate physics draft."
        );
      }
    },
    [
      loadPhysicsPreflight,
      meshFiles,
      packageRoots,
      physicsGenerationSourceContent,
      physicsPreflightSession?.plausibilitySummary.excludedLinks,
      stageGeneratedPhysicsDraft,
      urdfBasePath,
    ]
  );
  const startPhysicsAction = useCallback(
    (request: PhysicsActionRequest) => {
      setRunningPhysicsActionKey(request.key);
      void executePhysicsAction(request).finally(() => {
        setRunningPhysicsActionKey((current) => (current === request.key ? null : current));
      });
    },
    [executePhysicsAction]
  );
  const queuePhysicsAction = useCallback(
    (request: PhysicsActionRequest) => {
      if (
        repeatedInertiaGroupAction !== null ||
        repeatedInertiaSymmetryActingChainKey !== null ||
        isRobotMirrorActing
      ) {
        return;
      }
      if (runningPhysicsActionKey === null && queuedPhysicsActions.length === 0) {
        startPhysicsAction(request);
        return;
      }
      if (
        !canQueueSimulationPrepPhysicsAction({
          runningActionKey: runningPhysicsActionKey,
          queuedActionKeys: queuedPhysicsActionKeys,
          nextActionKey: request.key,
        })
      ) {
        return;
      }
      setQueuedPhysicsActions((currentQueue) => {
        if (
          runningPhysicsActionKey === request.key ||
          currentQueue.some((queuedRequest) => queuedRequest.key === request.key)
        ) {
          return currentQueue;
        }
        return [...currentQueue, request];
      });
    },
    [
      isRobotMirrorActing,
      queuedPhysicsActionKeys,
      queuedPhysicsActions.length,
      repeatedInertiaGroupAction,
      repeatedInertiaSymmetryActingChainKey,
      runningPhysicsActionKey,
      startPhysicsAction,
    ]
  );
  const handleGeneratePhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId, repairMode: InertialRepairMode) => {
      queuePhysicsAction({
        key: repairMode === "replace-all" ? "replace-all" : "repair-missing-invalid",
        densityPresetId,
        repairMode,
      });
    },
    [queuePhysicsAction]
  );
  const handleGenerateVoxelPhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId) => {
      queuePhysicsAction({
        key: "voxel-recovery",
        densityPresetId,
      });
    },
    [queuePhysicsAction]
  );
  const handleGenerateRegularizedPhysicsDraft = useCallback(
    (densityPresetId: InertialDensityPresetId) => {
      queuePhysicsAction({
        key: "psd-regularize",
        densityPresetId,
      });
    },
    [queuePhysicsAction]
  );

  useEffect(() => {
    if (!bakePreviewSession) {
      return;
    }
    if (vizUrdfContent !== bakePreviewSession.sourceContent) {
      setBakePreviewSession(null);
    }
  }, [bakePreviewSession, vizUrdfContent]);

  useEffect(() => {
    if (!canonicalSynthesisPreview) {
      return;
    }
    if (
      vizUrdfContent !== canonicalSynthesisPreview.sourceContent ||
      (bakePreviewSession?.stagedContent ?? vizUrdfContent) !==
        canonicalSynthesisPreview.synthesisSourceContent
    ) {
      setCanonicalSynthesisPreview(null);
    }
  }, [bakePreviewSession?.stagedContent, canonicalSynthesisPreview, vizUrdfContent]);
  useEffect(() => {
    if (!inertialSynthesisSession) {
      return;
    }
    if (
      vizUrdfContent !== inertialSynthesisSession.sourceContent ||
      inertialDraftBaseContent !== inertialSynthesisSession.baseContent
    ) {
      setInertialSynthesisSession(null);
    }
  }, [inertialDraftBaseContent, inertialSynthesisSession, vizUrdfContent]);
  useEffect(() => {
    if (hasPhysicsPreflightInputReady) {
      return;
    }
    physicsPreflightRequestIdRef.current += 1;
    physicsPreflightRequestedSourceRef.current = null;
    setPhysicsPreflightSession(null);
    setIsPhysicsPreflightLoading(false);
  }, [hasPhysicsPreflightInputReady]);

  useEffect(() => {
    if (runningPhysicsActionKey !== null || queuedPhysicsActions.length === 0) {
      return;
    }
    const [nextAction, ...remainingActions] = queuedPhysicsActions;
    setQueuedPhysicsActions(remainingActions);
    startPhysicsAction(nextAction);
  }, [queuedPhysicsActions, runningPhysicsActionKey, startPhysicsAction]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadFramePreflight();
    }, ROBOT_MASTERING_PREFLIGHT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadFramePreflight]);

  useEffect(() => {
    if (!hasPhysicsPreflightInputReady) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadPhysicsPreflight();
    }, ROBOT_MASTERING_PREFLIGHT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasPhysicsPreflightInputReady, loadPhysicsPreflight]);

  const resetSimulationPrepReviewState = useCallback(() => {
    setShowHealthActionPanel(false);
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
    setInertialVisualization(createDefaultInertialVisualizationSettings());
    setRepeatedInertiaResolvedGroupKeys([]);
    setRepeatedInertiaOutcomeByGroupKey({});
    setPinnedRepeatedInertiaSymmetryChains([]);
    setRepeatedInertiaSymmetryOutcomeByChainKey({});
    setRepeatedInertiaSymmetryActingChainKey(null);
    setRepeatedInertiaSymmetryActingProgress(null);
    setSelectedRobotMirrorLinkNames([]);
    setRobotMirrorOutcome(null);
    setActiveRobotMirrorAction(null);
    setIsRobotMirrorActing(false);
  }, [setInertialVisualization]);

  useEffect(() => {
    if (urdfLoadRevision === 0 || !originalUrdfContent.trim()) {
      return;
    }

    // A fresh load should always start from the hidden-by-default viewer baseline,
    // even when the incoming URDF content is byte-for-byte identical to the prior load.
    resetSimulationPrepReviewState();
  }, [originalUrdfContent, resetSimulationPrepReviewState, urdfLoadRevision]);

  const getResolvedExportUrdfContent = useCallback(() => {
    if (inertialSynthesisSession?.draftContent) {
      return inertialSynthesisSession.draftContent;
    }
    if (canonicalSynthesisPreview?.draftContent) {
      return canonicalSynthesisPreview.draftContent;
    }
    return getExportUrdfContent();
  }, [canonicalSynthesisPreview?.draftContent, getExportUrdfContent, inertialSynthesisSession?.draftContent]);
  const canonicalSynthesisSupportLabel = useMemo(() => {
    const supportPlane = canonicalSynthesisPreview?.preview.supportPlane;
    if (!supportPlane?.success) {
      return null;
    }
    return formatSignedAxisLabel(supportPlane.inferredUpAxis, supportPlane.inferredUpSign);
  }, [canonicalSynthesisPreview?.preview.supportPlane]);
  const handleDeleteJointAndClearSelection = useCallback(
    (jointName: string) => {
      if (selectedJoint === jointName) {
        setSelectedJoint(null);
      }
      if (hoveredJoint === jointName) {
        setHoveredJoint(null);
      }
      handleDeleteJoint(jointName);
    },
    [handleDeleteJoint, hoveredJoint, selectedJoint, setHoveredJoint, setSelectedJoint]
  );

  useIluCalibrationFocus({
    availableJoints,
    calibrate: iluCalibrateParam,
    focusJoint: iluFocusJointParam,
    isAttachingIluSession,
    setSelectedLink,
    setSelectedJoint,
  });

  const { handleMaterialChange } = useUrdfMaterialHandlers({
    vizUrdfContent,
    updateUrdfFile: updateUrdfFileWithCollaboration,
  });

  const handleRobotJointsLoaded = useCallback((joints: string[], angles: Record<string, number>) => {
    startTransition(() => {
      setAvailableJoints(joints);
      setJointValues(angles);
      // Don't automatically select a joint - let user choose what to select
    });
  }, [setJointValues]);

  const handleEpisodesResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const container = event.currentTarget.closest(".sidebar-panel") as HTMLElement;
      if (!container) return;

      const containerHeight = container.clientHeight;
      if (containerHeight <= 0) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const lastPointerDown = lastEpisodesResizePointerDownRef.current;
      if (
        lastPointerDown &&
        now - lastPointerDown.t <= 320 &&
        Math.abs(event.clientY - lastPointerDown.y) <= 8
      ) {
        lastEpisodesResizePointerDownRef.current = null;
        setSidebarEpisodesViewHeight(
          clampSidebarEpisodesViewHeight(DEFAULT_RECORDING_VIEW_HEIGHT, containerHeight)
        );
        return;
      }
      lastEpisodesResizePointerDownRef.current = { t: now, y: event.clientY };

      const startHeight = clampSidebarEpisodesViewHeight(
        sidebarEpisodesViewHeight,
        containerHeight
      );
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientY - startY;
        const deltaRatio = delta / containerHeight;
        // Dragging down moves the splitter down: top grows, bottom shrinks.
        const nextHeight = clampSidebarEpisodesViewHeight(startHeight - deltaRatio, containerHeight);
        setSidebarEpisodesViewHeight(nextHeight);
      };

      const handlePointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [
      sidebarEpisodesViewHeight,
      clampSidebarEpisodesViewHeight,
      setSidebarEpisodesViewHeight,
    ]
  );

  const hasRotationChanges = useMemo(
    () => vizUrdfContent !== originalVizUrdfContent,
    [vizUrdfContent, originalVizUrdfContent]
  );

  const meshRootHints = useMemo(() => {
    if (debugMeshInfo.length === 0) return [];
    const roots = new Set<string>();
    const score = (path: string) => {
      let value = 0;
      if (path.includes("/meshes")) value += 2;
      if (path.includes("/assets")) value += 2;
      const depthPenalty = path.split("/").filter(Boolean).length;
      return value * 100 - depthPenalty;
    };

    for (const info of debugMeshInfo) {
      const normalized = normalizeMeshPathForMatch(info.webkitRelativePath || "");
      if (!normalized) continue;
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length <= 1) continue;
      const dir = parts.slice(0, -1).join("/");
      if (dir) roots.add(dir);
      const meshesIndex = parts.lastIndexOf("meshes");
      const assetsIndex = parts.lastIndexOf("assets");
      const folderIndex = Math.max(meshesIndex, assetsIndex);
      if (folderIndex !== -1) {
        roots.add(parts.slice(0, folderIndex + 1).join("/"));
      }
    }

    return Array.from(roots)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3);
  }, [debugMeshInfo]);

  const inertialIssues = useMemo(() => {
    if (!urdfAnalysis?.isValid) {
      return {
        missing: [] as string[],
        invalidMass: [] as string[],
        invalidTensor: [] as string[],
      };
    }
    const missing: string[] = [];
    const invalidMass: string[] = [];
    const invalidTensor: string[] = [];
    urdfAnalysis.linkNames.forEach((linkName) => {
      const data = urdfAnalysis.linkDataByName[linkName];
      if (!data?.inertial) {
        missing.push(linkName);
        return;
      }
      const mass = Number(data.inertial.mass ?? 0);
      if (!Number.isFinite(mass) || mass <= 0) {
        invalidMass.push(linkName);
        return;
      }
      const tensorCheck = validateInertiaTensor(data.inertial.inertia);
      if (!tensorCheck.valid) {
        invalidTensor.push(linkName);
      }
    });
    return { missing, invalidMass, invalidTensor };
  }, [urdfAnalysis]);
  const simulationPrepStatus = useMemo(
    () =>
      buildSimulationPrepStatus({
        robotFrameLint,
        missingInertialCount: inertialIssues.missing.length,
        invalidMassCount: inertialIssues.invalidMass.length,
        invalidTensorCount: inertialIssues.invalidTensor.length,
        inertialPlausibilitySummary: physicsPreflightSession?.plausibilitySummary ?? null,
        orientationSummary,
      }),
    [
      inertialIssues.invalidMass.length,
      inertialIssues.invalidTensor.length,
      inertialIssues.missing.length,
      orientationSummary,
      physicsPreflightSession,
      robotFrameLint,
    ]
  );
  const physicsDraftSummary = useMemo(
    () =>
      buildPhysicsDraftSummaryText({
        inertialSynthesisSummary,
        inertialMassDeltaSummary,
      }),
    [inertialMassDeltaSummary, inertialSynthesisSummary]
  );
  const physicsDraftFingerprint = useMemo(
    () =>
      inertialSynthesisSummary
        ? buildSimulationPrepDraftFingerprint([
            inertialSynthesisSummary.densityPresetId,
            inertialSynthesisSummary.repairMode,
            inertialSynthesisSummary.synthesizedLinkCount,
            inertialSynthesisSummary.voxelFallbackLinkCount,
            inertialMassDeltaSummary?.changedLinkCount ?? 0,
            inertialMassDeltaSummary?.totalMassAfterKg?.toFixed(3) ?? "none",
          ])
        : "no-physics-draft",
    [inertialMassDeltaSummary, inertialSynthesisSummary]
  );
  const bakeDraftFingerprint = useMemo(
    () =>
      bakePreviewSession
        ? buildSimulationPrepDraftFingerprint([
            bakePreviewStats?.entryCount ?? 0,
            bakePreviewStats?.meshBackedEntryCount ?? 0,
            bakePreviewStats?.linkNames.length ?? 0,
            bakePreviewSession.stagedContent.length,
          ])
        : "no-bake-draft",
    [bakePreviewSession, bakePreviewStats]
  );
  const canonicalDraftFingerprint = useMemo(
    () =>
      canonicalSynthesisPreview
        ? buildSimulationPrepDraftFingerprint([
            canonicalSynthesisPreview.preview.robotName,
            canonicalSynthesisPreview.preview.rootLinkName,
            canonicalSynthesisPreview.preview.linkCount,
            canonicalSynthesisPreview.preview.jointCount,
            canonicalSynthesisPreview.preview.supportPlane.confidence?.toFixed(2) ?? "none",
            canonicalSynthesisPreview.draftContent.length,
          ])
        : "no-canonical-draft",
    [canonicalSynthesisPreview]
  );
  const resolvedPhysicsAuditSummary = physicsPreflightSession?.auditSummary ?? inertialAuditSummary;
  const resolvedPhysicsPlausibilitySummary = physicsPreflightSession?.plausibilitySummary ?? null;
  const physicsIssueSummary = useMemo(
    () =>
      buildPhysicsIssueSummary({
        missingInertialCount: inertialIssues.missing.length,
        invalidMassCount: inertialIssues.invalidMass.length,
        invalidTensorCount: inertialIssues.invalidTensor.length,
        inertialPlausibilitySummary: resolvedPhysicsPlausibilitySummary,
      }),
    [
      inertialIssues.invalidMass.length,
      inertialIssues.invalidTensor.length,
      inertialIssues.missing.length,
      resolvedPhysicsPlausibilitySummary,
    ]
  );
  const repeatedInertiaDiagnostics = useMemo(
    () =>
      buildRepeatedInertiaDiagnostics({
        linkDataByName: urdfAnalysis?.isValid ? urdfAnalysis.linkDataByName : null,
        reliabilityEntries: inertiaReliability,
      }),
    [inertiaReliability, urdfAnalysis]
  );
  const repeatedInertiaDiagnosticsByKey = useMemo(
    () =>
      new Map(
        repeatedInertiaDiagnostics.map((group) => [group.groupKey, group] as const)
      ),
    [repeatedInertiaDiagnostics]
  );
  const repeatedInertiaSymmetryChains = useMemo(
    () =>
      buildRepeatedInertiaSymmetryChains({
        centerMode: repeatedInertiaSymmetryCenterMode,
        linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
        repeatedInertiaDiagnostics,
        urdfContent: vizUrdfContent,
      }),
    [
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryCenterMode,
      repeatedInertiaSymmetryLinkCentersLocal,
      vizUrdfContent,
    ]
  );
  const robotMirrorSymmetryCheck = useMemo(
    () =>
      buildRobotMirrorSymmetryCheck({
        linkDataByName: urdfAnalysis?.isValid ? urdfAnalysis.linkDataByName : null,
        linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
        repeatedInertiaDiagnostics,
        urdfContent: vizUrdfContent,
      }),
    [
      urdfAnalysis,
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryLinkCentersLocal,
      vizUrdfContent,
    ]
  );
  const displayedRepeatedInertiaSymmetryChains = useMemo(() => {
    return mergeDisplayedRepeatedInertiaSymmetryChains({
      pinnedChains: pinnedRepeatedInertiaSymmetryChains,
      repeatedInertiaSymmetryChains,
    });
  }, [pinnedRepeatedInertiaSymmetryChains, repeatedInertiaSymmetryChains]);
  const robotMirrorSelectionLinks = useMemo(
    () =>
      buildRobotMirrorSelectionLinks({
        linkDataByName: urdfAnalysis?.isValid ? urdfAnalysis.linkDataByName : null,
        repeatedInertiaDiagnostics,
        repeatedInertiaSymmetryChains: displayedRepeatedInertiaSymmetryChains,
        robotMirrorSymmetryCheck,
      }),
    [
      urdfAnalysis,
      displayedRepeatedInertiaSymmetryChains,
      repeatedInertiaDiagnostics,
      robotMirrorSymmetryCheck,
    ]
  );
  const robotMirrorPlaneTouchingLinkNames = useMemo(
    () =>
      collectRobotMirrorPlaneTouchingLinkNamesFromRobot({
        check: robotMirrorSymmetryCheck,
        robot,
      }),
    [robot, robotMirrorSymmetryCheck]
  );
  useEffect(() => {
    const nextValidLinkNames = new Set(
      robotMirrorSelectionLinks.map((selectionLink) => selectionLink.linkName)
    );
    const planeTouchingSelectionLinkNameSet = new Set(
      robotMirrorPlaneTouchingLinkNames.filter((linkName) => nextValidLinkNames.has(linkName))
    );
    const defaultSelectedLinkNames = robotMirrorSelectionLinks
      .filter(
        (selectionLink) =>
          selectionLink.preselected || planeTouchingSelectionLinkNameSet.has(selectionLink.linkName)
      )
      .map((selectionLink) => selectionLink.linkName);
    setSelectedRobotMirrorLinkNames((current) => {
      const preservedLinkNames = current.filter((linkName) => nextValidLinkNames.has(linkName));
      if (preservedLinkNames.length > 0) {
        const mergedLinkNames = Array.from(
          new Set([
            ...defaultSelectedLinkNames.filter((linkName) => !current.includes(linkName)),
            ...preservedLinkNames,
          ])
        );
        return mergedLinkNames;
      }
      return defaultSelectedLinkNames;
    });
  }, [robotMirrorPlaneTouchingLinkNames, robotMirrorSelectionLinks]);
  const handleToggleRobotMirrorSelectionLink = useCallback((linkName: string) => {
    setSelectedRobotMirrorLinkNames((current) =>
      current.includes(linkName)
        ? current.filter((currentLinkName) => currentLinkName !== linkName)
        : [...current, linkName].sort((left, right) => left.localeCompare(right))
    );
  }, []);
  const robotMirrorScopeKey = useMemo(
    () =>
      robotMirrorSymmetryCheck
        ? buildRobotMirrorSymmetryVisualizationScopeKey(robotMirrorSymmetryCheck)
        : null,
    [robotMirrorSymmetryCheck]
  );
  useEffect(() => {
    if (!robotMirrorSymmetryCheck || selectedRobotMirrorLinkNames.length === 0) {
      setRobotMirrorVisualizationState((current) =>
        resolveRobotMirrorVisualizationState({
          previousState: current,
          reset: true,
        })
      );
      setRobotMirrorFixAvailability({
        isLoading: false,
        value: {
          centerOnlyActionableTargetCount: 0,
          centerOnlyAvailable: false,
          orientationOnlyActionableTargetCount: 0,
          orientationOnlyAvailable: false,
        },
      });
      return;
    }

    let cancelled = false;
    setRobotMirrorFixAvailability((current) => ({
      ...current,
      isLoading: true,
    }));

    void resolveRobotMirrorActionableSelection({
      alwaysIncludeVisualizationLinkNames: [
        ...robotMirrorSymmetryCheck.centeredLinkNames,
        ...robotMirrorPlaneTouchingLinkNames,
      ],
      linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
      meshFiles,
      packageRoots,
      robotMirrorSymmetryCheck,
      selectedLinkNames: selectedRobotMirrorLinkNames,
      selectionLinks: robotMirrorSelectionLinks,
      urdfBasePath,
      urdfContent: vizUrdfContent,
    })
      .then((selection) => {
        if (cancelled) {
          return;
        }
        setRobotMirrorVisualizationState((current) =>
          resolveRobotMirrorVisualizationState({
            nextSelection: selection,
            previousState: current,
          })
        );
        setRobotMirrorFixAvailability({
          isLoading: false,
          value: selection.availability,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRobotMirrorFixAvailability({
          isLoading: false,
          value: {
            centerOnlyActionableTargetCount: 0,
            centerOnlyAvailable: false,
            orientationOnlyActionableTargetCount: 0,
            orientationOnlyAvailable: false,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    meshFiles,
    packageRoots,
    repeatedInertiaSymmetryLinkCentersLocal,
    robotMirrorPlaneTouchingLinkNames,
    robotMirrorSelectionLinks,
    robotMirrorSymmetryCheck,
    selectedRobotMirrorLinkNames,
    urdfBasePath,
    vizUrdfContent,
  ]);
  useEffect(() => {
    setRepeatedInertiaResolvedGroupKeys((current) =>
      current.filter((groupKey) => repeatedInertiaDiagnosticsByKey.has(groupKey))
    );
  }, [repeatedInertiaDiagnosticsByKey]);
  useEffect(() => {
    setRepeatedInertiaOutcomeByGroupKey((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([groupKey]) => repeatedInertiaDiagnosticsByKey.has(groupKey))
      )
    );
  }, [repeatedInertiaDiagnosticsByKey]);
  const voxelRecoveryScopeLinkNames = useMemo(
    () =>
      (resolvedPhysicsPlausibilitySummary?.excludedLinks ?? [])
        .filter((entry) => entry.recoveryDisposition === "recover")
        .map((entry) => entry.linkName),
    [resolvedPhysicsPlausibilitySummary]
  );
  const psdRegularizeScopeLinkNames = useMemo(
    () =>
      (resolvedPhysicsPlausibilitySummary?.excludedLinks ?? [])
        .filter((entry) => entry.recoveryDisposition === "regularize")
        .map((entry) => entry.linkName),
    [resolvedPhysicsPlausibilitySummary]
  );
  const previewableInertiaVisualizationLinkNamesByScopeKey = useMemo(() => {
    const scopeLinkNamesByKey = new Map<string, readonly string[]>();
    repeatedInertiaDiagnostics.forEach((group) => {
      scopeLinkNamesByKey.set(
        buildRepeatedInertiaVisualizationScopeKey(group.groupKey),
        group.linkEntries.map((entry) => entry.linkName)
      );
    });
    displayedRepeatedInertiaSymmetryChains.forEach((chain) => {
      scopeLinkNamesByKey.set(
        buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain),
        collectRepeatedInertiaSymmetryFamilyLinkNames(chain)
      );
    });
    if (
      robotMirrorScopeKey &&
      robotMirrorVisualizationState.visualizationLinkNames.length > 0
    ) {
      scopeLinkNamesByKey.set(
        robotMirrorScopeKey,
        robotMirrorVisualizationState.visualizationLinkNames
      );
    }
    if (voxelRecoveryScopeLinkNames.length > 0) {
      scopeLinkNamesByKey.set(SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY, voxelRecoveryScopeLinkNames);
    }
    if (psdRegularizeScopeLinkNames.length > 0) {
      scopeLinkNamesByKey.set(SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY, psdRegularizeScopeLinkNames);
    }
    return scopeLinkNamesByKey;
  }, [
    displayedRepeatedInertiaSymmetryChains,
    psdRegularizeScopeLinkNames,
    repeatedInertiaDiagnostics,
    robotMirrorScopeKey,
    robotMirrorVisualizationState,
    voxelRecoveryScopeLinkNames,
  ]);
  const {
    effectiveScopeKey: effectiveInertiaVisualizationScopeKey,
    effectiveScopedLinkNames: effectiveInertiaVisualizationScopedLinkNames,
  } = useMemo(
    () =>
      resolveSimulationPrepVisualizationScope({
        activeScopeKey: activeInertiaVisualizationScopeKey,
        hoveredPreview: hoveredInertiaVisualizationPreview,
        scopeLinkNamesByKey: previewableInertiaVisualizationLinkNamesByScopeKey,
      }),
    [
      activeInertiaVisualizationScopeKey,
      hoveredInertiaVisualizationPreview,
      previewableInertiaVisualizationLinkNamesByScopeKey,
    ]
  );
  const activeSimulationPrepSymmetryVisualization = useMemo(
    () =>
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: effectiveInertiaVisualizationScopeKey,
        repeatedInertiaSymmetryChains: displayedRepeatedInertiaSymmetryChains,
      }),
    [displayedRepeatedInertiaSymmetryChains, effectiveInertiaVisualizationScopeKey]
  );
  const activeSimulationPrepRobotMirrorVisualization = useMemo(
    () =>
      resolveActiveSimulationPrepRobotMirrorVisualization({
        activeScopeKey: effectiveInertiaVisualizationScopeKey,
        robotMirrorSymmetryCheck,
      }),
    [effectiveInertiaVisualizationScopeKey, robotMirrorSymmetryCheck]
  );
  const validInertiaVisualizationScopeKeys = useMemo(() => {
    const keys = new Set(
      repeatedInertiaDiagnostics.map((group) =>
        buildRepeatedInertiaVisualizationScopeKey(group.groupKey)
      )
    );
    displayedRepeatedInertiaSymmetryChains.forEach((chain) => {
      keys.add(buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain));
    });
    if (robotMirrorScopeKey) {
      keys.add(robotMirrorScopeKey);
    }
    if (voxelRecoveryScopeLinkNames.length > 0) {
      keys.add(SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY);
    }
    if (psdRegularizeScopeLinkNames.length > 0) {
      keys.add(SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY);
    }
    return keys;
  }, [
    psdRegularizeScopeLinkNames.length,
    repeatedInertiaDiagnostics,
    displayedRepeatedInertiaSymmetryChains,
    robotMirrorScopeKey,
    voxelRecoveryScopeLinkNames.length,
  ]);
  useEffect(() => {
    setInertialVisualization((current) => {
      const currentScopedLinkNames = current.scopedLinkNames ?? null;
      const hasSameScopedLinkNames =
        currentScopedLinkNames === null
          ? effectiveInertiaVisualizationScopedLinkNames === null
          : effectiveInertiaVisualizationScopedLinkNames !== null &&
            currentScopedLinkNames.length === effectiveInertiaVisualizationScopedLinkNames.length &&
            currentScopedLinkNames.every(
              (linkName, index) => linkName === effectiveInertiaVisualizationScopedLinkNames[index]
            );
      if (hasSameScopedLinkNames) {
        return current;
      }
      return syncSimulationPrepInertiaVisualizationScope(
        current,
        effectiveInertiaVisualizationScopedLinkNames
      );
    });
  }, [effectiveInertiaVisualizationScopedLinkNames, setInertialVisualization]);
  useEffect(() => {
    if (!activeInertiaVisualizationScopeKey) {
      return;
    }
    if (validInertiaVisualizationScopeKeys.has(activeInertiaVisualizationScopeKey)) {
      return;
    }

    setActiveInertiaVisualizationScopeKey(null);
    setInertialVisualization((current) => syncSimulationPrepInertiaVisualizationScope(current));
  }, [
    activeInertiaVisualizationScopeKey,
    setInertialVisualization,
    validInertiaVisualizationScopeKeys,
  ]);
  useEffect(() => {
    if (!hoveredInertiaVisualizationPreview) {
      return;
    }
    if (validInertiaVisualizationScopeKeys.has(hoveredInertiaVisualizationPreview.scopeKey)) {
      return;
    }
    setHoveredInertiaVisualizationPreview(null);
  }, [hoveredInertiaVisualizationPreview, validInertiaVisualizationScopeKeys]);

  useEffect(() => {
    if (inertialVisualization.scopedLinkNames !== null) {
      return;
    }
    if (activeInertiaVisualizationScopeKey === null) {
      return;
    }
    if (effectiveInertiaVisualizationScopeKey !== null) {
      return;
    }
    setActiveInertiaVisualizationScopeKey(null);
  }, [
    activeInertiaVisualizationScopeKey,
    effectiveInertiaVisualizationScopeKey,
    inertialVisualization.scopedLinkNames,
  ]);
  const frameIssueSummary = orientationNeedsAttention ? orientationSummary : null;

  const collisionMeshStats = useMemo(() => {
    if (!urdfAnalysis?.isValid) {
      return { total: 0, matched: 0, missing: [] as string[] };
    }
    let total = 0;
    let matched = 0;
    const missing: string[] = [];
    urdfAnalysis.collisionEntries.forEach((entry) => {
      if (entry.geometry.type !== "mesh") return;
      total += 1;
      const resolved = resolveMeshBlobFromReference(
        entry.geometry.filename,
        meshFiles,
        urdfBasePath,
        packageRoots
      );
      if (resolved) {
        matched += 1;
      } else {
        missing.push(entry.geometry.filename);
      }
    });
    return { total, matched, missing };
  }, [urdfAnalysis, meshFiles, urdfBasePath, packageRoots]);

  const hasLoadReviewAttention = Boolean(
    urdfValidationError ||
      unmatchedURDFRefs.length > 0 ||
      absoluteFileMeshRefs.length > 0 ||
      missingPackageRefs.length > 0 ||
      inertialIssues.missing.length > 0 ||
      inertialIssues.invalidMass.length > 0 ||
      inertialIssues.invalidTensor.length > 0 ||
      collisionMeshStats.missing.length > 0 ||
      orientationNeedsAttention
  );
  const autoOpenedLoadReviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasLoadedFiles || !hasLoadReviewAttention) {
      return;
    }
    const loadReviewKey = [
      activeUrdfPath ?? "",
      urdfFile?.name ?? "",
      String(urdfFile?.lastModified ?? 0),
    ].join("::");
    if (autoOpenedLoadReviewKeyRef.current === loadReviewKey) {
      return;
    }
    autoOpenedLoadReviewKeyRef.current = loadReviewKey;
    setShowLoadIssues(true);
  }, [
    activeUrdfPath,
    hasLoadedFiles,
    hasLoadReviewAttention,
    setShowLoadIssues,
    urdfFile,
  ]);

  useEffect(() => {
    if (!showLoadIssues || !hasLoadedFiles || hasLoadReviewAttention) {
      return;
    }

    setShowLoadIssues(false);
  }, [hasLoadedFiles, hasLoadReviewAttention, setShowLoadIssues, showLoadIssues]);

  const worldHubEnabled = isWorldHubConfigured();
  const ikSolverOptions = (() => {
    const options = [...availableIkSolvers];
    if (!options.some((solver) => solver.id === selectedIkSolverId)) {
      options.unshift({
        id: selectedIkSolverId,
        label: selectedIkSolverId,
      });
    }
    return options.sort((lhs, rhs) =>
      lhs.id === "ik-js" ? -1 : rhs.id === "ik-js" ? 1 : lhs.label.localeCompare(rhs.label)
    );
  })();

  const openSimulationPrepPanel = () => {
    setShowLoadIssues(false);
    setInertialVisualization((current) => withSimulationPrepInertiaVisualization(current));
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
    setSimulationPrepResetPoseRequestKey(String(Date.now()));
    setShowHealthActionPanel(true);
  };
  useEffect(() => {
    if (showHealthActionPanel) {
      return;
    }
    setHoveredInertiaVisualizationPreview(null);
  }, [showHealthActionPanel]);

  const handleToggleInertiaVisualizationScope = useCallback(
    (
      scopeKey: string,
      linkNames: readonly string[],
      _symmetryChain: RepeatedInertiaSymmetryChain | null = null
    ) => {
      void _symmetryChain;
      const hasTargetLinks = linkNames.length > 0;
      setHoveredInertiaVisualizationPreview(null);
      setActiveInertiaVisualizationScopeKey((current) =>
        current === scopeKey || !hasTargetLinks ? null : scopeKey
      );
      setShowHealthActionPanel(true);
    },
    []
  );
  const handlePreviewInertiaVisualizationScope = useCallback(
    (
      scopeKey: string,
      linkNames: readonly string[],
      _symmetryChain: RepeatedInertiaSymmetryChain | null = null
    ) => {
      void _symmetryChain;
      if (linkNames.length === 0) {
        return;
      }
      const scopedLinkNames = [...linkNames].sort((left, right) => left.localeCompare(right));
      setHoveredInertiaVisualizationPreview((current) => {
        if (
          current &&
          current.scopeKey === scopeKey &&
          current.scopedLinkNames.length === scopedLinkNames.length &&
          current.scopedLinkNames.every((linkName, index) => linkName === scopedLinkNames[index])
        ) {
          return current;
        }
        return {
          scopeKey,
          scopedLinkNames,
        };
      });
      setShowHealthActionPanel(true);
    },
    []
  );
  const handleClearInertiaVisualizationPreview = useCallback(() => {
    setHoveredInertiaVisualizationPreview(null);
  }, []);
  const handleFixRepeatedInertiaGroup = useCallback(
    async (groupKey: string) => {
      if (hasSimulationPrepFixActionInFlight) {
        return;
      }
      setRepeatedInertiaGroupAction({
        groupKey,
      });
      try {
        const result = await applyRepeatedInertiaGroupManualFix({
          urdfContent: vizUrdfContent,
          urdfAnalysis,
          groupKey,
          meshFiles,
          urdfBasePath,
          packageRoots,
        });
        if (result.ok === false) {
          if (result.error === REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR) {
            setRepeatedInertiaResolvedGroupKeys((current) =>
              current.includes(groupKey) ? current : [...current, groupKey]
            );
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "resolved",
                message: "No changes applied. Group is already consistent.",
              },
            }));
          } else if (
            result.error === REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR ||
            result.error === REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR ||
            result.error === REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR
          ) {
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "warning",
                message:
                  "No changes applied. Fix was rejected because it would worsen the result. Manual review required.",
              },
            }));
          } else {
            setRepeatedInertiaOutcomeByGroupKey((current) => ({
              ...current,
              [groupKey]: {
                tone: "warning",
                message: "No changes applied. This repeated group needs manual review.",
              },
            }));
          }
          toast.error(result.error);
          return;
        }
        await applySimulationPrepUrdfUpdate({
          nextUrdfContent: result.draftUrdfContent,
          successMessage: `Unified repeated group for ${result.linkNames.length} link${result.linkNames.length === 1 ? "" : "s"} (${result.meshReference}).`,
        });
        setRepeatedInertiaOutcomeByGroupKey((current) => ({
          ...current,
          [groupKey]: {
            tone: "success",
            message: "Direct fix applied to this repeated group.",
          },
        }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to fix the repeated mesh group.");
      } finally {
        setRepeatedInertiaGroupAction(null);
      }
    },
    [
      applySimulationPrepUrdfUpdate,
      hasSimulationPrepFixActionInFlight,
      setRepeatedInertiaResolvedGroupKeys,
      meshFiles,
      packageRoots,
      urdfAnalysis,
      urdfBasePath,
      vizUrdfContent,
    ]
  );
  const handleFixRepeatedInertiaSymmetryChain = useCallback(
    async (chain: RepeatedInertiaSymmetryChain) => {
      const chainKey = buildRepeatedInertiaSymmetryChainKey({
        symmetryRootLinkName: chain.symmetryRootLinkName,
        outlierBranchRootLinkName: chain.outlierBranchRootLinkName,
      });
      const symmetryScopeKey = buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain);
      const symmetryScopedLinkNames = collectRepeatedInertiaSymmetryFamilyLinkNames(chain);
      if (hasSimulationPrepFixActionInFlight) {
        return;
      }

      setInertialVisualization((current) =>
        withSimulationPrepInertiaVisualization(current, symmetryScopedLinkNames)
      );
      setActiveInertiaVisualizationScopeKey(symmetryScopeKey);
      setShowHealthActionPanel(true);
      setRepeatedInertiaSymmetryActingChainKey(chainKey);
      setRepeatedInertiaSymmetryActingProgress({
        chainKey,
        appliedStepCount: 0,
        totalStepCount: chain.recommendedRepair?.stepCount ?? 0,
      });
      try {
        const result = await applyRepeatedInertiaSymmetryFix({
          chain,
          linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
          repeatedInertiaDiagnostics,
          urdfContent: vizUrdfContent,
          onProgress: async ({ appliedStepCount, totalStepCount }) => {
            setRepeatedInertiaSymmetryActingProgress({
              chainKey,
              appliedStepCount,
              totalStepCount,
            });
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 0);
            });
          },
        });
        if (result.ok === false) {
          toast.error(result.error);
          return;
        }
        await applySimulationPrepUrdfUpdate({
          nextUrdfContent: result.draftUrdfContent,
          pinnedSymmetryChain: chain,
          pinnedSymmetryOutcome: {
            completedProgress: {
              appliedStepCount: result.appliedStepCount,
              totalStepCount: chain.recommendedRepair?.stepCount ?? result.appliedStepCount,
            },
            tone: "success",
            message: "Alignment applied. Keep the eye on to verify the result.",
          },
          successMessage: result.summary,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to auto-align the symmetry branch."
        );
      } finally {
        setRepeatedInertiaSymmetryActingChainKey(null);
        setRepeatedInertiaSymmetryActingProgress(null);
      }
    },
    [
      applySimulationPrepUrdfUpdate,
      hasSimulationPrepFixActionInFlight,
      repeatedInertiaDiagnostics,
      setRepeatedInertiaSymmetryActingProgress,
      repeatedInertiaSymmetryLinkCentersLocal,
      setInertialVisualization,
      setActiveInertiaVisualizationScopeKey,
      setShowHealthActionPanel,
      vizUrdfContent,
    ]
  );

  const runRobotMirrorFix = useCallback(async (fixMode: RobotMirrorFixMode) => {
    if (hasSimulationPrepFixActionInFlight || robotMirrorFixAvailability.isLoading) {
      return;
    }
    if (
      fixMode === "orientation-only" &&
      !robotMirrorFixAvailability.value.orientationOnlyAvailable
    ) {
      return;
    }
    if (fixMode === "center-only" && !robotMirrorFixAvailability.value.centerOnlyAvailable) {
      return;
    }
    if (robotMirrorScopeKey) {
      setInertialVisualization((current) =>
        withSimulationPrepInertiaVisualization(
          current,
          robotMirrorVisualizationState.visualizationLinkNames
        )
      );
      setActiveInertiaVisualizationScopeKey(robotMirrorScopeKey);
    }
    setShowHealthActionPanel(true);
    setRobotMirrorOutcome(null);
    setActiveRobotMirrorAction(fixMode);
    setIsRobotMirrorActing(true);
    try {
      const result =
        fixMode === "orientation-only"
          ? await applyRobotMirrorParallelFix({
              meshFiles,
              packageRoots,
              robotMirrorSymmetryCheck,
              selectedLinkNames: selectedRobotMirrorLinkNames,
              selectionLinks: robotMirrorSelectionLinks,
              urdfBasePath,
              urdfContent: vizUrdfContent,
            })
          : applyRobotMirrorSymmetryFix({
              fixMode,
              linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
              orientationMode: "conservative",
              robotMirrorSymmetryCheck,
              selectedLinkNames: selectedRobotMirrorLinkNames,
              selectionLinks: robotMirrorSelectionLinks,
              urdfContent: vizUrdfContent,
            });
      if (result.ok === false) {
        setRobotMirrorOutcome({
          tone: "warning",
          message: result.error,
        });
        toast.error(result.error);
        return;
      }
      await applySimulationPrepUrdfUpdate({
        nextUrdfContent: result.draftUrdfContent,
        robotMirrorOutcome: {
          linkResults: result.linkResults,
          message: result.summary,
          tone: "success",
        },
        successMessage: result.summary,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to auto-align the mirror selection.";
      setRobotMirrorOutcome({
        tone: "warning",
        message,
      });
      toast.error(message);
    } finally {
      setIsRobotMirrorActing(false);
      setActiveRobotMirrorAction(null);
    }
  }, [
    applySimulationPrepUrdfUpdate,
    hasSimulationPrepFixActionInFlight,
    repeatedInertiaSymmetryLinkCentersLocal,
    robotMirrorSelectionLinks,
    robotMirrorFixAvailability,
    robotMirrorScopeKey,
    robotMirrorSymmetryCheck,
    robotMirrorVisualizationState,
    meshFiles,
    packageRoots,
    selectedRobotMirrorLinkNames,
    setActiveInertiaVisualizationScopeKey,
    setInertialVisualization,
    setShowHealthActionPanel,
    urdfBasePath,
    vizUrdfContent,
  ]);
  const handleFixRobotMirrorSymmetry = useCallback(
    async () => runRobotMirrorFix("center-only"),
    [runRobotMirrorFix]
  );
  const handleAlignRobotMirrorOrientation = useCallback(
    async () => runRobotMirrorFix("orientation-only"),
    [runRobotMirrorFix]
  );
  const prepareCollaborationInviteLink = useCallback(
    async ({
      action,
      buildLink,
      errorMessage,
      loadingMessage,
      onShareUrl,
      successMessage,
    }: PrepareCollaborationInviteLinkParams) => {
      if (collaborationInviteActionRef.current) return;
      collaborationInviteActionRef.current = action;
      setCollaborationInviteAction(action);
      const toastId = toast.loading(loadingMessage);
      try {
        const shareUrl = await buildLink();
        const shouldShowSuccess = await onShareUrl(shareUrl, toastId);
        if (shouldShowSuccess) {
          toast.success(successMessage, { id: toastId });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : errorMessage, {
          id: toastId,
        });
      } finally {
        collaborationInviteActionRef.current = null;
        setCollaborationInviteAction(null);
      }
    },
    [],
  );

  const buildCurrentCollaborationShareLink = useCallback(
    (baseUrl: string = window.location.href, access: CollaborationLinkAccess = "viewer") =>
      createCollaborationShareLink({
        access,
        baseUrl,
        label: resolvedRobotName
          ? `${resolvedRobotName} live edit`
          : "URDF Studio live edit",
      }),
    [createCollaborationShareLink, resolvedRobotName],
  );

  const copyCollaborationShareUrl = useCallback(
    async (shareUrl: string, toastId: CollaborationToastId) => {
      if (!navigator.clipboard?.writeText) {
        toast.message("Copy this team invite link", {
          description: shareUrl,
          id: toastId,
        });
        return false;
      }
      await navigator.clipboard.writeText(shareUrl);
      return true;
    },
    [],
  );

  const handleCreateCollaborationLink = useCallback(async (baseUrl?: string, access: CollaborationLinkAccess = "viewer") => {
    const isCreatingRoom = collaborationStatus === "idle";
    await prepareCollaborationInviteLink({
      action: isCreatingRoom ? "creating" : "copying",
      buildLink: () => buildCurrentCollaborationShareLink(baseUrl, access),
      errorMessage: "Failed to prepare the share link.",
      loadingMessage: isCreatingRoom
        ? "Creating a room and copying the link..."
        : "Copying the current share link...",
      onShareUrl: copyCollaborationShareUrl,
      successMessage: isCreatingRoom
        ? `Room created. ${describeCollaborationLinkAccess(access)} link copied.`
        : `${describeCollaborationLinkAccess(access)} link copied.`,
    });
  }, [
    buildCurrentCollaborationShareLink,
    collaborationStatus,
    copyCollaborationShareUrl,
    prepareCollaborationInviteLink,
  ]);
  const handleEmailCollaborationLink = useCallback(
    async (email: string, baseUrl?: string, access: CollaborationLinkAccess = "viewer") => {
      const targetEmail = email.trim();
      if (!targetEmail) {
        toast.error("Enter an email address before sending the invite.");
        return;
      }

      await prepareCollaborationInviteLink({
        action: "emailing",
        buildLink: () => buildCurrentCollaborationShareLink(baseUrl, access),
        errorMessage: "Failed to prepare the email invite.",
        loadingMessage: "Preparing email invite...",
        onShareUrl: async (shareUrl) => {
          const subject = `URDF Studio ${describeCollaborationLinkAccess(access).toLowerCase()} link`;
          const body = `Open this URDF Studio workspace: ${shareUrl}`;
          const encodedEmail = encodeURIComponent(targetEmail);
          const encodedSubject = encodeURIComponent(subject);
          const encodedBody = encodeURIComponent(body);
          window.location.href =
            `mailto:${encodedEmail}?subject=${encodedSubject}&body=${encodedBody}`;
          return true;
        },
        successMessage: "Email draft opened with the share link.",
      });
    },
    [buildCurrentCollaborationShareLink, prepareCollaborationInviteLink],
  );

  const handleResetCollaborationLink = useCallback(async () => {
    await prepareCollaborationInviteLink({
      action: "resetting",
      buildLink: () =>
        rotateCollaborationShareLink({ baseUrl: window.location.href }),
      errorMessage: "Failed to reset the share link.",
      loadingMessage: "Resetting the link and revoking the old one...",
      onShareUrl: copyCollaborationShareUrl,
      successMessage: "New link copied. Old guest links no longer work.",
    });
  }, [
    copyCollaborationShareUrl,
    prepareCollaborationInviteLink,
    rotateCollaborationShareLink,
  ]);

  const handleGoHome = useCallback(() => {
    resetLoadedUrdf();
    clearCameras();
    clearObjects();
    clearGitHubSource();
    clearAssemblySelection();
    clearAssemblyPlacement();
    writeLatestDatasetReviewSessionId(null);
    writeDatasetReviewSnapshot(null);
    workspaceController.setMode("studio");
    setShowUrdfEditor(false);
    setShowHealthActionPanel(false);
    setViewerEpisode(null);
    setIsViewerOpen(false);
    setMotionDataFile(null);
    setRobot(null);
    setRobotBoundingBox(null);
    navigate("/");
  }, [
    clearAssemblyPlacement,
    clearAssemblySelection,
    clearCameras,
    clearGitHubSource,
    clearObjects,
    navigate,
    resetLoadedUrdf,
    setIsViewerOpen,
    setMotionDataFile,
    setRobotBoundingBox,
    setViewerEpisode,
    workspaceController,
  ]);

  const handleOpenDatasetReview = useCallback(() => {
    const sessionId = datasetReviewSessionId ?? readLatestDatasetReviewSessionId();
    const reviewHref = buildUrdfOpsBrowserUrl({
      tab: URDF_OPS_TABS.review,
      reviewSessionId: sessionId,
    });
    window.open(reviewHref, "_blank", "noopener,noreferrer");
  }, [datasetReviewSessionId]);

  const topNavBarProps: PageLayoutProps["topNavBarProps"] = {
    workspaceMode,
    onWorkspaceModeChange: workspaceController.setMode,
    onGoHome: handleGoHome,
    onExportAssemblyUrdf: handleExportAssemblyUrdf,
    showMenus: Boolean(originalUrdfContent && vizUrdfContent),
    openExportDialog,
    onSave: handleSave,
    onRevert: handleRevert,
    canRevert,
    onResetRotation: handleResetRotation,
    hasRotationChanges,
    onCanonicalOrder: handleCanonicalOrder,
    onPrettyPrint: handlePrettyPrint,
    onNormalizeAxes: handleNormalizeAxes,
    onFixMeshPaths: handleFixMeshPaths,
    rotationAxis,
    setRotationAxis,
    onRotateRobot: handleRotateRobot,
    angleUnit,
    setAngleUnit,
    rendererRuntime: workspaceController.rendererRuntime,
    onRendererRuntimeChange: workspaceController.onRendererRuntimeChange,
    rendererRuntimeLocked: workspaceController.rendererRuntimeLocked,
    rendererRuntimeLockedReason: workspaceController.rendererRuntimeLockedReason,
    rosVizRuntimeAvailable: workspaceController.rosVizRuntimeAvailable,
    rosVizRuntimeUnavailableReason: workspaceController.rosVizRuntimeUnavailableReason,
    viewerProfile: workspaceController.viewerProfile,
    onViewerProfileChange: workspaceController.onViewerProfileChange,
    viewerProfileLocked: workspaceController.viewerProfileLocked,
    viewerProfileLockedReason: workspaceController.viewerProfileLockedReason,
    displaysPanelOpen: workspaceController.displaysPanelOpen,
    runtimeHealthPanelOpen: workspaceController.runtimeHealthPanelOpen,
    onToggleDisplaysPanel: workspaceController.onToggleDisplaysPanel,
    onToggleRuntimeHealthPanel: workspaceController.onToggleRuntimeHealthPanel,
    gpuMode,
    setGPUMode,
    collisionsVisible,
    setCollisionsVisible,
    showUrdfEditor,
    setShowUrdfEditor,
    urdfViewMode,
    setUrdfViewMode,
    showPovCameras,
    setShowPovCameras,
    inertialVisualization,
    setInertialVisualization,
    openMappingList,
    datasetActions,
    onValidateCurrentWorldScenePackage: handleValidateCurrentWorldScenePackage,
    onPublishCurrentWorldScenePackage: handlePublishCurrentWorldScenePackage,
    onPublishCurrentWorldScenePackageToHub: worldHubEnabled
      ? handlePublishCurrentWorldScenePackageToHub
      : undefined,
    onExportCurrentWorldScenePackage: handleExportCurrentWorldScenePackage,
    onImportWorldScenePackage: handleImportWorldScenePackage,
    onExportWorldRolloutCampaign: handleExportWorldRolloutCampaign,
    onRunLocalWorldRollout: handleRunLocalWorldRollout,
    onImportWorldRolloutResults: handleImportWorldRolloutResults,
    onOpenWorldRolloutReview: worldRolloutReview
      ? () => setWorldRolloutReviewOpen(true)
      : undefined,
    onExportCurrentWorldSceneLayer: handleExportCurrentWorldSceneLayer,
    onImportSceneLayerFromUrl: handleImportWorldLayoutFromUrl,
    onListWorldScenePackages: handleListWorldScenePackages,
    onOpenWorldHubBrowser: handleOpenWorldHubBrowser,
    openObjectCreator,
    setShowCameraCreator,
    setShowCameraUpload,
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
    isIkPanelOpen,
    onOpenIkPanel: () => setIsIkPanelOpen(true),
    selectedIkSolverId,
    ikSolverOptions,
    onSelectIkSolver: (solverId) => setSelectedIkSolverId(solverId as typeof selectedIkSolverId),
    simulationPrepStatusLabel: simulationPrepStatus.label,
    simulationPrepNeedsAttention: simulationPrepStatus.tone !== "safe",
    onOpenSimulationPrep: openSimulationPrepPanel,
    studioIssueReportUrl: studioIssueReportUrl ?? undefined,
    onOpenTrainingMode: () => {
      window.open(
        buildUrdfOpsBrowserUrl({ tab: URDF_OPS_TABS.experiments }),
        "_blank",
        "noopener,noreferrer",
      );
    },
    onOpenDatasetReview: handleOpenDatasetReview,
    cameraTeleopPanelOpen: teleopPanelOpen && teleopPanelView === "camera",
    leaderInputConnected,
    leaderInputPanelOpen: teleopPanelOpen && teleopPanelView === "studio",
    followerHardwareConnected,
    followerHardwarePanelOpen: teleopPanelOpen && teleopPanelView === "hardware",
    onToggleCameraTeleopPanel: () => toggleTeleopPanelView("camera"),
    onToggleLeaderInputPanel: () => toggleTeleopPanelView("studio"),
    onToggleFollowerHardwarePanel: () => toggleTeleopPanelView("hardware"),
    collaborationOwner,
    collaborationPeerCount,
    collaborationInviteAction,
    collaborationSharingEnabled,
    collaborationStatus,
    onEmailCollaborationLink: handleEmailCollaborationLink,
    onResetCollaborationLink: collaborationOwner
      ? handleResetCollaborationLink
      : undefined,
    onSetCollaborationSharingEnabled: collaborationOwner
      ? setCollaborationSharingEnabled
      : undefined,
    onCreateCollaborationLink: handleCreateCollaborationLink,
  };

  const urdfStatusBannerProps: PageLayoutProps["urdfStatusBannerProps"] = {
    isInvalid: urdfAnalysis?.isValid === false || Boolean(urdfValidationError),
    error: urdfAnalysis?.error ?? urdfValidationError,
    onOpenIssues: () => setShowLoadIssues(true),
  };

  const loadIssuesPanelProps: PageLayoutProps["loadIssuesPanelProps"] = {
    open: showLoadIssues,
    urdfError: urdfValidationError,
    unmatchedURDFRefs,
    absoluteFileMeshRefs,
    missingPackageRefs,
    collisionMeshTotal: collisionMeshStats.total,
    collisionMeshMatched: collisionMeshStats.matched,
    collisionMeshMissing: collisionMeshStats.missing,
    meshRootHints,
    simulationPrepStatusLabel: simulationPrepStatus.tone !== "safe" ? simulationPrepStatus.label : null,
    simulationPrepNeedsAttention: simulationPrepStatus.tone !== "safe",
    onFixMeshPaths: handleFixMeshPaths,
    onOpenSimulationPrep: openSimulationPrepPanel,
    onOpenUrdfEditor: () => setShowUrdfEditor(true),
    onClose: () => setShowLoadIssues(false),
  };

  const shouldShowHealthActionPanel =
    Boolean(robotFrameLint && robotFrameLint.verdict !== "canonical") ||
    inertialIssues.missing.length > 0 ||
    inertialIssues.invalidMass.length > 0 ||
    inertialIssues.invalidTensor.length > 0 ||
    (resolvedPhysicsPlausibilitySummary?.excludedLinks.length ?? 0) > 0 ||
    resolvedPhysicsPlausibilitySummary?.verdict === "mass-too-high" ||
    resolvedPhysicsPlausibilitySummary?.verdict === "mass-too-low" ||
    repeatedInertiaDiagnostics.length > 0 ||
    Boolean(inertialSynthesisSession) ||
    Boolean(bakePreviewSession) ||
    Boolean(canonicalSynthesisPreview);

  const healthActionPanelProps: PageLayoutProps["healthActionPanelProps"] = {
    open: showHealthActionPanel && shouldShowHealthActionPanel,
    onClose: () => setShowHealthActionPanel(false),
    statusTone: simulationPrepStatus.tone,
    statusLabel: simulationPrepStatus.label,
    statusSummary: simulationPrepStatus.summary,
    frameIssueSummary,
    physicsIssueSummary,
    physicsDraftSummary,
    physicsVoxelFallbackLinkNames: inertialSynthesisSummary?.voxelFallbackLinkNames ?? [],
    physicsRepeatedMeshCanonicalizationSummaries:
      inertialSynthesisSession?.synthesis.repeatedMeshCanonicalizationSummaries
        ?.filter((summary) => summary.strategy === "median-consensus")
        .map((summary) => ({
          groupKey: summary.groupKey,
          meshReference: summary.meshReference,
          linkNames: summary.linkNames,
        })) ?? [],
    robotMirrorVisualizationLinkNames:
      robotMirrorVisualizationState.visualizationLinkNames,
    robotMirrorSelectionLinks,
    selectedRobotMirrorLinkNames,
    robotMirrorPlaneTouchingLinkNames,
    robotMirrorSymmetryCheck,
    robotMirrorOutcome,
    repeatedInertiaSymmetryChains: displayedRepeatedInertiaSymmetryChains,
    repeatedInertiaSymmetryCenterMode,
    repeatedInertiaSymmetryOutcomeByChainKey,
    repeatedInertiaDiagnostics,
    repeatedInertiaOutcomeByGroupKey,
    repeatedInertiaResolvedGroupKeys,
    repeatedInertiaActingGroupKey: repeatedInertiaGroupAction?.groupKey ?? null,
    onFixRepeatedInertiaGroup: handleFixRepeatedInertiaGroup,
    repeatedInertiaSymmetryActingChainKey,
    repeatedInertiaSymmetryActingProgress,
    onFixRepeatedInertiaSymmetryChain: handleFixRepeatedInertiaSymmetryChain,
    onFixRobotMirrorSymmetry: handleFixRobotMirrorSymmetry,
    onAlignRobotMirrorOrientation: handleAlignRobotMirrorOrientation,
    isRobotMirrorActing,
    activeRobotMirrorAction,
    isSimulationPrepFixBusy: hasSimulationPrepFixActionInFlight,
    canAlignRobotMirrorOrientation: robotMirrorFixAvailability.value.orientationOnlyAvailable,
    canFixRobotMirrorSymmetry: robotMirrorFixAvailability.value.centerOnlyAvailable,
    isRobotMirrorAvailabilityLoading: robotMirrorFixAvailability.isLoading,
    onRepeatedInertiaSymmetryCenterModeChange: setRepeatedInertiaSymmetryCenterMode,
    activeInertiaVisualizationScopeKey: effectiveInertiaVisualizationScopeKey,
    onToggleInertiaVisualizationScope: handleToggleInertiaVisualizationScope,
    onPreviewInertiaVisualizationScope: handlePreviewInertiaVisualizationScope,
    onClearInertiaVisualizationPreview: handleClearInertiaVisualizationPreview,
    onToggleRobotMirrorSelectionLink: handleToggleRobotMirrorSelectionLink,
    physicsAuditSummary: resolvedPhysicsAuditSummary
      ? {
          totalLinkCount: resolvedPhysicsAuditSummary.totalLinkCount,
          presentLinkCount: resolvedPhysicsAuditSummary.presentLinkCount,
          validLinkCount: resolvedPhysicsAuditSummary.validLinkCount,
          missingLinkCount: resolvedPhysicsAuditSummary.missingLinkCount,
          invalidLinkCount:
            resolvedPhysicsAuditSummary.invalidMassLinkCount +
            resolvedPhysicsAuditSummary.invalidTensorLinkCount,
          repairableLinkCount: resolvedPhysicsAuditSummary.repairableLinkCount,
          totalMassKg: resolvedPhysicsAuditSummary.totalMassKg,
        }
        : null,
    physicsPlausibilitySummary: resolvedPhysicsPlausibilitySummary
      ? {
          verdict: resolvedPhysicsPlausibilitySummary.verdict,
          comparableLinkCount: resolvedPhysicsPlausibilitySummary.comparableLinkCount,
          excludedLinks: resolvedPhysicsPlausibilitySummary.excludedLinks,
          authoredMassKg: resolvedPhysicsPlausibilitySummary.authoredMassKg,
          lightEstimateMassKg: resolvedPhysicsPlausibilitySummary.lightEstimateMassKg,
          heavyEstimateMassKg: resolvedPhysicsPlausibilitySummary.heavyEstimateMassKg,
          warning: resolvedPhysicsPlausibilitySummary.warning,
          offenders: resolvedPhysicsPlausibilitySummary.offenders,
        }
      : null,
    physicsPreflightLoading: isPhysicsPreflightLoading,
    physicsActionStatusByKey,
    onOpenGeneratePhysicsDialog: handleOpenGeneratePhysicsDialog,
    physicsDeltaSummary: inertialMassDeltaSummary
      ? {
          changedLinkCount: inertialMassDeltaSummary.changedLinkCount,
          totalMassBeforeKg: inertialMassDeltaSummary.totalMassBeforeKg,
          totalMassAfterKg: inertialMassDeltaSummary.totalMassAfterKg,
          totalMassDeltaKg: inertialMassDeltaSummary.totalMassDeltaKg,
          largestChanges: inertialMassDeltaSummary.largestChanges,
        }
      : null,
    onGeneratePhysics: handleGeneratePhysicsDraft,
    onGenerateVoxelPhysics: handleGenerateVoxelPhysicsDraft,
    onGenerateRegularizedPhysics: handleGenerateRegularizedPhysicsDraft,
    repairOrientationLabel: canAlignOrientation ? "Fix Frame" : "Export Cleanup",
    repairOrientationSummary: canAlignOrientation
      ? "Align the robot to a stable Z-up frame when the frame policy says it is safe."
      : "Only needed when you want a cleaned canonical export.",
    onRepairOrientation: canAlignOrientation ? handleAlignOrientation : undefined,
    repairOrientationDisabled: false,
    advancedPrimaryActionLabel: canPreviewBakeVisualTransforms
      ? "Create Clean Export Draft"
      : null,
    onRunAdvancedPrimaryAction: canPreviewBakeVisualTransforms
      ? handleCaptureCanonicalSynthesis
      : undefined,
    advancedSecondaryActionLabel: canPreviewBakeVisualTransforms ? "Bake Meshes For Export" : null,
    onRunAdvancedSecondaryAction: canPreviewBakeVisualTransforms
      ? handlePreviewBakeVisualTransforms
      : undefined,
    synthesisRobotName: canonicalSynthesisPreview?.preview.robotName ?? null,
    synthesisRootLinkName: canonicalSynthesisPreview?.preview.rootLinkName ?? null,
    synthesisLinkCount: canonicalSynthesisPreview?.preview.linkCount ?? 0,
    synthesisJointCount: canonicalSynthesisPreview?.preview.jointCount ?? 0,
    synthesisInferredUpLabel: canonicalSynthesisSupportLabel,
    synthesisConfidence: canonicalSynthesisPreview?.preview.supportPlane.confidence ?? null,
    synthesisSupportEvidence: canonicalSynthesisPreview?.preview.supportPlane.evidence ?? null,
    synthesisFallbackReason:
      canonicalSynthesisPreview?.preview.supportPlane.success === false
        ? canonicalSynthesisPreview.preview.supportPlane.fallbackReason
        : null,
    synthesisSampleJoints: canonicalSynthesisPreview?.preview.sampleJoints ?? [],
    onClearSynthesisPreview: canonicalSynthesisPreview
      ? handleClearCanonicalSynthesisPreview
      : undefined,
    stagedEntryCount: bakePreviewStats?.entryCount ?? 0,
    stagedMeshBackedEntryCount: bakePreviewStats?.meshBackedEntryCount ?? 0,
    stagedLinkNames: bakePreviewStats?.linkNames ?? [],
    onClearStagedAction: bakePreviewSession ? handleClearBakePreviewSession : undefined,
    onClearPhysicsDraft: inertialSynthesisSession ? handleClearInertialSynthesisSession : undefined,
  };

  const exportDialogProps: PageLayoutProps["exportDialogProps"] = {
    isOpen: isExportDialogOpen,
    onClose: closeExportDialog,
    urdfContent: getResolvedExportUrdfContent(),
    meshFiles,
    urdfBasePath,
    packageRoots,
    robotName,
    stagedBakeSession: bakePreviewSession,
  };

  const povCamerasOverlayProps: PageLayoutProps["povCamerasOverlayProps"] = {
    open: showPovCameras,
    cameras,
    selectedCameraId,
    onClose: () => setShowPovCameras(false),
  };

  const mappingPanelsProps: PageLayoutProps["mappingPanelsProps"] = {
    showMappingListPanel,
    onCloseMappingList: closeMappingList,
    savedMappings,
    onSelectMapping: selectMapping,
    onDeleteMapping: deleteMappingById,
    mappingDialogData,
    showMappingDialog,
    onCloseMappingDialog: closeMappingDialog,
    availableJoints,
    selectedMapping,
    jointLimits,
    onApplyMapping: applyMapping,
  };

  const creationDialogsProps: PageLayoutProps["creationDialogsProps"] = {
    objectCreatorOpen,
    objectCreatorType,
    openObjectCreator,
    closeObjectCreator,
    robotBoundingBox,
    showCameraCreator,
    setShowCameraCreator,
    availableJoints,
    robot,
    showCameraUpload,
    setShowCameraUpload,
  };

  const { pageLayoutProps, viewerLayoutProps } = useIndexPageLayoutProps({
    isLoading,
    topNavBarProps,
    urdfStatusBannerProps,
    loadIssuesPanelProps,
    healthActionPanelProps,
    exportDialogProps,
    povCamerasOverlayProps,
    mappingPanelsProps,
    creationDialogsProps,
    workspaceMode,
    assemblyInspector,
    assemblyHasPhysicalContact,
    assemblyContactPairCount: assemblyContactPairs.length,
    assemblyProposalRequested,
    onRequestAssemblyProposal: handleRequestAssemblyProposal,
    substitutionSession,
    onApplySubstitution: handleApplySubstitution,
    availableJoints,
    jointLimits,
    jointAxes,
    originalJointAxes,
    originalUrdfContent,
    vizUrdfContent,
    onJointChange: handleJointChange,
    onJointSelect: setSelectedJoint,
    selectedJoint,
    onVizUrdfChange: handleVizUrdfChange,
    onJointAxisChange: handleJointAxisChange,
    onJointOriginChange: handleJointOriginChange,
    onResetAxis: handleResetAxis,
    onJointTypeChange: handleJointTypeChange,
    onJointNameChange: handleJointNameChange,
    onDeleteJoint: handleDeleteJointAndClearSelection,
    deletedJoints,
    getExportUrdfContent: getResolvedExportUrdfContent,
    onMotionDataUpload: handleMotionDataUpload,
    onPlayAnimation: handlePlayAnimation,
    isPlaying,
    motionDataFileName: motionDataFile?.name,
    hasAnimationFrames,
    currentFrame,
    totalFrames,
    sidebarWidth,
    isSidebarCollapsed,
    onToggleSidebarCollapse: handleSidebarToggle,
    meshFiles,
    onCollisionVisibilityChange: setCollisionVisibility,
    rotationPlaneVisible,
    onRotationPlaneVisibilityChange: setRotationPlaneVisible,
    onFrameChange: setCurrentFrame,
    handleFrameChange,
    onFixMissingMeshRefs: handleFixMeshPaths,
    onUrdfEditorToggle: setShowUrdfEditor,
    showUrdfEditor,
    viewerSplitView,
    onViewerSplitViewChange: setViewerSplitView,
    onViewerEpisodeChange: setViewerEpisode,
    onViewerOpenChange: setIsViewerOpen,
    onEpisodeSaveHandlerChange: handleEpisodeSaveHandlerChange,
    episodesViewHeight: sidebarEpisodesViewHeight,
    onEpisodesResizeStart: handleEpisodesResizeStart,
    onDatasetActionsReady: handleDatasetActionsReady,
    onSidebarResizeStart: handleSidebarResizeStart,
    activeWorldSnapshotRef,
    urdfBasePath,
    packageRoots,
    isRightSidebarCollapsed,
    rightSidebarWidth,
    urdfEditorSplitView,
    recordingViewHeight,
    urdfContentVersion,
    assemblyIssueReportUrl,
    assemblyPrimaryModel,
    urdfFile,
    assemblySecondaryModels,
    urdfAnalysis,
    hoveredJoint,
    hoveredLink,
    selectedLink,
    jointValues,
    collisionVisibility,
    collisionsVisible,
    collisionSimplifyLinks,
    collisionMergedLinks,
    inertialVisualization,
    simulationPrepPanelOpen: showHealthActionPanel && shouldShowHealthActionPanel,
    simulationPrepResetPoseRequestKey,
    simulationPrepRobotMirrorVisualization: activeSimulationPrepRobotMirrorVisualization,
    simulationPrepRobotMirrorDeemphasizedLinkNames:
      robotMirrorVisualizationState.deemphasizedVisualizationLinkNames,
    simulationPrepSymmetryVisualization: activeSimulationPrepSymmetryVisualization,
    simulationPrepSymmetryOverlayCenterMode: repeatedInertiaSymmetryCenterMode,
    urdfViewMode,
    endEffectorLink,
    viewerEpisode,
    datasetConstraintSettings:
      datasetActions?.constraintSettings ?? defaultConstraintSettings,
    episodeSaveHandler,
    setUrdfEditorSplitView,
    setUrdfViewMode,
    setMotionDataFile,
    setIsPlaying,
    setHasAnimationFrames,
    setRobotBoundingBox,
    robotBoundingBox,
    robot,
    setRobot,
    onIkApplied: handleIkApplied,
    ikDragSuppressed: false,
    onViewerResizeStart: handleViewerResizeStart,
    onLinkSelect: setSelectedLink,
    onJointHover: setHoveredJoint,
    onLinkHover: setHoveredLink,
    onRobotJointsLoaded: handleRobotJointsLoaded,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    onInertiaReliabilityChange: setInertiaReliability,
    thumbnailMode,
    onDuplicateAssemblyRobot: handleDuplicateAssemblyRobot,
    episodeJointNames,
    availableLinks,
    rightSidebarCollapsed: isRightSidebarCollapsed,
    onJointLimitsChange: handleJointLimitsChange,
    onJointLinkChange: handleJointLinkChange,
    onJointVelocityChange: handleJointVelocityChange,
    onJointEffortChange: handleJointEffortChange,
    angleUnit,
    onAngleUnitChange: setAngleUnit,
    onMaterialChange: handleMaterialChange,
    onLinkNameChange: handleLinkNameChange,
    onCollisionSimplifyLinksChange: setCollisionSimplifyLinks,
    onCollisionMergedLinksChange: setCollisionMergedLinks,
    endEffectorCandidates,
    onMarkAsEndEffector: setEndEffectorLink,
    onGenerateInertialDraft: handleGenerateInertialDraft,
    voxelDerivedInertialLinks: inertialSynthesisSummary?.voxelFallbackLinkNames ?? [],
    onRightSidebarResizeStart: handleRightSidebarResizeStart,
    onToggleRightSidebarCollapse: handleRightSidebarToggle,
  });
  const viewerDraftPreview = useMemo(
    () =>
      resolveViewerDraftPreview({
        baseUrdfFile: urdfFile,
        baseUrdfAnalysis: urdfAnalysis,
        baseVizUrdfContent: vizUrdfContent,
        bakeDraftContent: bakePreviewSession?.stagedContent,
        canonicalDraftContent: canonicalSynthesisPreview?.draftContent,
        inertialDraftContent: inertialSynthesisSession?.draftContent,
        createUrdfFile,
      }),
    [
      bakePreviewSession?.stagedContent,
      canonicalSynthesisPreview?.draftContent,
      createUrdfFile,
      inertialSynthesisSession?.draftContent,
      urdfAnalysis,
      urdfFile,
      vizUrdfContent,
    ]
  );
  const pageLayoutWithViewerDraft = {
    ...pageLayoutProps,
    viewerLayoutProps: {
      ...pageLayoutProps.viewerLayoutProps,
      urdfFile: viewerDraftPreview.urdfFile,
      urdfAnalysis: viewerDraftPreview.urdfAnalysis,
      vizUrdfContent: viewerDraftPreview.vizUrdfContent,
    },
  };

  const { thumbnailViewerProps, runtimePreviewViewerProps } = useIndexViewerProps({
    effectiveRuntimePose,
    viewerLayoutProps: pageLayoutWithViewerDraft.viewerLayoutProps,
  });

  const gatedModeView = (
    <IndexModeGate
      demoMode={DEMO_MODE}
      hasLoadedFiles={hasLoadedFiles}
      isAttachingIluSession={isAttachingIluSession || isAttachingIluAssembly}
      loadFilesFromFolderWithFreshCameras={loadFilesFromFolderWithFreshCameras}
      onImportWorldLayout={handleImportWorldLayoutFromEntry}
      onOpenTrainingMode={() => {
        window.open(
          buildUrdfOpsBrowserUrl({ tab: URDF_OPS_TABS.experiments }),
          "_blank",
          "noopener,noreferrer",
        );
      }}
      onPlayDemoMotion={handlePlayDemoMotion}
      workspaceMode={workspaceMode}
      onWorkspaceModeChange={workspaceController.setMode}
      runtimePreviewMode={runtimePreviewMode}
      runtimePreviewLoadError={runtimePreviewLoadError}
      runtimePreviewViewerProps={runtimePreviewViewerProps}
      thumbnailMode={thumbnailMode}
      thumbnailViewerProps={thumbnailViewerProps}
      urdfContentVersion={urdfContentVersion}
      FolderUploadScreen={FolderUploadScreen}
    />
  );
  if (!hasLoadedFiles || thumbnailMode || runtimePreviewMode) {
    return gatedModeView;
  }
  const ikPanelWidth = Math.min(360, Math.max(220, viewportWidth - 16));
  const preferredIkPanelRightOffset = isRightSidebarCollapsed ? 8 : rightSidebarWidth + 8;
  const maxVisibleIkPanelRightOffset = Math.max(8, viewportWidth - ikPanelWidth - 8);
  const ikPanelRightOffset = Math.min(preferredIkPanelRightOffset, maxVisibleIkPanelRightOffset);

  return (
    <>
      <PageLayout {...pageLayoutWithViewerDraft} />
      {workspaceModeUi.showStudioChrome && teleopPanelMounted ? (
        <Suspense fallback={null}>
          <OperatorTeleopPanelShell
            panelView={teleopPanelView}
            open={teleopPanelOpen}
            studioRobotName={resolvedRobotName}
            collaborationSessionId={collaborationSessionId}
            teleopCapabilityToken={collaborationTeleopCapabilityToken}
            collaborationOwnerToken={collaborationOwnerToken}
            onClose={closeTeleopPanel}
          />
        </Suspense>
      ) : null}
      {workspaceModeUi.showIkPanel && isIkPanelOpen ? (
        <div
          className="fixed z-50 rounded-md border border-border/40 bg-background/95 shadow-lg backdrop-blur-sm"
          style={{
            top: TOP_NAV_HEIGHT + 8,
            right: ikPanelRightOffset,
            width: ikPanelWidth,
            maxHeight: "calc(100vh - 64px)",
          }}
        >
          <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="shrink-0 text-[11px] font-medium text-foreground">IK Solver</div>
              <select
                value={selectedIkSolverId}
                onChange={(event) => setSelectedIkSolverId(event.target.value as typeof selectedIkSolverId)}
                className="h-6 min-w-[130px] rounded border border-border/50 bg-background px-2 text-[10px] text-foreground"
              >
                {ikSolverOptions.map((solver) => (
                  <option key={solver.id} value={solver.id}>
                    {solver.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ml-0.5 text-[8px] font-normal leading-none text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => setIsIkPanelOpen(false)}
                aria-label="Hide IK panel"
                title="Hide panel"
              >
                hide
              </button>
            </div>
          </div>
          <div className="max-h-[calc(100vh-100px)] overflow-y-auto p-2 minimal-scrollbar">
            <Suspense fallback={null}>
              <IkDebuggerPanel
                urdfContent={vizUrdfContent}
                robot={robot}
                endEffectorLink={endEffectorLink}
                robotBoundingBox={robotBoundingBox}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
      {workspaceModeUi.showWorldDialogs ? (
        <Suspense fallback={null}>
          <WorldRegistryPanel
            open={worldRegistryOpen}
            onOpenChange={setWorldRegistryOpen}
            entries={worldRegistryEntries}
            filterText={worldRegistryFilterText}
            onFilterTextChange={setWorldRegistryFilterText}
            loading={worldRegistryLoading}
            onRefresh={refreshWorldRegistry}
            onLoadPackage={handleLoadWorldScenePackageFromRegistry}
            onLoadGeneratedWorldPackage={handleLoadGeneratedWorldScenePackage}
            onPublishGeneratedWorldPackage={handlePublishGeneratedWorldScenePackage}
            gate={resolveFeatureGateAvailability(FEATURE_GATES.worldsRegistry)}
          />
          <WorldPublishDialog
            open={worldPublishDialogOpen}
            onOpenChange={setWorldPublishDialogOpen}
            publishTargetLabel={publishTargetLabel}
            draft={worldPublishDraft}
            onDraftChange={setWorldPublishDraft}
            onSubmit={handleSubmitWorldPublishDialog}
            isSubmitting={isPublishingWorldPackage}
          />
          <WorldSceneImportDialog
            open={worldLayoutImportDialogOpen}
            onOpenChange={setWorldLayoutImportDialogOpen}
            worldLayoutUrl={worldLayoutImportUrlDraft}
            onWorldLayoutUrlChange={setWorldLayoutImportUrlDraft}
            onImportFromLink={handleImportWorldLayoutFromLinkDialog}
            onImportDefaultWorld={handleImportDefaultWorldLayoutFromDialog}
            onImportDemoWorld={handleImportDemoWorldLayoutFromDialog}
            isSubmitting={isImportingWorldLayout}
          />
          <WorldRolloutReviewPanel
            open={worldRolloutReviewOpen}
            result={worldRolloutReview}
            onClose={() => setWorldRolloutReviewOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default Index;
