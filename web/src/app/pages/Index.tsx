import { useState, useCallback, useMemo, startTransition, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  autoComputeCameraPoseDefault,
  remapCameraPoseBetweenParentLinks,
  remapCameraPoseToParentJointFrame,
  resolveCameraParentLinkNameFromJoint,
  resolveCameraParentJointNameFromLink,
  useCameraPanels,
} from "@/features/camera";
import { normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import type { URDFRobot } from "urdf-loader";
import { useUrdfEditHandlers } from "@/features/layout/page/useUrdfEditHandlers";
import { useUrdfUtilityHandlers } from "@/features/layout/page/useUrdfUtilityHandlers";
import { useUrdfMaterialHandlers } from "@/features/layout/page/useUrdfMaterialHandlers";
import { PageLayout, type PageLayoutProps } from "@/features/layout/page/PageLayout";
import type { IkAppliedMetadata } from "@/features/viewer/useIkSolver";
import type { AngleUnit, RotationAxis, UrdfViewMode } from "@/shared/types/feature";
import { useUrdfLoader } from "@/features/urdf/loader/useUrdfLoader";
import { useUrdfSelection } from "@/features/urdf/selection";
import { useUrdfViewer } from "@/features/urdf/viewer";
import { useObjectCreatorStore, useObjectStore } from "@/features/objects";
import { useLayout } from "@/features/layout";
import { useThemeAndGPUMode } from "@/features/theme";
import { useWorkspaceController } from "@/features/workspace/useWorkspaceController";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { DEMO_MODE } from "@/shared/config/demo";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { useGitHubSourceStore } from "@/shared/store/useGitHubSourceStore";
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
import { isWorldHubConfigured } from "@/shared/config/worldHub";
import { parseRobotNameFromUrdf } from "@/app/pages/index/indexPageHelpers";
import { useIndexPageParams } from "@/app/pages/index/useIndexPageParams";
import { useAssemblyWorkspaceState } from "@/app/pages/index/useAssemblyWorkspaceState";
import {
  buildAssemblyExportModels,
  resolveAssemblyExportPrimaryRobotId,
} from "@/app/pages/index/assemblyExportDerivations";
import { useWorldSceneManager, downloadTextDocument } from "@/app/pages/index/useWorldSceneManager";
import { useCameraRuntimeOrchestration } from "@/app/pages/index/useCameraRuntimeOrchestration";
import type { DemoManifestPreferencesLoad } from "@/app/pages/index/useDemoMotionFlow";
import { useIluSessionBridge } from "@/app/pages/index/useIluSessionBridge";
import { useIluAssemblyBridge } from "@/app/pages/index/useIluAssemblyBridge";
import { useIndexPageLayoutProps } from "@/app/pages/index/useIndexPageLayoutProps";
import { useIndexViewerProps } from "@/app/pages/index/useIndexViewerProps";
import { resolveViewerDraftPreview } from "@/app/pages/index/viewerDraftPreview";
import { useWorkspaceTransferLauncher } from "@/app/pages/index/useWorkspaceTransferLauncher";
import { useCameraExportActions } from "@/app/pages/index/useCameraExportActions";
import { CoreFolderUploadScreen } from "@/app/pages/index/CoreFolderUploadScreen";
import { IndexWorldDialogs } from "@/app/pages/index/IndexWorldDialogs";
import { useIndexSourceLoaders } from "@/app/pages/index/useIndexSourceLoaders";
import {
  buildCollisionMeshStats,
  buildInertialIssues,
  buildMeshRootHints,
  hasLoadReviewAttention,
} from "@/app/pages/index/loadReviewDerivations";
import { useLoadReviewPanelController } from "@/app/pages/index/useLoadReviewPanelController";
import { useSimulationPrepViewerHighlights } from "@/app/pages/index/useSimulationPrepViewerHighlights";
import {
  buildMeshFilesCacheKey,
  buildPackageRootsCacheKey,
  collectSynthesizedPhysicsLinkNames,
  formatSignedAxisLabel,
  useInitialCollaborationSession,
  useRepeatedInertiaSymmetryLinkCentersLocal,
  useStudioIssueReportUrl,
  type CanonicalSynthesisPreviewSession,
  type FramePreflightSession,
  type InertialSynthesisSession,
  type PhysicsActionRequest,
  type PhysicsPreflightSession,
  type RepeatedInertiaGroupActionState,
  type RepeatedInertiaGroupOutcome,
  type RepeatedInertiaSymmetryOutcome,
} from "@/app/pages/index/indexPageRuntimeHelpers";
import {
  buildBakeDraftFingerprint,
  buildCanonicalDraftFingerprint,
  buildOrientationReviewState,
  buildPhysicsDraftFingerprint,
} from "@/app/pages/index/simulationPrepDerivations";
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
} from "@/features/layout/page/simulationPrepViewerState";
import { IndexModeGate } from "@/app/pages/index/IndexModeGate";
import { useIluCalibrationFocus } from "@/app/pages/index/useIluCalibrationFocus";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import { useUrdfCollaboration } from "@/features/collaboration/useUrdfCollaboration";
import { useCollaborationInviteActions } from "@/app/pages/index/useCollaborationInviteActions";
import { resolveSubstitutionReplacement } from "@/features/assembly/substitution/substitutionApply";
import { applySubstitutionSubtree } from "@/features/assembly/substitution/substitutionSubtree";
import type { RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";
import {
  buildUrdfBakePreviewStats,
  buildVirtualBakePreview,
  type UrdfBakePreviewSession,
} from "@/features/urdf/bake/virtualBake";
import { captureKinematicState } from "@/features/urdf/synthesis/kinematicSynthesizer";
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
  buildSimulationPrepPhysicsActionStatusMap,
  buildPhysicsDraftSummaryText,
  buildPhysicsIssueSummary,
  buildSimulationPrepStatus,
  canQueueSimulationPrepPhysicsAction,
  resolveSimulationPrepPreflightRequestDecision,
  resolveSimulationPrepPhysicsSourceContent,
  resolveSimulationPrepPreparationRefreshStatus,
  type SimulationPrepPreparationRefreshResult,
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
  const [demoManifestPreferencesLoad, setDemoManifestPreferencesLoad] =
    useState<DemoManifestPreferencesLoad | null>(null);
  const thumbnailMode = thumbnailParams.enabled;
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
  const {
    handleLoadGitHubSource,
    handleLoadUrlSource,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
  } = useIndexSourceLoaders({
    clearCameras,
    clearGitHubSource,
    loadFilesFromFolder,
    loadUrdfText,
    setGitHubSource,
  });
  const [urdfContentVersion, setUrdfContentVersion] = useState<number>(0);
  const markUrdfContentReloaded = useCallback(
    () => setUrdfContentVersion((prev) => prev + 1),
    []
  );
  const handleDemoManifestPreferences = useCallback((load: DemoManifestPreferencesLoad) => {
    setDemoManifestPreferencesLoad({
      activePath: load.activePath,
      preferences: { ...load.preferences },
    });
  }, []);
  const activeDemoManifestPreferences: DemoManifestPreferencesLoad["preferences"] =
    activeUrdfPath && demoManifestPreferencesLoad?.activePath === activeUrdfPath
      ? demoManifestPreferencesLoad.preferences
      : {};
  const suppressDefaultWorldLayoutAutoImport = Boolean(
    activeDemoManifestPreferences.suppressDefaultWorldLayoutAutoImport
  );
  const {
    collaborationOwner,
    collaborationOwnerToken,
    collaborationPeerCount,
    collaborationSharingEnabled,
    collaborationSessionId,
    collaborationStatus,
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
  const { attachedIluSessionId, isAttachingIluSession } = useIluSessionBridge({
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
    setIsPlaying,
    setHasAnimationFrames,
    rotationPlaneVisible,
    collisionsVisible,
    setCollisionsVisible,
    collisionSimplifyLinks,
    setCollisionSimplifyLinks,
    collisionMergedLinks,
    setCollisionMergedLinks,
    collisionVisibility,
    setCollisionVisibility,
    inertialVisualization,
    setInertialVisualization,
    handleFrameChange,
  } = useUrdfViewer();
  const {
    sidebarWidth,
    isSidebarCollapsed,
    rightSidebarWidth,
    isRightSidebarCollapsed,
    leftSidebarTopPanelHeight,
    handleSidebarToggle,
    handleRightSidebarToggle,
    handleSidebarResizeStart,
    handleRightSidebarResizeStart,
    handleLeftSidebarVerticalResizeStart,
  } = useLayout();
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
  const {
    clearSimulationPrepViewerHighlights,
    closeSimulationPrepPanel,
    discardSimulationPrepViewerHighlightSnapshot,
    enableSimulationPrepViewerHighlights,
    openSimulationPrepPanel,
  } = useSimulationPrepViewerHighlights({
    panelOpen: showHealthActionPanel,
    setActiveInertiaVisualizationScopeKey,
    setHoveredInertiaVisualizationPreview,
    setInertialVisualization,
    setShowHealthActionPanel,
    setShowLoadIssues,
    setSimulationPrepResetPoseRequestKey,
  });
  const {
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
  } = useCameraExportActions({ cameras });
  const canRevert = useMemo(
    () => Boolean(savedVizUrdfContent && savedVizUrdfContent !== vizUrdfContent),
    [savedVizUrdfContent, vizUrdfContent],
  );
  const handleSave = useCallback(() => {
    if (!vizUrdfContent) {
      toast.error("No URDF content to save");
      return;
    }
    setSavedVizUrdfContent(vizUrdfContent);
    toast.success("Changes saved");
  }, [setSavedVizUrdfContent, vizUrdfContent]);
  const handleRevert = useCallback(() => {
    if (!savedVizUrdfContent) {
      toast.error("No saved URDF content found");
      return;
    }
    updateUrdfFileWithCollaboration(savedVizUrdfContent);
    toast.success("Reverted to last saved file");
  }, [savedVizUrdfContent, updateUrdfFileWithCollaboration]);
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
    collaborationInviteAction,
    handleCreateCollaborationLink,
    handleEmailCollaborationLink,
    handleResetCollaborationLink,
  } = useCollaborationInviteActions({
    collaborationStatus,
    createShareLink: createCollaborationShareLink,
    resolvedRobotName,
    rotateShareLink: rotateCollaborationShareLink,
  });
  const {
    buildCurrentWorldScenePackageManifest,
    handleExportCurrentWorldSceneLayer,
    handleExportCurrentWorldScenePackage,
    handleImportDefaultWorldLayoutFromDialog,
    handleImportWorldLayoutFromEntry,
    handleImportWorldLayoutFromLinkDialog,
    handleImportWorldLayoutFromUrl,
    handleImportWorkspaceChangeSet,
    handleImportWorldScenePackage,
    handleExportWorldRolloutCampaign,
    handleImportWorldRolloutResults,
    handleListWorldScenePackages,
    handleLoadWorldScenePackageFromRegistry,
    handleOpenWorldHubBrowser,
    handlePublishCurrentWorldScenePackage,
    handlePublishCurrentWorldScenePackageToHub,
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
    getObjectsForTransfer: () => useObjectStore.getState().objects,
    objects,
    originalUrdfContent,
    resolvedRobotName,
    skipDefaultWorldLayoutAutoImportRef,
    suppressDefaultWorldLayoutAutoImport,
    setJointValues,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    vizUrdfContent,
    worldImportParams,
  });
  const { workspaceTransfer } = useWorkspaceTransferLauncher({
    activeUrdfPath,
    attachedIluSessionId,
    buildCurrentWorldScenePackageManifest,
    getWorldObjectCountForTransfer: () => useObjectStore.getState().objects.length,
    meshFiles,
    originalUrdfContent,
    packageRoots,
    vizUrdfContent,
    worldCameraCount: cameras.length,
    worldObjectCount: objects.length,
  });
  const { handleImportDemoWorldLayoutFromDialog, handlePlayDemoMotion } =
    useCameraRuntimeOrchestration({
    activeUrdfPath,
    addCamera,
    addObject,
    availableJoints,
    availableLinks,
    cameras,
    endEffectorLink,
    hasLoadedFiles,
    hydrateDemoAssetsFromFiles: hydrateLoadedAssetsFromFiles,
    jointLimits,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
    onDemoManifestPreferences: handleDemoManifestPreferences,
    playbackHandlers,
    prepareDemoWorldLayoutOnMotion: Boolean(
      activeDemoManifestPreferences.prepareDemoWorldLayoutOnMotion
    ),
    removeCamera,
    removeObject,
    preserveDemoWorldLayoutOnMotion: Boolean(
      activeDemoManifestPreferences.preserveDemoWorldLayoutOnMotion
    ),
    robot,
    robotBoundingBox,
    setIsImportingWorldLayout,
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
    const models = buildAssemblyExportModels({
      activeUrdfPath,
      assemblySelectedRobots,
      fallbackUrdfFileName: urdfFile?.name,
      urdfDocuments,
      vizUrdfContent,
    });

    if (models.length === 0) {
      toast.error("No assembly robots available for export.");
      return;
    }

    try {
      const spec = createAssemblySpec(
        models,
        {
          robotName: "assembled_robot",
          poses: assemblyPoses,
          primaryRobotId: resolveAssemblyExportPrimaryRobotId(assemblySelectedRobots),
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
    isCameraCreatorOpen,
    setIsCameraCreatorOpen,
    isCameraUploadOpen,
    setIsCameraUploadOpen,
    isPovCamerasOverlayOpen,
    setIsPovCamerasOverlayOpen,
  } = useCameraPanels();

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
    void metadata;
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
  const orientationReviewState = useMemo(
    () =>
      buildOrientationReviewState({
        orientationCard,
        robotFrameLint,
      }),
    [orientationCard, robotFrameLint]
  );
  const orientationNeedsAttention = orientationReviewState.needsAttention;
  const orientationSummary = orientationReviewState.summary;
  const orientationStatus = orientationReviewState.status;
  const canAlignOrientation = orientationReviewState.canAlignOrientation;
  const canPreviewBakeVisualTransforms =
    orientationReviewState.canPreviewBakeVisualTransforms;
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
  const refreshSimulationPrepPreparation = useCallback(
    async ({ sourceUrdf }: { sourceUrdf: string }) => {
      const [frameResult, physicsResult] = await Promise.all([
        loadFramePreflight({ force: true, sourceUrdf }),
        loadPhysicsPreflight({ force: true, sourceUrdf }),
      ]);
      const refreshStatus = resolveSimulationPrepPreparationRefreshStatus({
        frameResult: frameResult as SimulationPrepPreparationRefreshResult,
        physicsResult: physicsResult as SimulationPrepPreparationRefreshResult,
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
      const preparationRefresh = await refreshSimulationPrepPreparation({ sourceUrdf: nextUrdfContent });
      const toastPlan = buildSimulationPrepUpdateToastPlan({
        successMessage,
        preparationRefreshStatus: preparationRefresh.status,
      });
      toast.success(toastPlan.successMessage);
      if (toastPlan.followupMessage) {
        toast.error(toastPlan.followupMessage);
      }
    },
    [
      refreshSimulationPrepPreparation,
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
    discardSimulationPrepViewerHighlightSnapshot();
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
  }, [discardSimulationPrepViewerHighlightSnapshot, setInertialVisualization]);

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
  const handleExportCurrentUrdf = useCallback(() => {
    const exportContent = getResolvedExportUrdfContent();
    if (!exportContent) {
      toast.error("No URDF content to export");
      return;
    }

    const safeRobotName =
      (robotName || resolvedRobotName || "robot")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "robot";
    downloadTextDocument(exportContent, `${safeRobotName}.urdf`, "application/xml");
    toast.success("Exported URDF");
  }, [getResolvedExportUrdfContent, resolvedRobotName, robotName]);
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

  const hasRotationChanges = useMemo(
    () => vizUrdfContent !== originalVizUrdfContent,
    [vizUrdfContent, originalVizUrdfContent]
  );

  const meshRootHints = useMemo(() => buildMeshRootHints(debugMeshInfo), [debugMeshInfo]);

  const inertialIssues = useMemo(() => buildInertialIssues(urdfAnalysis), [urdfAnalysis]);
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
      buildPhysicsDraftFingerprint({
        inertialMassDeltaSummary,
        inertialSynthesisSummary,
      }),
    [inertialMassDeltaSummary, inertialSynthesisSummary]
  );
  const bakeDraftFingerprint = useMemo(
    () =>
      buildBakeDraftFingerprint({
        bakePreviewSession,
        entryCount: bakePreviewStats?.entryCount ?? 0,
        linkCount: bakePreviewStats?.linkNames.length ?? 0,
        meshBackedEntryCount: bakePreviewStats?.meshBackedEntryCount ?? 0,
      }),
    [bakePreviewSession, bakePreviewStats]
  );
  const canonicalDraftFingerprint = useMemo(
    () => buildCanonicalDraftFingerprint(canonicalSynthesisPreview),
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

  const collisionMeshStats = useMemo(
    () =>
      buildCollisionMeshStats({
        urdfAnalysis,
        meshFiles,
        urdfBasePath,
        packageRoots,
      }),
    [urdfAnalysis, meshFiles, urdfBasePath, packageRoots]
  );

  const hasLoadReviewAttentionFlag = hasLoadReviewAttention({
    urdfValidationError,
    unmatchedURDFRefs,
    absoluteFileMeshRefs,
    missingPackageRefs,
    inertialIssues,
    collisionMeshStats,
    orientationNeedsAttention,
  });

  useLoadReviewPanelController({
    activeUrdfPath,
    hasLoadedFiles,
    hasLoadReviewAttention: hasLoadReviewAttentionFlag,
    setShowLoadIssues,
    showLoadIssues,
    urdfFile,
  });

  const worldHubEnabled = isWorldHubConfigured();
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

      enableSimulationPrepViewerHighlights(symmetryScopedLinkNames);
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
      enableSimulationPrepViewerHighlights,
      hasSimulationPrepFixActionInFlight,
      repeatedInertiaDiagnostics,
      setRepeatedInertiaSymmetryActingProgress,
      repeatedInertiaSymmetryLinkCentersLocal,
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
      enableSimulationPrepViewerHighlights(robotMirrorVisualizationState.visualizationLinkNames);
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
    enableSimulationPrepViewerHighlights,
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
  const handleGoHome = useCallback(() => {
    resetLoadedUrdf();
    clearCameras();
    clearObjects();
    clearGitHubSource();
    clearAssemblySelection();
    clearAssemblyPlacement();
    workspaceController.setMode("studio");
    setShowUrdfEditor(false);
    closeSimulationPrepPanel();
    setRobot(null);
    setRobotBoundingBox(null);
    navigate("/");
  }, [
    clearAssemblyPlacement,
    clearAssemblySelection,
    clearCameras,
    clearGitHubSource,
    clearObjects,
    closeSimulationPrepPanel,
    navigate,
    resetLoadedUrdf,
    setRobotBoundingBox,
    workspaceController,
  ]);

  const topNavBarProps: PageLayoutProps["topNavBarProps"] = {
    workspaceMode,
    onWorkspaceModeChange: workspaceController.setMode,
    onGoHome: handleGoHome,
    onExportAssemblyUrdf: handleExportAssemblyUrdf,
    showMenus: Boolean(originalUrdfContent && vizUrdfContent),
    openExportDialog: handleExportCurrentUrdf,
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
    isPovCamerasOverlayOpen,
    onOpenPovCamerasOverlay: () => setIsPovCamerasOverlayOpen(true),
    inertialVisualization,
    setInertialVisualization,
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
    onImportWorkspaceChangeSet: handleImportWorkspaceChangeSet,
    onListWorldScenePackages: handleListWorldScenePackages,
    onOpenWorldHubBrowser: handleOpenWorldHubBrowser,
    openObjectCreator,
    onOpenCameraCreator: () => setIsCameraCreatorOpen(true),
    onOpenCameraUpload: () => setIsCameraUploadOpen(true),
    exportCamerasAsJSON,
    exportCamerasAsYAML,
    hasCamerasToExport,
    workspaceLauncherStatusLabel: simulationPrepStatus.label,
    workspaceLauncherNeedsAttention: simulationPrepStatus.tone !== "safe",
    onOpenWorkspaceLauncher: openSimulationPrepPanel,
    studioIssueReportUrl: studioIssueReportUrl ?? undefined,
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

  const healthActionPanelProps: PageLayoutProps["healthActionPanelProps"] = {
    open: showHealthActionPanel,
    onClose: closeSimulationPrepPanel,
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

  const povCamerasOverlayProps: PageLayoutProps["povCamerasOverlayProps"] = {
    open: isPovCamerasOverlayOpen,
    cameras,
    selectedCameraId,
    onClose: () => setIsPovCamerasOverlayOpen(false),
  };

  const creationDialogsProps: PageLayoutProps["creationDialogsProps"] = {
    objectCreatorOpen,
    objectCreatorType,
    openObjectCreator,
    closeObjectCreator,
    robotBoundingBox,
    isCameraCreatorOpen,
    onCameraCreatorOpenChange: setIsCameraCreatorOpen,
    availableJoints,
    robot,
    isCameraUploadOpen,
    onCameraUploadOpenChange: setIsCameraUploadOpen,
  };

  const { pageLayoutProps, viewerLayoutProps } = useIndexPageLayoutProps({
    isLoading,
    topNavBarProps,
    urdfStatusBannerProps,
    loadIssuesPanelProps,
    healthActionPanelProps,
    povCamerasOverlayProps,
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
    availableLinks,
    cameraCount: cameras.length,
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
    sidebarWidth,
    isSidebarCollapsed,
    onToggleSidebarCollapse: handleSidebarToggle,
    meshFiles,
    leftSidebarTopPanelHeight,
    onLeftSidebarVerticalResizeStart: handleLeftSidebarVerticalResizeStart,
    onCollisionVisibilityChange: setCollisionVisibility,
    rotationPlaneVisible,
    handleFrameChange,
    onFixMissingMeshRefs: handleFixMeshPaths,
    onUrdfEditorToggle: setShowUrdfEditor,
    showUrdfEditor,
    onSidebarResizeStart: handleSidebarResizeStart,
    urdfBasePath,
    packageRoots,
    workspaceTransfer,
    isRightSidebarCollapsed,
    rightSidebarWidth,
    urdfEditorSplitView,
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
    simulationPrepPanelOpen: showHealthActionPanel,
    simulationPrepResetPoseRequestKey,
    simulationPrepRobotMirrorVisualization: activeSimulationPrepRobotMirrorVisualization,
    simulationPrepRobotMirrorDeemphasizedLinkNames:
      showHealthActionPanel ? robotMirrorVisualizationState.deemphasizedVisualizationLinkNames : [],
    simulationPrepSymmetryVisualization: activeSimulationPrepSymmetryVisualization,
    simulationPrepSymmetryOverlayCenterMode: repeatedInertiaSymmetryCenterMode,
    urdfViewMode,
    endEffectorLink,
    setUrdfEditorSplitView,
    setUrdfViewMode,
    setIsPlaying,
    setHasAnimationFrames,
    setRobotBoundingBox,
    robotBoundingBox,
    robot,
    setRobot,
    onIkApplied: handleIkApplied,
    ikDragSuppressed: false,
    onLinkSelect: setSelectedLink,
    onJointHover: setHoveredJoint,
    onLinkHover: setHoveredLink,
    onRobotJointsLoaded: handleRobotJointsLoaded,
    updateUrdfFile: updateUrdfFileWithCollaboration,
    onInertiaReliabilityChange: setInertiaReliability,
    thumbnailMode,
    onDuplicateAssemblyRobot: handleDuplicateAssemblyRobot,
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

  const { thumbnailViewerProps } = useIndexViewerProps({
    viewerLayoutProps: pageLayoutWithViewerDraft.viewerLayoutProps,
  });

  const gatedModeView = (
    <IndexModeGate
      demoMode={DEMO_MODE}
      hasLoadedFiles={hasLoadedFiles}
      isAttachingIluSession={isAttachingIluSession || isAttachingIluAssembly}
      loadFilesFromFolderWithFreshCameras={loadFilesFromFolderWithFreshCameras}
      onLoadGitHubSource={handleLoadGitHubSource}
      onLoadUrlSource={handleLoadUrlSource}
      onImportWorldLayout={handleImportWorldLayoutFromEntry}
      onPlayDemoMotion={handlePlayDemoMotion}
      thumbnailMode={thumbnailMode}
      thumbnailViewerProps={thumbnailViewerProps}
      urdfContentVersion={urdfContentVersion}
      FolderUploadScreen={CoreFolderUploadScreen}
    />
  );
  if (!hasLoadedFiles || thumbnailMode) {
    return gatedModeView;
  }
  return (
    <>
      <PageLayout {...pageLayoutWithViewerDraft} />
      <IndexWorldDialogs
        show={workspaceModeUi.showWorldDialogs}
        worldRegistryOpen={worldRegistryOpen}
        onWorldRegistryOpenChange={setWorldRegistryOpen}
        worldRegistryEntries={worldRegistryEntries}
        worldRegistryFilterText={worldRegistryFilterText}
        onWorldRegistryFilterTextChange={setWorldRegistryFilterText}
        worldRegistryLoading={worldRegistryLoading}
        onRefreshWorldRegistry={refreshWorldRegistry}
        onLoadWorldScenePackage={handleLoadWorldScenePackageFromRegistry}
        worldPublishDialogOpen={worldPublishDialogOpen}
        onWorldPublishDialogOpenChange={setWorldPublishDialogOpen}
        publishTargetLabel={publishTargetLabel}
        worldPublishDraft={worldPublishDraft}
        onWorldPublishDraftChange={setWorldPublishDraft}
        onSubmitWorldPublishDialog={handleSubmitWorldPublishDialog}
        isPublishingWorldPackage={isPublishingWorldPackage}
        worldLayoutImportDialogOpen={worldLayoutImportDialogOpen}
        onWorldLayoutImportDialogOpenChange={setWorldLayoutImportDialogOpen}
        worldLayoutImportUrlDraft={worldLayoutImportUrlDraft}
        onWorldLayoutImportUrlDraftChange={setWorldLayoutImportUrlDraft}
        onImportWorldLayoutFromLinkDialog={handleImportWorldLayoutFromLinkDialog}
        onImportDefaultWorldLayoutFromDialog={handleImportDefaultWorldLayoutFromDialog}
        onImportDemoWorldLayoutFromDialog={handleImportDemoWorldLayoutFromDialog}
        isImportingWorldLayout={isImportingWorldLayout}
        worldRolloutReviewOpen={worldRolloutReviewOpen}
        worldRolloutReview={worldRolloutReview}
        onWorldRolloutReviewOpenChange={setWorldRolloutReviewOpen}
      />
    </>
  );
};

export default Index;
