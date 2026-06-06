import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { Camera, CircleHelp, Globe } from "lucide-react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import URDFLoader, { type URDFJoint, type URDFRobot } from "urdf-loader";
import { toast } from "sonner";
import { resolveRobotRootLinkName } from "@/shared/lib/urdfRootLink";
import { useJointStore } from "@/shared/store/useJointStore";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import {
  getPerpendicularDirection as getPerpendicularDirectionFromContract,
  localDirectionFromWorld,
  normalizeDirection,
  projectDirectionOntoPlane,
  projectVectorOntoPlane as projectVectorOntoPlaneFromContract,
  resolveForwardWorldFromWheelAxes,
  worldDirectionFromLocal,
} from "@/shared/lib/axisFrame";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useLinkHighlightStore } from "@/shared/store/useLinkHighlightStore";
import type { Camera as RobotCamera } from "@/shared/types/camera";
import { useRobotPoseStore } from "@/shared/store/useRobotPoseStore";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { WORLD_OBJECT_EDIT_PARAMS } from "@/features/objects/worldObjectEditParams";
import {
  normalizeWorldObjectRotationEuler,
} from "@/features/objects/worldObjectGeometry";
import { resolveWorldObjectGeometry } from "@/features/objects/worldObjectGeometry";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";
import type { Node, Edge } from "reactflow";
import { getJointLimits, type JointAxisMap, type JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import jointColors from "@/shared/joint_colors.json";
import { AxisGizmo3D } from "@/features/viewer/AxisGizmo3D";
import { CustomAxesHelper } from "@/features/viewer/CustomAxesHelper";
import { ViewerFloorPlane, ViewerWorldGrid } from "@/features/viewer/ViewerSceneChrome";
import {
  WorldLabsColliderLayer,
  WorldLabsEnvironmentLayer,
  WorldLabsSplatLayer,
  useWorldLabsPrimarySceneActive,
} from "@/features/viewer/WorldLabsSceneLayers";
import { useWorldLabsSplatGroundProbeStore } from "@/features/viewer/worldLabsSplatGroundProbe";
import {
  applyWorldLabsSplatGroundProbeToRobot,
  resolveWorldLabsSo101DemoTransform,
} from "@/features/viewer/worldLabsSo101DemoTransform";
import { filterVisibleCameraIconConfigs } from "@/features/viewer/viewerCameraIconVisibility";
import {
  resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames,
  type OpenArmDemoTableCalibrationPlane,
} from "@/features/viewer/openArmDemoTableGeometry";
import { resolveOperatorPointCloudSceneMeshes } from "@/features/teleop/perception/operatorPointCloudSceneMeshes";
import { OrbitVisualization } from "@/features/viewer/components/OrbitVisualization";
import { StudioWheelRoleMarkers } from "@/features/viewer/components/StudioWheelRoleMarkers";
import { WorldObjectEditHandles } from "@/features/viewer/components/WorldObjectEditHandles";
import { WorldObjectSelectionOverlay } from "@/features/viewer/components/WorldObjectSelectionOverlay";
import { CameraIcons } from "@/features/camera/CameraIcons";
import {
  getCameraWorldPose,
  resolveCameraParentLinkNameFromJoint,
} from "@/features/camera/cameraWorldPose";
import { computeOwnedLinkLocalVisualCentroid } from "@/features/camera/cameraAutoBounds";
import { IKDragControls } from "@/features/viewer/IKDragControls";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import { cn } from "@/shared/lib/utils";
import { useGPUMode, type GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { MeshFiles } from "@/shared/types/feature";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { API_BASE_URL } from "@/shared/config/api";
import { writeThumbnailRenderState } from "@/app/pages/index/thumbnailRenderState";
import {
  applyRobotBasePose,
  extractLinkPose,
  extractRobotBasePose,
  getDragModeDisplayName,
  resolveJointScalarValue,
  setEmissiveColor,
  type DragMode,
} from "@/features/viewer/viewer-helpers";
import { RESET_RUNTIME_TRACE_MESSAGE_TYPE } from "@/shared/contracts/previewBridge";
import { useIkParamsStore } from "@/features/ik/useIkParamsStore";
import { CollisionGeometries } from "@/features/viewer/CollisionGeometries";
import { RoverApproachGuideLine } from "@/features/viewer/RoverApproachGuideLine";
import { RoverApproachRoutePreview } from "@/features/viewer/RoverApproachRoutePreview";
import { TrackingLine } from "@/features/viewer/TrackingLine";
import { resolveEndEffectorContactObjectId } from "@/features/viewer/eeObjectContact";
import {
  createRoverApproachGuideLineState,
  createRoverApproachRoutePreviewState,
  hideRoverApproachGuideLine,
  hideRoverApproachRoutePreview,
  updateRoverApproachGuideLineToTarget,
} from "@/features/viewer/roverApproachGuideState";
import { useAnimationController, type AnimationController } from "@/features/viewer/useAnimationController";
import {
  useIkSolver,
  type IkAppliedMetadata,
  type IkObjectPreSolveContext,
  type IkObjectPreSolveResult,
} from "@/features/viewer/useIkSolver";
import { useUrdfAnimation } from "@/features/viewer/useUrdfAnimation";
import { useOrbitControlsBindings } from "@/features/viewer/useOrbitControlsBindings";
import { useMotionDataUpload } from "@/features/viewer/useMotionDataUpload";
import { usePlaybackHandlers } from "@/features/viewer/usePlaybackHandlers";
import { useViewerCameraControls } from "@/features/viewer/useViewerCameraControls";
import { usePlaybackNotifications } from "@/features/viewer/usePlaybackNotifications";
import { useViewerWindowBindings } from "@/features/viewer/useViewerWindowBindings";
import { useMeshFilesState } from "@/features/viewer/useMeshFilesState";
import { useRobotBoundingBoxSync } from "@/features/viewer/useRobotBoundingBoxSync";
import { useRobotCameraCentering } from "@/features/viewer/useRobotCameraCentering";
import { useRobotJointSync } from "@/features/viewer/useRobotJointSync";
import { useOperatorLeaderTelemetryBridge } from "@/features/viewer/useOperatorLeaderTelemetryBridge";
import { buildThumbnailCameraFrame } from "@/features/viewer/thumbnailCameraFrame";
import { useUrdfFileContent } from "@/features/viewer/useUrdfFileContent";
import { useDragModeEffects } from "@/features/viewer/useDragModeEffects";
import {
  canUseViewerDragHandleMode,
  canUseViewerLeaderTeleopMode,
  resolveEffectiveViewerDragMode,
  shouldResetPoseAfterLeaderTeleopFallback,
} from "@/features/viewer/viewerDragModePolicy";
import {
  resolveLiveTeleopJointTelemetryByName,
  resolveLiveTeleopJointSyncActive,
  resolveLiveTeleopJointTargets,
} from "@/features/viewer/operatorLiveTeleopJointSync";
import { useOperatorLeaderTeleopStore } from "@/features/teleop/operator-control/operatorLeaderTeleopStore";
import { resolveViewerPartSelection } from "@/features/viewer/viewerPartSelectionPolicy";
import { shouldApplySimulationPrepResetPoseRequest } from "@/features/viewer/simulationPrepResetPosePolicy";
import {
  isLeKiwiRobotAsset,
  isOpenArmRobotAsset,
  resolveRemountPreservedFrameTimestamp,
} from "@/features/viewer/demoRobotPolicy";
import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { recordPlaybackTrace, usePlaybackDebugTrace } from "@/shared/debug/playbackTrace";
import { Button } from "@/shared/ui/button";
import { useDisplayStore } from "@/features/displays/useDisplayStore";
import { useRuntimeHealthStore } from "@/runtime_engine/rosviz/state/runtimeHealthStore";
import { computeCenterOfMassWorld, computeInertialStats, extractLinkInertials } from "@/features/viewer/computeCenterOfMass";
import { DEMO_MODE } from "@/shared/config/demo";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  disposeMeshResources,
  updateMeshMaterialsForGpuMode,
} from "@/features/urdf/mesh/meshDecode";
import { createLinkObjectResolver } from "@/features/viewer/linkObjectResolver";
import { stripMeshSchemes } from "@/shared/lib/urdfBrowser";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaSymmetryCenterMode } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { InertialVisualizationSettings, RobotBasePose } from "@/shared/types/feature";
import {
  InertialVisualization,
  type InertiaReliabilityEntry,
} from "@/features/viewer/InertialVisualization";
import { SimulationPrepSymmetryOverlay } from "@/features/viewer/SimulationPrepSymmetryOverlay";
import { SimulationPrepRobotMirrorOverlay } from "@/features/viewer/SimulationPrepRobotMirrorOverlay";
import {
  SYMMETRY_OVERLAY_LEGEND_ITEMS,
  SYMMETRY_OVERLAY_TOOLTIP_LINES,
} from "@/features/viewer/symmetryVisualizationLegend";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  INERTIA_BOX_OPACITY,
  INERTIA_CENTER_MARKER_COLOR,
  INERTIA_REFERENCE_BOX_COLOR,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
} from "@/features/viewer/inertialVisualizationParams";
import {
  buildSimulationPrepMirrorCameraFrameKey,
  buildSimulationPrepMirrorCameraFrame,
  buildSimulationPrepSymmetryCameraDirection,
  resolveSimulationPrepSymmetryCameraDistance,
} from "@/features/viewer/symmetryCameraFrame";
import { findAutoEndEffectorLinksFromAnalysis } from "@/features/layout/page/utils";
import { createUrdfMeshLoadCallback } from "@/features/urdf/runtime/urdfMeshLoader";
import {
  assertTransformContract,
  getTransformContract,
} from "@/features/urdf/runtime/transformContract";
import { applyUrdfVisualMaterials } from "@/features/urdf/runtime/materialApply";
import { createUrdfVisualMaterialApplyScheduler } from "@/features/urdf/runtime/materialApplyScheduler";
import { URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS } from "@/features/urdf/runtime/materialApplySchedulerParams";
import {
  applyIntrinsicsToPerspectiveCamera,
  normalizeCameraIntrinsics,
} from "@/shared/lib/cameraIntrinsics";
import {
  cameraIntrinsicsClose,
  cameraPoseClose,
} from "@/features/camera/cameraAutoGenerationHelpers";
import type { AssemblySecondaryModel } from "@/features/assembly/types";
import type { WorkspaceMode } from "@/features/workspace/types";
import {
  buildContactPairKey,
  useAssemblyPlacementStore,
} from "@/features/assembly/store/useAssemblyPlacementStore";
import { enforcePlanarBasePose, FLAT_GROUND_HEIGHT_FN } from "@/features/locomotion/safety/planarClamp";
import { isFeatureFlagEnabled, subscribeFeatureFlags } from "@/shared/config/featureFlags";
import { buildMotionPartitions, createMotionKernel } from "@/features/viewer/motion-kernel";
import {
  AdaptiveTrajectoryRuntime,
  createLocalStorageAdaptiveTrajectoryRepository,
} from "@/features/ik/runtime/adaptiveTrajectoryRuntime";
import {
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_MAX_ACCUMULATED_SAMPLES,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_SAMPLE_INTERVAL_MS,
  OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  computeStudioWheelDriveAuthority,
  extractStudioDriveJointHintsFromUrdf,
  getStudioWheelRoleLabel,
  isStudioWheelLikeLabel,
  persistStudioDriveJointHintsToUrdf,
  resolveStudioActiveDriveJointNames,
  toStudioWheelRoleDisplayEntries,
  toSortedUniqueJointNames,
  type StudioWheelRole,
} from "@/features/viewer/studioWheelDriveHeuristics";
import {
  STUDIO_WHEEL_ROLE_DECAY,
  STUDIO_WHEEL_ROLE_EMA_ALPHA,
  STUDIO_WHEEL_ROLE_UI_REFRESH_MS,
  buildStudioWheelRoleEntries,
  detectStudioWheelDriveModel,
  getPreferredStudioDriveWheels,
  getStudioWheelTravelForBodyMotion,
  resolveFallbackWheelRadiusMeters,
  resolveProjectedRobotSpanMeters,
  resolveSafeMotionDimension,
  resolveStudioWheelMarkerAnchorObject,
  resolveWheelCenterWorldFromJointGeometry,
  resolveWheelRadiusFromJointGeometry,
  type StudioWheelDriveModel,
  type StudioWheelRoleDisplayEntry,
  type StudioWheelRoleEntry,
  type StudioWheelRoleMarker,
} from "@/features/viewer/studioWheelDriveModel";
import {
  ROVER_APPROACH_CONFIG,
  ROVER_APPROACH_DETOUR_CONFIG,
  ROVER_APPROACH_NAVIGATION_CONFIG,
  computeSignedPlanarYawErrorRad,
  resolveRoverApproachFootprintSupportRadiusM,
  serializeWorldObjectObstacleSource,
  type RoverApproachRobotFootprint,
} from "@/features/locomotion/approach";
import { isWheelLocomotionAllowed } from "@/features/viewer/wheelLocomotionGate";
import { resolveApproachArmResetJointNames } from "@/features/viewer/approachArmReset";
import {
  resolveIkMotionSafetyAccelerationLimit,
  resolveIkMotionSafetyVelocityLimit,
} from "@/features/viewer/ikMotionSafety";
import {
  executeRoverApproachBeforeIkSolve,
  type StudioWheelDriveState,
} from "@/features/viewer/roverApproachBeforeIkSolve";
import {
  clampWheelPlaybackBodyMotionStep,
  hasObservedWheelTravel,
  resolveWheelPlaybackBodyMotion,
} from "@/features/viewer/playback/wheelPlaybackMotion";
import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";
import { resolveShortestWheelAngleDeltaRad } from "@/features/viewer/playback/wheelAngleDelta";
import { PREVIEW_READ_ONLY_NOTICE_PARAMS } from "@/features/viewer/previewReadOnlyNoticeParams";
import { shouldShowPreviewReadOnlyNotice } from "@/features/viewer/previewReadOnlyNotice";
import {
  isObjectTargetInteractionActive,
  shouldShowRoverApproachGuideForSelectedObject,
  shouldMoveToObjectOnSingleClick,
  shouldMoveToObjectOnRepeatedClick,
  shouldToggleObjectSelectionOnSingleClick,
} from "@/features/viewer/objectTargetClickPolicy";
import {
  buildRepeatedInertiaSymmetryVisualizationScopeKey,
  buildRobotMirrorSymmetryVisualizationScopeKey,
} from "@/features/layout/page/simulationPrepViewerState";
import {
  buildViewerRenderPerformancePolicy,
} from "@/features/viewer/viewerPerformancePolicy";
import { OperatorPointCloudOverlay } from "@/features/teleop/perception/OperatorPointCloudOverlay";
import {
  OperatorPointCloudCalibrationPlanes,
  type OperatorPointCloudCalibrationPlaneOverlay,
} from "@/features/teleop/perception/OperatorPointCloudCalibrationPlanes";
import {
  applyOperatorPointCloudFloorCalibrationToPlane,
  collectOperatorPointCloudWorldSamples,
  resolveOperatorPointCloudDominantSurfaceCalibrationResult,
  type OperatorPointCloudFloorCalibrationByCameraId,
  type OperatorPointCloudWorldSample,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import {
  OPENARM_HF_LIVE_CAMERA_FOV_DEG,
  OPENARM_HF_LIVE_CAMERA_PARENT_JOINT,
} from "@/features/teleop/perception/openArmHfLiveParams";
import { resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose } from "@/features/teleop/perception/openArmHfLiveCameraConfig";
import { useOperatorPerceptionStore } from "@/features/teleop/perception/operatorPerceptionStore";
import { useWorldSceneRuntimeStore } from "@/features/world-share/worldSceneRuntimeStore";
export interface Viewer3DProps {
  workspaceMode?: WorkspaceMode;
  assemblyPrimaryModel?: { id: string; name: string };
  urdfFile: File | null;
  assemblySecondaryModels?: AssemblySecondaryModel[];
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  urdfAnalysis: UrdfAnalysis | null;
  initialMeshFiles?: MeshFiles;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  jointValues?: Record<string, number>;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
   onJointHover?: (jointName: string | null) => void;
   onLinkHover?: (linkName: string | null) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onObjectSelect?: (objectId: string, object: CreatedObject) => void;
  onRobotJointsLoaded?: (
    joints: string[],
    angles: Record<string, number>
  ) => Record<string, number> | void;
  onRobotLoaded?: (robot: URDFRobot | null) => void;
  onMotionDataNodesGenerated?: (nodes: Node[], edges: Edge[]) => void;
  onMotionFileChange?: (file: File | null) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onAnimationFramesChange?: (hasFrames: boolean) => void;
  onFrameChange?: (currentFrame: number, totalFrames?: number) => void;
  collisionVisibility?: CollisionVisibility;
  collisionsVisible?: boolean;
  collisionSimplifyLinks?: string[];
  collisionMergedLinks?: string[];
  rotationPlaneVisible?: boolean;
  inertialVisualization?: InertialVisualizationSettings;
  simulationPrepPanelOpen?: boolean;
  simulationPrepResetPoseRequestKey?: string | null;
  simulationPrepRobotMirrorVisualization?: RobotMirrorSymmetryCheck | null;
  simulationPrepRobotMirrorDeemphasizedLinkNames?: string[] | null;
  simulationPrepSymmetryVisualization?: RepeatedInertiaSymmetryChain | null;
  simulationPrepSymmetryOverlayCenterMode?: RepeatedInertiaSymmetryCenterMode;
  onRobotBoundingBoxChange?: (boundingBox: THREE.Box3 | null) => void;
  endEffectorLink?: string | null;
  onIkApplied?: (
    values: Record<string, number>,
    metadata: IkAppliedMetadata,
  ) => void;
  ikDragSuppressed?: boolean;
  vizUrdfContent?: string;
  onAutoPatchWheelRolesUrdf?: (content: string) => void;
  thumbnailMode?: boolean;
  preferLegacyRuntime?: boolean;
  readOnlyMode?: boolean;
  runtimeRobotBasePose?: RobotBasePose | null;
  enableObjectActionsInReadOnly?: boolean;
  onInertiaReliabilityChange?: (entries: InertiaReliabilityEntry[]) => void;
}

const RUNTIME_HIDDEN_CAMERA_PATTERN = /(wrist|gripper|hand|tool|end[_-]?effector|ee)/i;

const shouldHideCameraInReadOnlyRuntime = (camera: RobotCamera) => {
  const name = `${camera.name} ${camera.parent_joint}`.toLowerCase();
  return RUNTIME_HIDDEN_CAMERA_PATTERN.test(name);
};

const DEFAULT_OBJECT_FRAME_DIRECTION = new THREE.Vector3(1, 1, 0.65).normalize();
const HEX_COLOR_RADIX = 16;
const HEX_COLOR_PAD_LENGTH = 6;

type PointCloudAutocalibrationAccumulator = {
  lastSampledAtMsByCameraId: Map<string, number>;
  requestId: number;
  samplesByCameraId: Map<string, OperatorPointCloudWorldSample[]>;
};
const HEX_COLOR_COMPONENT_MASK = 0xff;

const formatHexColor = (color: number) =>
  `#${color.toString(HEX_COLOR_RADIX).padStart(HEX_COLOR_PAD_LENGTH, "0")}`;

const toRgbaColor = (color: number, alpha: number) => {
  const red = (color >> 16) & HEX_COLOR_COMPONENT_MASK;
  const green = (color >> 8) & HEX_COLOR_COMPONENT_MASK;
  const blue = color & HEX_COLOR_COMPONENT_MASK;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const INERTIA_OVERLAY_TOOLTIP_LINES = [
  "shape fill: green to red based on how well the inertia box proportions fit the reference.",
  "volume outline: compares the authored inertia size against the reference geometry.",
  "center offset: shows the drift from the reference center to the inertia center.",
  "reference geometry: comparison box from collision or mesh geometry.",
  "mismatch: low, moderate, and high severity for shape and volume agreement.",
] as const;

const WORLD_OBJECT_EDIT_MODE_LABELS = {
  move: "Move",
  rotate: "Rotate",
  resize: "Transform",
} as const;

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

const buildSimulationPrepSymmetryLinkNames = (
  chain: RepeatedInertiaSymmetryChain
): string[] =>
  Array.from(
    new Set(chain.branchLinkGroups.flatMap((branchLinkGroup) => branchLinkGroup.linkNames))
  );

const resolveSimulationPrepSymmetryFocusRadius = ({
  chain,
  resolveLinkObject,
}: {
  chain: RepeatedInertiaSymmetryChain;
  resolveLinkObject: ReturnType<typeof createLinkObjectResolver>;
}): number => {
  const bounds = new THREE.Box3();
  const boxCenter = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  let hasBounds = false;

  buildSimulationPrepSymmetryLinkNames(chain).forEach((linkName) => {
    const linkObject = resolveLinkObject(linkName);
    if (!linkObject) {
      return;
    }
    linkObject.updateMatrixWorld(true);
    const linkBounds = new THREE.Box3().setFromObject(linkObject);
    if (linkBounds.isEmpty()) {
      return;
    }
    if (!hasBounds) {
      bounds.copy(linkBounds);
      hasBounds = true;
      return;
    }
    bounds.union(linkBounds);
  });

  if (hasBounds) {
    bounds.getCenter(boxCenter);
    bounds.getSize(boxSize);
    return Math.max(boxSize.length() * 0.5, boxCenter.distanceTo(bounds.max));
  }

  const idealLayerRadii = chain.branchRows.flatMap((row) =>
    row.linkRows
      .map((linkRow) => linkRow.idealLayerRadiusMeters)
      .filter((radius): radius is number => radius !== null)
  );
  const candidateRadius = Math.max(
    chain.maxDistanceDeltaMeters,
    ...(chain.branchRows
      .map((row) => row.idealRadialDistanceMeters ?? row.radialDistanceMeters)
      .filter(Number.isFinite) as number[]),
    ...idealLayerRadii
  );
  return Number.isFinite(candidateRadius) ? candidateRadius : 0;
};

const resolveSimulationPrepRobotMirrorFocusRadius = ({
  check,
  resolveLinkObject,
}: {
  check: RobotMirrorSymmetryCheck;
  resolveLinkObject: ReturnType<typeof createLinkObjectResolver>;
}): number => {
  const bounds = new THREE.Box3();
  const boxCenter = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  let hasBounds = false;

  const focusLinkNames =
    check.centeredLinkNames.length > 0 ? check.centeredLinkNames : check.supportedLinkNames;
  focusLinkNames.forEach((linkName) => {
    const linkObject = resolveLinkObject(linkName);
    if (!linkObject) {
      return;
    }
    linkObject.updateMatrixWorld(true);
    const linkBounds = new THREE.Box3().setFromObject(linkObject);
    if (linkBounds.isEmpty()) {
      return;
    }
    if (!hasBounds) {
      bounds.copy(linkBounds);
      hasBounds = true;
      return;
    }
    bounds.union(linkBounds);
  });

  if (hasBounds) {
    bounds.getCenter(boxCenter);
    bounds.getSize(boxSize);
    return Math.max(boxSize.length() * 0.5, boxCenter.distanceTo(bounds.max));
  }

  return check.maxResidualMeters;
};

const collectSimulationPrepRobotMirrorFocusLinkNames = (
  check: RobotMirrorSymmetryCheck
): string[] => (check.centeredLinkNames.length > 0 ? check.centeredLinkNames : check.supportedLinkNames);

type ViewerCanvasErrorBoundaryProps = {
  children: ReactNode;
};

type ViewerCanvasErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
};

class ViewerCanvasErrorBoundary extends Component<
  ViewerCanvasErrorBoundaryProps,
  ViewerCanvasErrorBoundaryState
> {
  state: ViewerCanvasErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): ViewerCanvasErrorBoundaryState {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown render error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("Viewer3D canvas render failure", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-4 text-center">
          <div className="space-y-2 rounded-md border border-border/50 bg-background p-3 shadow-sm">
            <div className="text-sm font-medium text-foreground">
              3D viewer failed to render
            </div>
            <div className="max-w-[36rem] text-xs text-muted-foreground">
              {this.state.message ?? "Unexpected viewer error"}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={this.handleRetry}
            >
              Retry Viewer
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Component to render orbit visualization
const CreatedObjects = ({
  robot,
  gpuMode = "high",
  endEffectorLink = null,
  onIkTargetClick,
  onObjectSelect,
  orbitDefaults,
  editable = true,
  enableObjectActionsInReadOnly = false,
  onEditDragStateChange,
  allowRetargetOnClick = false,
}: {
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
  endEffectorLink?: string | null;
  onIkTargetClick?: (obj: CreatedObject) => void;
  onObjectSelect?: (objectId: string, object?: CreatedObject) => void;
  editable?: boolean;
  enableObjectActionsInReadOnly?: boolean;
  onEditDragStateChange?: (dragging: boolean) => void;
  allowRetargetOnClick?: boolean;
  orbitDefaults: {
    radius: number;
    inclinationDeg: number;
    phaseDeg: number;
    secondaryOffsetDeg: number;
  };
}) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const objectEditMode = useObjectStore((state) => state.editMode);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const updateOrbitTargetPoint = useObjectStore((state) => state.updateOrbitTargetPoint);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [contactObjectId, setContactObjectId] = useState<string | null>(null);
  const gl = useThree((state) => state.gl);
  const resolveLinkObject = useMemo(() => createLinkObjectResolver(robot), [robot]);
  const endEffectorBoundsBoxRef = useRef(new THREE.Box3());
  const endEffectorSphereRef = useRef(new THREE.Sphere());
  const lastObjectClickRef = useRef<{
    objectId: string;
    timeMs: number;
  } | null>(null);

  useFrame(() => {
    if (!robot || !endEffectorLink) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }
    const endEffectorObject = resolveLinkObject(endEffectorLink);
    if (!endEffectorObject) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorObject.updateMatrixWorld(true);
    endEffectorBoundsBoxRef.current.makeEmpty();
    endEffectorBoundsBoxRef.current.setFromObject(endEffectorObject);
    if (endEffectorBoundsBoxRef.current.isEmpty()) {
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorBoundsBoxRef.current.getBoundingSphere(endEffectorSphereRef.current);
    const nextContactObjectId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: endEffectorSphereRef.current,
      objects,
    });
    setContactObjectId((previous) =>
      previous === nextContactObjectId ? previous : nextContactObjectId
    );
  });

  useEffect(() => {
    const canvas = gl.domElement;
    if (!canvas) return;
    canvas.style.cursor = hoveredObjectId ? "pointer" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [gl, hoveredObjectId]);

  const handleObjectSelection = useCallback(
    (
      objectId: string,
      orbitTargetPoint?: "primary" | "secondary",
      options?: { toggle?: boolean }
    ) => {
      const shouldToggleSelection = options?.toggle !== false;
      if (shouldToggleSelection && selectedObjectId === objectId) {
        setSelectedObject(null);
        return;
      }
      const targetObj = objects.find((object) => object.id === objectId);
      setSelectedObject(objectId);
      if (!targetObj) {
        return;
      }
      if (orbitTargetPoint) {
        updateOrbitTargetPoint(objectId, orbitTargetPoint);
      } else if (targetObj.ikTargetType === "orbit") {
        updateOrbitTargetPoint(objectId, "primary");
      }
      onObjectSelect?.(objectId, targetObj);
    },
    [
      objects,
      onObjectSelect,
      selectedObjectId,
      setSelectedObject,
      updateOrbitTargetPoint,
    ]
  );

  const handleObjectMoveRequest = useCallback(
    (objectId: string, orbitTargetPoint?: "primary" | "secondary") => {
      lastObjectClickRef.current = null;
      handleObjectSelection(objectId, orbitTargetPoint, { toggle: false });
      const lockedTargetObj =
        useObjectStore.getState().objects.find((object) => object.id === objectId) ?? null;
      if (!lockedTargetObj) {
        return;
      }
      onIkTargetClick?.(lockedTargetObj);
    },
    [handleObjectSelection, onIkTargetClick]
  );

  const handleObjectClick = useCallback(
    (e: ThreeEvent<MouseEvent>, objectId: string) => {
      e.stopPropagation();
      const hasIkTargetClickHandler = Boolean(onIkTargetClick);
      const clickTimeMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const previousClick = lastObjectClickRef.current;
      if (
        shouldMoveToObjectOnRepeatedClick({
          hasIkTargetClickHandler,
          selectedObjectId,
          clickedObjectId: objectId,
          clickDetail: e.detail,
          previousClickedObjectId: previousClick?.objectId ?? null,
          previousClickTimeMs: previousClick?.timeMs ?? null,
          clickTimeMs,
        })
      ) {
        lastObjectClickRef.current = null;
        handleObjectMoveRequest(objectId);
        return;
      }
      const canAutoMoveToObject = shouldMoveToObjectOnSingleClick({
        hasIkTargetClickHandler,
        editable,
        enableObjectActionsInReadOnly,
        allowRetargetOnClick,
      });
      if (canAutoMoveToObject) {
        lastObjectClickRef.current = null;
        handleObjectMoveRequest(objectId);
        return;
      }
      lastObjectClickRef.current = {
        objectId,
        timeMs: clickTimeMs,
      };
      handleObjectSelection(objectId, undefined, {
        toggle: shouldToggleObjectSelectionOnSingleClick({
          hasIkTargetClickHandler,
          selectedObjectId,
          clickedObjectId: objectId,
        }),
      });
    },
    [
      allowRetargetOnClick,
      editable,
      enableObjectActionsInReadOnly,
      handleObjectMoveRequest,
      handleObjectSelection,
      onIkTargetClick,
      selectedObjectId,
    ]
  );

  const handlePointerEnter = useCallback(
    (e: ThreeEvent<PointerEvent>, objectId: string) => {
      e.stopPropagation();
      setHoveredObjectId(objectId);
    },
    []
  );

  const handlePointerLeave = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHoveredObjectId(null);
    },
    []
  );


  return (
    <group>
      {objects.filter((obj) => obj.isHidden !== true).map((obj) => {
        const isSelected = selectedObjectId === obj.id;
        const isHovered = hoveredObjectId === obj.id;
        const isContacted = contactObjectId === obj.id;
        const isEmphasized = isSelected || isHovered || isContacted;
        const baseColor = obj.color || "#3b82f6";
        const targetTint = isContacted ? "#f8fafc" : baseColor;
        const hoverEdgeColor = "#67e8f9";
        const contactEdgeColor = "#f8fafc";
        const edgeColor = isContacted ? contactEdgeColor : hoverEdgeColor;
        const maxDim = Math.max(obj.size.x, obj.size.y, obj.size.z);
        const rotationEuler = normalizeWorldObjectRotationEuler(obj.rotation);
        const objectRotation: [number, number, number] = [
          rotationEuler.x,
          rotationEuler.y,
          rotationEuler.z,
        ];
        const comRadius = Math.min(0.028, Math.max(0.007, maxDim * 0.08));
        const pointDisplayRadiusM = WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM * 0.5;
        const comAxisHalfLength = comRadius * 2.8;
        const comCrossPositions = new Float32Array([
          -comAxisHalfLength, 0, 0,
          comAxisHalfLength, 0, 0,
          0, -comAxisHalfLength, 0,
          0, comAxisHalfLength, 0,
          0, 0, -comAxisHalfLength,
          0, 0, comAxisHalfLength,
        ]);

        return (
          <group key={obj.id}>
            {editable && isSelected && (
              <WorldObjectEditHandles
                object={obj}
                mode={objectEditMode}
                onDragStateChange={onEditDragStateChange}
              />
            )}
            {/* Geometry */}
            {obj.type === "point" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <sphereGeometry args={[pointDisplayRadiusM, 18, 12]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.98 : 0.85}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.52 : 0}
                    metalness={0.1}
                    roughness={0.5}
                  />
                </mesh>
                <lineSegments position={[obj.position.x, obj.position.y, obj.position.z]}>
                  <edgesGeometry args={[new THREE.SphereGeometry(pointDisplayRadiusM, 12, 8)]} />
                  <lineBasicMaterial
                    color={isEmphasized ? edgeColor : "#aaaaaa"}
                    linewidth={2}
                  />
                </lineSegments>
              </>
            ) : obj.type === "sphere" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <sphereGeometry args={[obj.size.x * 0.5, 24, 18]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            ) : obj.type === "cylinder" ? (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <cylinderGeometry args={[obj.size.x * 0.5, obj.size.y * 0.5, obj.size.z, 24]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            ) : (
              <>
                <mesh
                  position={[obj.position.x, obj.position.y, obj.position.z]}
                  rotation={objectRotation}
                  onClick={(e) => handleObjectClick(e, obj.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleObjectMoveRequest(obj.id);
                  }}
                  onPointerOver={(e) => handlePointerEnter(e, obj.id)}
                  onPointerMove={(e) => handlePointerEnter(e, obj.id)}
                  onPointerOut={(e) => handlePointerLeave(e)}
                >
                  <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                  <meshStandardMaterial
                    color={targetTint}
                    transparent={true}
                    opacity={isEmphasized ? 0.88 : 0.6}
                    emissive={isEmphasized ? edgeColor : "#000000"}
                    emissiveIntensity={isEmphasized ? 0.42 : 0}
                  />
                </mesh>
              </>
            )}

            {/* Object center-of-mass marker */}
            {obj.source !== "runtime-restricted-area" && (
              <group position={[obj.position.x, obj.position.y, obj.position.z]}>
                <mesh raycast={() => null}>
                  <sphereGeometry args={[comRadius, 14, 10]} />
                  <meshBasicMaterial
                    color="#ff63d5"
                    transparent
                    opacity={isEmphasized ? 0.42 : 0.3}
                    depthWrite={false}
                  />
                </mesh>
                <lineSegments raycast={() => null} renderOrder={950}>
                  <bufferGeometry>
                    <bufferAttribute
                      attach="attributes-position"
                      count={6}
                      array={comCrossPositions}
                      itemSize={3}
                    />
                  </bufferGeometry>
                  <lineBasicMaterial
                    color="#ff63d5"
                    transparent
                    opacity={isEmphasized ? 0.5 : 0.34}
                    depthTest={false}
                    depthWrite={false}
                  />
                </lineSegments>
              </group>
            )}

            {/* Distance visualization line - points to tracked joint center or closest robot point */}
            {robot &&
              endEffectorLink &&
              obj.source !== "runtime-trajectory" &&
              obj.source !== "runtime-restricted-area" &&
              (obj.trackedJointName || endEffectorLink) && (
              <TrackingLine
                cubePos={obj.position}
                robot={robot}
                trackedJointName={obj.trackedJointName || null}
                endEffectorLink={endEffectorLink}
                gpuMode={gpuMode}
              />
            )}

            {/* Orbit visualization for orbit IK mode */}
            {obj.ikTargetType === "orbit" && (
              <OrbitVisualization
                centerPosition={obj.position}
                radius={obj.orbitRadius ?? orbitDefaults.radius}
                inclination={obj.orbitInclination ?? orbitDefaults.inclinationDeg}
                phase={obj.orbitPhase ?? orbitDefaults.phaseDeg}
                secondaryPhaseOffsetDeg={
                  obj.orbitSecondaryOffset ?? orbitDefaults.secondaryOffsetDeg
                }
                color={targetTint}
                onPrimaryOrbitClick={() => {
                  handleObjectSelection(obj.id, "primary");
                }}
                onPrimaryOrbitDoubleClick={() => {
                  handleObjectMoveRequest(obj.id, "primary");
                }}
                onSecondaryOrbitClick={() => {
                  handleObjectSelection(obj.id, "secondary");
                }}
                onSecondaryOrbitDoubleClick={() => {
                  handleObjectMoveRequest(obj.id, "secondary");
                }}
              />
            )}
          </group>
        );
      })}
      </group>
    );
  };

  const IKResultDialog = ({
    open,
    running,
    error,
    result,
    targetName,
    isOrbitTarget,
    onClose,
    onFollowOrbit,
  }: {
    open: boolean;
    running: boolean;
    error: string | null;
    result: IkResponsePayload | null;
    targetName: string | null;
    isOrbitTarget: boolean;
    onClose: () => void;
    onFollowOrbit?: () => void;
  }) => {
    if (!open) return null;

    return (
      <div className="fixed top-4 right-4 z-40 w-96 rounded-lg border border-border bg-background/95 shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">IK Solution</span>
          {targetName && (
            <span className="text-[11px] text-muted-foreground">Target: {targetName}</span>
            )}
          </div>
          <button
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-3 space-y-2">
          {running && (
            <div className="text-[12px] text-muted-foreground">Solving IK...</div>
          )}
          {error && (
            <div className="text-[12px] text-destructive">{error}</div>
          )}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Validity</div>
                  <div className="font-semibold">{result.diagnostics.validity}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Stability</div>
                  <div className="font-semibold">{result.diagnostics.stability}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Degeneracy</div>
                  <div className="font-semibold">{result.diagnostics.degeneracy}</div>
                </div>
                <div className="p-2 rounded border border-border/60">
                  <div className="text-[11px] text-muted-foreground">Branch</div>
                  <div className="font-semibold">
                    {result.diagnostics.branch_maybe ? "Possible switch" : "Likely expected"}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                {result.diagnostics.branch_message}
              </div>

              <div className="text-[11px] text-muted-foreground">
                Cost: {result.diagnostics.cost.toFixed(5)} | Iterations: {result.diagnostics.iterations} | λ:{" "}
                {result.diagnostics.lambda_final.toFixed(3)} | Termination: {result.diagnostics.termination_reason}
              </div>

              <div className="max-h-40 overflow-y-auto border border-border/50 rounded">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-muted-foreground/80">
                      <th className="px-2 py-1 font-normal">Joint</th>
                      <th className="px-2 py-1 font-normal">Value (rad)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.solution).map(([joint, value]) => (
                      <tr key={joint} className="odd:bg-muted/30">
                        <td className="px-2 py-1 whitespace-nowrap">{joint}</td>
                        <td className="px-2 py-1 font-mono">{value.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Dismiss
                </Button>
                {isOrbitTarget && onFollowOrbit && (
                  <Button size="sm" variant="default" onClick={onFollowOrbit}>
                    Follow Orbit
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

const URDFModel = ({
  file,
  workspaceMode = "studio",
  assemblyPrimaryModel,
  urdfBasePath,
  packageRoots,
  urdfAnalysis,
  meshFiles,
  animationFrames,
  isPlaying,
  secondaryModels = [],
  onRobotLoaded,
  onRobotReadyChange,
  selectedJoint,
  selectedLink,
  onSelectPart,
  onJointChange,
  onDragActiveChange,
  onWheelLocomotionIntent,
  onStudioBaseDragStart,
  onStudioBaseDragEnd,
  onFrameChange,
  onPlaybackEnd,
  jointLimits,
  jointAxes,
  gpuMode = "high",
  playbackSpeed = 1.0,
  rotationPlaneVisible = false,
  dragMode = "move-joints",
  wheelDriveEnabled = true,
  wheelDriveJointOverrides,
  studioDriveJointHints,
  animationController,
  thumbnailMode = false,
  resolveThumbnailFrontWorldDirection,
  resolveThumbnailUpWorld,
  controlsRef,
  cameraRef,
  rendererDomRef,
  activeWorldScenePackageId = null,
  readOnlyMode = false,
  onReadOnlyInteractionAttempt,
}: {
  file: File;
  workspaceMode?: WorkspaceMode;
  assemblyPrimaryModel?: { id: string; name: string };
  secondaryModels?: AssemblySecondaryModel[];
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  urdfAnalysis: UrdfAnalysis | null;
  meshFiles: MeshFiles;
  animationFrames: AnimationFrame[] | null;
  isPlaying: boolean;
  onRobotLoaded: (robot: URDFRobot | null) => void;
  onRobotReadyChange?: (ready: boolean) => void;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  onSelectPart?: (payload: {
    robotId?: string;
    linkName?: string;
    jointName?: string | null;
  }) => void;
  onJointChange?: (jointName: string, value: number) => void;
  onDragActiveChange?: (active: boolean) => void;
  onWheelLocomotionIntent?: () => void;
  onStudioBaseDragStart?: () => void;
  onStudioBaseDragEnd?: () => void;
  onFrameChange?: (frameIndex: number, totalFrames?: number) => void;
  onPlaybackEnd?: (frameIndex: number) => void;
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  gpuMode?: GPUMode;
  playbackSpeed?: number;
  rotationPlaneVisible?: boolean;
  dragMode?: DragMode;
  wheelDriveEnabled?: boolean;
  wheelDriveJointOverrides: Record<string, boolean>;
  studioDriveJointHints?: ReadonlySet<string>;
  animationController: AnimationController;
  thumbnailMode?: boolean;
  resolveThumbnailFrontWorldDirection: () => THREE.Vector3;
  resolveThumbnailUpWorld: () => THREE.Vector3;
  controlsRef: { current: OrbitControlsImpl | null };
  cameraRef: { current: THREE.PerspectiveCamera | null };
  rendererDomRef: { current: HTMLCanvasElement | null };
  activeWorldScenePackageId?: string | null;
  readOnlyMode?: boolean;
  onReadOnlyInteractionAttempt?: () => void;
}) => {
  type AssemblyMeshProxy = {
    mesh: THREE.Mesh;
    localBounds: THREE.Box3;
  };
  type AssemblyWheelJoint = {
    jointName: string;
    joint: URDFJoint;
    axisLocal: THREE.Vector3;
    radius: number;
    directionSign: number;
  };
  type AssemblyWheelProfile = {
    forwardLocal: THREE.Vector3;
    wheels: AssemblyWheelJoint[];
  };
  type AssemblyPlacementRobot = {
    id: string;
    robot: URDFRobot;
    radius: number;
    halfExtentX: number;
    halfExtentZ: number;
    meshProxies: AssemblyMeshProxy[];
    wheelProfile: AssemblyWheelProfile | null;
  };
  type AssemblyContactMetric = {
    dx: number;
    dz: number;
    distance: number;
    targetDistance: number;
    gap: number;
    absGap: number;
    targetX: number;
    targetZ: number;
    axisMode: "x" | "z" | "free";
    meshGap: number;
  };

  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  const isAssemblyWorkspace = workspaceModeUi.isAssembly;
  const thumbnailWorldObjects = useObjectStore((state) => state.objects);
  const sceneGroupRef = useRef<THREE.Group>(null);
  const robotGroupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const worldLabsSplatGroundingKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [robotReady, setRobotReady] = useState(false);
  const meshAbortRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const gpuModeRef = useRef(gpuMode);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const worldLabsSplatGroundProbe = useWorldLabsSplatGroundProbeStore(
    (state) => state.groundProbe
  );
  const assemblyStoredPoses = useAssemblyPlacementStore((state) => state.poses);
  const setAssemblyPoses = useAssemblyPlacementStore((state) => state.setPoses);
  const setAssemblyRadii = useAssemblyPlacementStore((state) => state.setRadii);
  const setAssemblySelectedRobotId = useAssemblyPlacementStore((state) => state.setSelectedRobotId);
  const setAssemblyContactPairs = useAssemblyPlacementStore((state) => state.setContactPairs);
  const assemblyRobotsRef = useRef<AssemblyPlacementRobot[]>([]);
  const draggingAssemblyRef = useRef<{
    robotId: string;
    robot: URDFRobot;
    startPoint: THREE.Vector3;
    startPosition: THREE.Vector3;
    lockedOtherId: string | null;
  } | null>(null);
  const draggingStudioBaseRef = useRef<{
    robot: URDFRobot;
    wheelModel: StudioWheelDriveModel | null;
    startPoint: THREE.Vector3;
    startPosition: THREE.Vector3;
  } | null>(null);
  const wheelDriveClampDiagnosticsRef = useRef<{
    nonPlanarClampCount: number;
    lastClampReason: "y" | "roll" | "pitch" | "mixed" | null;
  }>({
    nonPlanarClampCount: 0,
    lastClampReason: null,
  });
  useUrdfAnimation({
    animationFrames,
    robotRef,
    isPlaying,
    playbackSpeed,
    storeJointValues,
    setStoreJointValues,
    onFrameChange,
    onPlaybackEnd,
    animationController,
  });

  useEffect(() => {
    gpuModeRef.current = gpuMode;
  }, [gpuMode]);

  useEffect(() => {
    if (wheelDriveEnabled) return;
    const activeDrag = draggingStudioBaseRef.current;
    if (activeDrag) {
      activeDrag.robot.userData.__studioBaseDragging = false;
      draggingStudioBaseRef.current = null;
      animationController.setManualDragActive(false);
      onDragActiveChange?.(false);
    }
    const robot = robotRef.current;
    const activeJoint = draggingJointRef.current;
    if (robot && activeJoint) {
      const joint = robot.joints?.[activeJoint];
      const jointLabel = joint
        ? [
            activeJoint,
            joint.parent?.name ?? "",
            ...(joint.children ?? []).map((child) => child.name || ""),
          ].join(" ")
        : activeJoint;
      if (isStudioWheelLikeLabel(jointLabel)) {
        draggingJointRef.current = null;
        lastPointerRef.current = null;
        dragStartRef.current = null;
        setIsDragging(false);
        animationController.setManualDragActive(false);
        onDragActiveChange?.(false);
      }
    }
    if (robotRef.current) {
      robotRef.current.userData.__studioBaseDragging = false;
    }
  }, [animationController, wheelDriveEnabled, onDragActiveChange]);

  const isUrdfValid = urdfAnalysis?.isValid ?? false;
  const urdfValidationError = urdfAnalysis?.error ?? null;

  const clearGroup = useCallback(() => {
    if (!robotGroupRef.current) return;
    while (robotGroupRef.current.children.length > 0) {
      const child = robotGroupRef.current.children[0];
      disposeMeshResources(child);
      robotGroupRef.current.remove(child);
    }
    robotRef.current = null;
    worldLabsSplatGroundingKeyRef.current = null;
    assemblyRobotsRef.current = [];
    setRobotReady(false);
  }, []);

  const applyWorldLabsSplatGrounding = useCallback(
    (targetRobot: URDFRobot): boolean => {
      if (!worldLabsSplatGroundProbe) {
        return false;
      }
      const groundingKey = `${worldLabsSplatGroundProbe.packageId}:${targetRobot.uuid}`;
      if (worldLabsSplatGroundingKeyRef.current === groundingKey) {
        return false;
      }

      const result = applyWorldLabsSplatGroundProbeToRobot({
        activePackageId: activeWorldScenePackageId,
        groundProbe: worldLabsSplatGroundProbe,
        robot: targetRobot,
      });
      if (!result.applied) {
        return false;
      }

      worldLabsSplatGroundingKeyRef.current = groundingKey;
      return true;
    },
    [activeWorldScenePackageId, worldLabsSplatGroundProbe]
  );

  const collectAssemblyMeshProxies = useCallback((robot: URDFRobot): AssemblyMeshProxy[] => {
    const proxies: AssemblyMeshProxy[] = [];
    robot.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!geometry) return;
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }
      if (!geometry.boundingBox) return;
      proxies.push({
        mesh,
        localBounds: geometry.boundingBox.clone(),
      });
    });
    return proxies;
  }, []);

  const detectAssemblyWheelProfile = useCallback((robot: URDFRobot): AssemblyWheelProfile | null => {
    const joints = Object.entries(robot.joints ?? {});
    const wheelCandidates: AssemblyWheelJoint[] = [];
    const measuredRadiiMeters: number[] = [];
    const wheelCenters: THREE.Vector3[] = [];

    joints.forEach(([jointName, joint]) => {
      const jointType = String((joint as { jointType?: string }).jointType ?? "").toLowerCase();
      if (jointType !== "continuous" && jointType !== "revolute") return;

      const childNames = (joint.children ?? [])
        .map((child) => child.name || "")
        .join(" ");
      const jointLabel = `${jointName} ${childNames}`;
      if (!isStudioWheelLikeLabel(jointLabel)) return;

      let axisLocal = new THREE.Vector3(0, 1, 0);
      const jointAxis = (joint as { axis?: THREE.Vector3 }).axis;
      if (jointAxis instanceof THREE.Vector3 && jointAxis.lengthSq() > 1e-10) {
        axisLocal = jointAxis.clone().normalize();
      }

      const measuredRadiusMeters = resolveWheelRadiusFromJointGeometry(joint);
      if (isFinitePositiveMotionDimension(measuredRadiusMeters)) {
        measuredRadiiMeters.push(measuredRadiusMeters);
      }
      const wheelCenterWorld = resolveWheelCenterWorldFromJointGeometry(joint);
      if (wheelCenterWorld) {
        wheelCenters.push(wheelCenterWorld);
      }

      wheelCandidates.push({
        jointName,
        joint,
        axisLocal,
        radius: measuredRadiusMeters ?? Number.NaN,
        directionSign: 1,
      });
    });

    if (wheelCandidates.length === 0) return null;
    const fallbackRadiusMeters = resolveFallbackWheelRadiusMeters({
      robot,
      wheelCenters,
      measuredRadiiMeters,
    });
    wheelCandidates.forEach((wheel) => {
      wheel.radius = isFinitePositiveMotionDimension(wheel.radius)
        ? wheel.radius
        : fallbackRadiusMeters;
    });

    const averageAxisWorld = new THREE.Vector3();
    wheelCandidates.forEach((wheel) => {
      const worldAxis = worldDirectionFromLocal(wheel.axisLocal, robot.quaternion);
      averageAxisWorld.add(worldAxis);
    });
    const worldUp = new THREE.Vector3(0, 1, 0);
    const forwardWorld = resolveForwardWorldFromWheelAxes(
      averageAxisWorld,
      worldUp,
      worldDirectionFromLocal(new THREE.Vector3(1, 0, 0), robot.quaternion)
    );
    const forwardLocal = projectDirectionOntoPlane(
      localDirectionFromWorld(forwardWorld, robot.quaternion),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0)
    );

    return {
      forwardLocal,
      wheels: wheelCandidates,
    };
  }, []);

  const getAssemblyForwardWorld = useCallback((entry: AssemblyPlacementRobot): THREE.Vector3 | null => {
    const profile = entry.wheelProfile;
    if (!profile || profile.wheels.length === 0) return null;
    const forward = projectDirectionOntoPlane(
      worldDirectionFromLocal(profile.forwardLocal, entry.robot.quaternion),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0)
    );
    return forward;
  }, []);

  const applyWheelRollForWorldDelta = useCallback(
    (entry: AssemblyPlacementRobot, deltaX: number, deltaZ: number) => {
      const profile = entry.wheelProfile;
      if (!profile || profile.wheels.length === 0) return;
      const forward = getAssemblyForwardWorld(entry);
      if (!forward) return;
      const travel = deltaX * forward.x + deltaZ * forward.z;
      if (Math.abs(travel) <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon) return;

      profile.wheels.forEach((wheel) => {
        const radius = resolveSafeMotionDimension(wheel.radius);
        const current = resolveJointScalarValue(wheel.joint) ?? 0;
        wheel.joint.setJointValue(current - (travel / radius) * wheel.directionSign);
      });
      entry.robot.updateMatrixWorld(true);
    },
    [getAssemblyForwardWorld]
  );

  const computeMeshContactGap = useCallback(
    (lhs: AssemblyPlacementRobot, rhs: AssemblyPlacementRobot): number => {
      const rhsBoxes = rhs.meshProxies.map((proxy) =>
        proxy.localBounds.clone().applyMatrix4(proxy.mesh.matrixWorld)
      );
      if (rhsBoxes.length === 0) return Number.POSITIVE_INFINITY;
      let minGap = Number.POSITIVE_INFINITY;
      lhs.meshProxies.forEach((lhsProxy) => {
        const lhsBox = lhsProxy.localBounds.clone().applyMatrix4(lhsProxy.mesh.matrixWorld);
        rhsBoxes.forEach((rhsBox) => {
          const dx = Math.max(lhsBox.min.x - rhsBox.max.x, rhsBox.min.x - lhsBox.max.x, 0);
          const dy = Math.max(lhsBox.min.y - rhsBox.max.y, rhsBox.min.y - lhsBox.max.y, 0);
          const dz = Math.max(lhsBox.min.z - rhsBox.max.z, rhsBox.min.z - lhsBox.max.z, 0);
          const gap = Math.hypot(dx, dy, dz);
          if (gap < minGap) {
            minGap = gap;
          }
        });
      });
      return minGap;
    },
    []
  );

  const computeDirectionalFootprintSupport = useCallback(
    (entry: AssemblyPlacementRobot, dirX: number, dirZ: number): number => {
      if (entry.meshProxies.length === 0) {
        const yaw = entry.robot.rotation.y;
        const cos = Math.cos(-yaw);
        const sin = Math.sin(-yaw);
        const localX = dirX * cos - dirZ * sin;
        const localZ = dirX * sin + dirZ * cos;
        return Math.abs(localX) * entry.halfExtentX + Math.abs(localZ) * entry.halfExtentZ;
      }
      const robotPosition = entry.robot.position;
      let support = 0;
      entry.meshProxies.forEach((proxy) => {
        const worldBox = proxy.localBounds.clone().applyMatrix4(proxy.mesh.matrixWorld);
        const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
        const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
        const halfX = (worldBox.max.x - worldBox.min.x) * 0.5;
        const halfZ = (worldBox.max.z - worldBox.min.z) * 0.5;
        const projectedCenter = (centerX - robotPosition.x) * dirX + (centerZ - robotPosition.z) * dirZ;
        const projectedHalf = Math.abs(dirX) * halfX + Math.abs(dirZ) * halfZ;
        support = Math.max(support, projectedCenter + projectedHalf);
      });
      return Math.max(support, 0.01);
    },
    []
  );

  const computeAssemblyContactMetric = useCallback(
    (lhs: AssemblyPlacementRobot, rhs: AssemblyPlacementRobot): AssemblyContactMetric => {
      lhs.robot.updateMatrixWorld(true);
      rhs.robot.updateMatrixWorld(true);
      const rawDx = lhs.robot.position.x - rhs.robot.position.x;
      const rawDz = lhs.robot.position.z - rhs.robot.position.z;
      const baseDistance = Math.hypot(rawDx, rawDz);
      const fallbackX = Math.cos(lhs.robot.rotation.y);
      const fallbackZ = Math.sin(lhs.robot.rotation.y);
      const safeSign = (value: number, fallback: number) => {
        if (Math.abs(value) > 1e-6) return value > 0 ? 1 : -1;
        return fallback >= 0 ? 1 : -1;
      };
      let dirX = baseDistance > 1e-6 ? rawDx / baseDistance : safeSign(rawDx, fallbackX);
      let dirZ = baseDistance > 1e-6 ? rawDz / baseDistance : safeSign(rawDz, fallbackZ);
      let axisMode: "x" | "z" | "free" = "free";
      const absDx = Math.abs(rawDx);
      const absDz = Math.abs(rawDz);
      if (
        absDz <= ASSEMBLY_AXIS_SNAP_TOLERANCE_M ||
        (absDz <= ASSEMBLY_AXIS_ASSIST_RANGE_M && absDz < absDx * 0.22)
      ) {
        dirX = safeSign(rawDx, fallbackX);
        dirZ = 0;
        axisMode = "x";
      } else if (
        absDx <= ASSEMBLY_AXIS_SNAP_TOLERANCE_M ||
        (absDx <= ASSEMBLY_AXIS_ASSIST_RANGE_M && absDx < absDz * 0.22)
      ) {
        dirX = 0;
        dirZ = safeSign(rawDz, fallbackZ);
        axisMode = "z";
      }
      const lhsSupport = computeDirectionalFootprintSupport(lhs, dirX, dirZ);
      const rhsSupport = computeDirectionalFootprintSupport(rhs, -dirX, -dirZ);
      const targetDistance = lhsSupport + rhsSupport;
      const distance = axisMode === "x" ? absDx : axisMode === "z" ? absDz : baseDistance;
      const estimatedGap = distance - targetDistance;
      let meshGap = Number.POSITIVE_INFINITY;
      if (baseDistance <= lhs.radius + rhs.radius + ASSEMBLY_MESH_CONTACT_DISTANCE_LIMIT_M) {
        meshGap = computeMeshContactGap(lhs, rhs);
      }
      const gap = Number.isFinite(meshGap) ? meshGap : estimatedGap;
      return {
        dx: rawDx,
        dz: rawDz,
        distance,
        targetDistance,
        gap,
        absGap: Math.abs(gap),
        targetX: rhs.robot.position.x + dirX * targetDistance,
        targetZ: rhs.robot.position.z + dirZ * targetDistance,
        axisMode,
        meshGap,
      };
    },
    [computeDirectionalFootprintSupport, computeMeshContactGap]
  );

  const computeAssemblyContactPairs = useCallback(
    (robots: AssemblyPlacementRobot[]) => {
      const pairs: string[] = [];
      for (let i = 0; i < robots.length; i += 1) {
        for (let j = i + 1; j < robots.length; j += 1) {
          const lhs = robots[i];
          const rhs = robots[j];
          const metric = computeAssemblyContactMetric(lhs, rhs);
          if (metric.gap <= ASSEMBLY_CONTACT_DETECTION_TOLERANCE_M) {
            pairs.push(buildContactPairKey(lhs.id, rhs.id));
          }
        }
      }
      return pairs;
    },
    [computeAssemblyContactMetric]
  );

  const syncAssemblyPlacementState = useCallback(
    (updatePoses: boolean) => {
      if (!isAssemblyWorkspace) return;
      const robots = assemblyRobotsRef.current;
      if (robots.length === 0) return;
      const nextPoses: Record<string, { x: number; y: number; z: number; yaw: number }> = {};
      const nextRadii: Record<string, number> = {};
      robots.forEach(({ id, robot, radius }) => {
        nextPoses[id] = {
          x: robot.position.x,
          y: robot.position.y,
          z: robot.position.z,
          yaw: robot.rotation.y,
        };
        nextRadii[id] = radius;
      });
      if (updatePoses) {
        setAssemblyPoses(nextPoses);
      }
      setAssemblyRadii(nextRadii);
      setAssemblyContactPairs(computeAssemblyContactPairs(robots));
      const selectedRobotId = useAssemblyPlacementStore.getState().selectedRobotId;
      if (!selectedRobotId) {
        setAssemblySelectedRobotId(robots[0]?.id ?? null);
      }
    },
    [
      computeAssemblyContactPairs,
      isAssemblyWorkspace,
      setAssemblyContactPairs,
      setAssemblyPoses,
      setAssemblyRadii,
      setAssemblySelectedRobotId,
    ]
  );

  const snapRobotToNearestContact = useCallback(
    (
      robotId: string,
      options?: { maxGap?: number; preferOtherId?: string | null }
    ): { snapped: boolean; otherId?: string; absGap?: number } => {
      const robots = assemblyRobotsRef.current;
      if (robots.length < 2) return { snapped: false };
      const target = robots.find((item) => item.id === robotId);
      if (!target) return { snapped: false };

      let best:
        | {
            other: AssemblyPlacementRobot;
            metric: AssemblyContactMetric;
            score: number;
          }
        | null = null;
      robots.forEach((other) => {
        if (other.id === robotId) return;
        const metric = computeAssemblyContactMetric(target, other);
        const preferenceBias =
          options?.preferOtherId && options.preferOtherId === other.id ? -0.02 : 0;
        const axisBonus = metric.axisMode !== "free" ? -0.004 : 0;
        const score = metric.absGap + preferenceBias + axisBonus;
        if (!best || score < best.score) {
          best = { other, metric, score };
        }
      });
      if (!best) return { snapped: false };
      const maxGap = options?.maxGap;
      if (typeof maxGap === "number" && best.metric.absGap > maxGap) {
        return { snapped: false };
      }

      target.robot.position.x = best.metric.targetX;
      target.robot.position.z = best.metric.targetZ;
      return { snapped: true, otherId: best.other.id, absGap: best.metric.absGap };
    },
    [computeAssemblyContactMetric]
  );

  useEffect(() => {
    if (!file) return;

    const loadRequestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = loadRequestId;

    const loader = new URDFLoader();
    const missingMeshes = new Set<string>();
    const abortController = new AbortController();
    meshAbortRef.current?.abort();
    meshAbortRef.current = abortController;
    clearGroup();
    onRobotLoaded(null);
    onRobotReadyChange?.(false);
    setError(null);
    const materialApplyScheduler = createUrdfVisualMaterialApplyScheduler({
      shouldApply: (root) => !abortController.signal.aborted && robotRef.current === root,
    });

    const stabilizeLoadedObject = (obj: THREE.Object3D) => {
      obj.traverse((node) => {
        node.frustumCulled = false;
        const meshLike = node as THREE.Mesh;
        const geometry = meshLike.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingSphere) {
          geometry.computeBoundingSphere();
        }
      });
    };

    // Custom mesh loader that uses the uploaded files
    loader.loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles,
      urdfBasePath,
      packageRoots,
      gpuMode: () => gpuModeRef.current,
      signal: abortController.signal,
      onLoaded: (mesh) => {
        stabilizeLoadedObject(mesh);
        materialApplyScheduler.schedule(robotRef.current);
      },
      onMissing: (path) => {
        const normalizedPath = stripMeshSchemes(path).trim();
        missingMeshes.add(normalizedPath || path);
        return null;
      },
      onError: (path, error) => {
        const filename = path.split("/").pop() || path;
        console.error(`Error loading mesh ${filename}:`, error);
        return null;
      },
    });

    const reader = new FileReader();

    reader.onload = (e) => {
      if (abortController.signal.aborted || loadRequestIdRef.current !== loadRequestId) {
        return;
      }
      const content = e.target?.result as string;
      try {
        if (!isUrdfValid) {
          const errorMsg = urdfValidationError || "Invalid URDF XML";
          console.error("URDF parsing error:", errorMsg);
          setError(`URDF parsing error: ${errorMsg}`);
          return;
        }

        const robot = loader.parse(content) as URDFRobot;
        const assemblySecondaryRobots: URDFRobot[] = [];
        const secondaryParseFailures: string[] = [];
        const assemblyStoredPosesSnapshot = useAssemblyPlacementStore.getState().poses;
        secondaryModels.forEach((model) => {
          try {
            const secondaryRobot = loader.parse(model.urdfContent) as URDFRobot;
            stabilizeLoadedObject(secondaryRobot);
            secondaryRobot.userData.isAssemblySecondary = true;
            secondaryRobot.userData.assemblyModelId = model.id;
            assemblySecondaryRobots.push(secondaryRobot);
          } catch (secondaryError) {
            console.warn(`Failed to parse assembly URDF model "${model.name}"`, secondaryError);
            secondaryParseFailures.push(model.name);
          }
        });
        if (robotGroupRef.current && robot && loadRequestIdRef.current === loadRequestId) {
          stabilizeLoadedObject(robot);
          // Clear previous model and keep only one mounted robot instance.
          clearGroup();
          robotGroupRef.current.add(robot);

          // Runtime IK coordinates are meter-based, matching the viewer scene scale.
          // Robot at world origin; SO101 gets a demo-only transform in World Labs scenes.
          const demoTransform = resolveWorldLabsSo101DemoTransform({
            activePackageId: activeWorldScenePackageId,
            robotName: robot.name,
          });
          robot.position.set(0, 0, 0);
          robot.rotation.set(...demoTransform.rotationRpy);
          robot.scale.setScalar(demoTransform.scale);
          robot.userData.worldLabsSo101DemoTransform = demoTransform;

          // Calculate bounding box for camera positioning only
          const box = new THREE.Box3().setFromObject(robot);
          const center = box.getCenter(new THREE.Vector3());
          const primarySize = box.getSize(new THREE.Vector3());
          const primaryHalfExtentX = Math.max(primarySize.x * 0.5, 0.09);
          const primaryHalfExtentZ = Math.max(primarySize.z * 0.5, 0.09);
          const primaryRadius = Math.max(primaryHalfExtentX, primaryHalfExtentZ);
          const primaryMeshProxies = collectAssemblyMeshProxies(robot);
          const primaryWheelProfile = detectAssemblyWheelProfile(robot);
          const assemblySpacing = 0.45;
          const primaryModelId =
            (isAssemblyWorkspace ? assemblyPrimaryModel?.id : null) ||
            (robot.userData.assemblyModelId as string | undefined) ||
            "__primary__";
          robot.userData.assemblyModelId = primaryModelId;

          // Store robot center for camera positioning (don't move the robot itself)
          robot.userData.boundingBoxCenter = center.clone();
          robot.userData.isURDFRobot = true;

          robotRef.current = robot;
          onRobotLoaded(robot);
          setRobotReady(true);
          onRobotReadyChange?.(true);
          updateMeshMaterialsForGpuMode(robot, gpuModeRef.current);
          if (transformContract.strictParity) {
            materialApplyScheduler.flush(robot);
            setTimeout(() => {
              if (!abortController.signal.aborted && robotRef.current === robot) {
                materialApplyScheduler.flush(robot);
              }
            }, URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS);
          }
          const primaryStoredPose = isAssemblyWorkspace
            ? assemblyStoredPosesSnapshot[primaryModelId]
            : undefined;
          if (primaryStoredPose) {
            robot.position.set(primaryStoredPose.x, primaryStoredPose.y, primaryStoredPose.z);
            robot.rotation.y = primaryStoredPose.yaw;
          }
          const assemblyRobots: AssemblyPlacementRobot[] = [
            {
              id: primaryModelId,
              robot,
              radius: primaryRadius,
              halfExtentX: primaryHalfExtentX,
              halfExtentZ: primaryHalfExtentZ,
              meshProxies: primaryMeshProxies,
              wheelProfile: primaryWheelProfile,
            },
          ];

          const secondaryFootprints = assemblySecondaryRobots.map((secondaryRobot) => {
            const secondaryBox = new THREE.Box3().setFromObject(secondaryRobot);
            const secondarySize = secondaryBox.getSize(new THREE.Vector3());
            const halfExtentX = Math.max(secondarySize.x * 0.5, 0.09);
            const halfExtentZ = Math.max(secondarySize.z * 0.5, 0.09);
            const modelId = (secondaryRobot.userData.assemblyModelId as string) || "";
            return {
              id: modelId,
              robot: secondaryRobot,
              radius: Math.max(halfExtentX, halfExtentZ),
              halfExtentX,
              halfExtentZ,
              meshProxies: collectAssemblyMeshProxies(secondaryRobot),
              wheelProfile: detectAssemblyWheelProfile(secondaryRobot),
            };
          });

          if (secondaryFootprints.length > 0) {
            const maxSecondaryRadius = secondaryFootprints.reduce(
              (maxRadius, item) => Math.max(maxRadius, item.radius),
              0.25
            );
            const count = secondaryFootprints.length;
            const minRadiusForPrimaryClearance =
              primaryRadius + maxSecondaryRadius + assemblySpacing;
            const minArcLengthPerRobot = maxSecondaryRadius * 2 + assemblySpacing;
            const minRadiusForPeerSpacing = (minArcLengthPerRobot * count) / (2 * Math.PI);
            const layoutRadius = Math.max(minRadiusForPrimaryClearance, minRadiusForPeerSpacing);

            secondaryFootprints.forEach((entry, index) => {
              const {
                robot: secondaryRobot,
                id: modelId,
                radius,
                halfExtentX,
                halfExtentZ,
                meshProxies,
                wheelProfile,
              } = entry;
              const storedPose = isAssemblyWorkspace
                ? assemblyStoredPosesSnapshot[modelId]
                : undefined;
              if (storedPose) {
                secondaryRobot.position.set(storedPose.x, storedPose.y, storedPose.z);
                secondaryRobot.rotation.y = storedPose.yaw;
              } else {
                const angle = (2 * Math.PI * index) / count;
                const x = Math.cos(angle) * layoutRadius;
                const z = Math.sin(angle) * layoutRadius;
                secondaryRobot.position.set(x, 0, z);
                secondaryRobot.rotation.set(0, 0, 0);
              }
              secondaryRobot.userData.isURDFRobot = true;
              secondaryRobot.userData.assemblyIndex = index;
              robotGroupRef.current?.add(secondaryRobot);
              updateMeshMaterialsForGpuMode(secondaryRobot, gpuModeRef.current);
              if (transformContract.strictParity) {
                applyUrdfVisualMaterials(secondaryRobot);
              }
              assemblyRobots.push({
                id: modelId,
                robot: secondaryRobot,
                radius,
                halfExtentX,
                halfExtentZ,
                meshProxies,
                wheelProfile,
              });
            });
          }
          assemblyRobotsRef.current = assemblyRobots;
          if (isAssemblyWorkspace) {
            syncAssemblyPlacementState(true);
          }
          if (secondaryParseFailures.length > 0) {
            const preview = secondaryParseFailures.slice(0, 3).join(", ");
            const more =
              secondaryParseFailures.length > 3
                ? `, +${secondaryParseFailures.length - 3} more`
                : "";
            if (!isAssemblyWorkspace) {
              toast.warning(`Some assembly URDFs failed to load: ${preview}${more}`);
            }
          }

          if (missingMeshes.size > 0) {
            const missingList = Array.from(missingMeshes);
            const preview = missingList.slice(0, 5).join(", ");
            const more =
              missingList.length > 5 ? `, +${missingList.length - 5} more` : "";
            if (!isAssemblyWorkspace) {
              toast.warning(`Missing ${missingList.length} mesh file(s): ${preview}${more}`);
            }
          }
        }
      } catch (err) {
        console.error("Error loading URDF:", err);
        setError("Failed to load URDF file");
        toast.error("Failed to load URDF file");
      }
    };

    reader.readAsText(file);

    return () => {
      materialApplyScheduler.cancel();
      abortController.abort();
      reader.abort();
      if (loadRequestIdRef.current === loadRequestId) {
        loadRequestIdRef.current += 1;
      }
      if (meshAbortRef.current === abortController) {
        meshAbortRef.current = null;
      }
    };
  }, [
    assemblyPrimaryModel?.id,
    clearGroup,
    file,
    isAssemblyWorkspace,
    meshFiles,
    onRobotLoaded,
    isUrdfValid,
    urdfValidationError,
    activeWorldScenePackageId,
    urdfBasePath,
    packageRoots,
    secondaryModels,
    syncAssemblyPlacementState,
    collectAssemblyMeshProxies,
    detectAssemblyWheelProfile,
    onRobotReadyChange,
  ]);

  useEffect(() => {
    return () => {
      meshAbortRef.current?.abort();
      meshAbortRef.current = null;
      clearGroup();
      onRobotLoaded(null);
      onRobotReadyChange?.(false);
    };
  }, [clearGroup, onRobotLoaded, onRobotReadyChange]);

  useEffect(() => {
    if (!robotReady || isAssemblyWorkspace || !worldLabsSplatGroundProbe) {
      return;
    }
    let cancelled = false;
    let timeoutId: number | null = null;
    let attemptCount = 0;
    const runProbe = () => {
      if (cancelled) {
        return;
      }
      const targetRobot = robotRef.current;
      if (!targetRobot) {
        return;
      }
      if (applyWorldLabsSplatGrounding(targetRobot)) {
        return;
      }
      attemptCount += 1;
      if (attemptCount < 4) {
        timeoutId = window.setTimeout(runProbe, 1000);
      }
    };
    runProbe();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [applyWorldLabsSplatGrounding, isAssemblyWorkspace, robotReady, worldLabsSplatGroundProbe]);

  useEffect(() => {
    if (!robotGroupRef.current) return;
    robotGroupRef.current.children.forEach((child) =>
      updateMeshMaterialsForGpuMode(child, gpuMode)
    );
  }, [gpuMode]);

  useEffect(() => {
    if (!isAssemblyWorkspace) return;
    const robots = assemblyRobotsRef.current;
    if (robots.length === 0) return;
    let changed = false;
    robots.forEach(({ id, robot }) => {
      const pose = assemblyStoredPoses[id];
      if (!pose) return;
      if (Math.abs(robot.position.x - pose.x) > 1e-6) {
        robot.position.x = pose.x;
        changed = true;
      }
      if (Math.abs(robot.position.y - pose.y) > 1e-6) {
        robot.position.y = pose.y;
        changed = true;
      }
      if (Math.abs(robot.position.z - pose.z) > 1e-6) {
        robot.position.z = pose.z;
        changed = true;
      }
      if (Math.abs(robot.rotation.y - pose.yaw) > 1e-6) {
        robot.rotation.y = pose.yaw;
        changed = true;
      }
    });
    if (changed) {
      setAssemblyContactPairs(computeAssemblyContactPairs(robots));
    }
  }, [
    assemblyStoredPoses,
    computeAssemblyContactPairs,
    isAssemblyWorkspace,
    setAssemblyContactPairs,
  ]);

  const thumbnailFramingRobotRef = robotRef;
  const thumbnailFramingWorldObjects = thumbnailWorldObjects;
  useEffect(() => {
    if (!thumbnailMode) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let retryAnimationFrameId = 0;
    let readyAnimationFrameId = 0;

    const scheduleRetry = () => {
      if (cancelled) return;
      retryAnimationFrameId = window.requestAnimationFrame(frameThumbnail);
    };

    const frameThumbnail = () => {
      if (cancelled) return;

      const currentRobot = thumbnailFramingRobotRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!currentRobot || !camera || !controls) {
        scheduleRetry();
        return;
      }

      currentRobot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(currentRobot);
      thumbnailFramingWorldObjects.forEach((object) => {
        if (object.isHidden) {
          return;
        }
        const halfSize = object.size.clone().multiplyScalar(0.5);
        box.expandByPoint(object.position.clone().sub(halfSize));
        box.expandByPoint(object.position.clone().add(halfSize));
      });
      if (box.isEmpty()) {
        scheduleRetry();
        return;
      }

      const thumbnailCameraFrame = buildThumbnailCameraFrame({
        bounds: box,
        frontWorld: resolveThumbnailFrontWorldDirection(),
        upWorld: resolveThumbnailUpWorld(),
        aspect: camera.aspect,
        verticalFovDegrees: camera.fov,
      });

      camera.position.copy(thumbnailCameraFrame.position);
      camera.up.copy(thumbnailCameraFrame.up);
      const { selectedCameraId, cameras } = useCameraStore.getState();
      if (selectedCameraId) {
        const selectedCamera = cameras.find((item) => item.id === selectedCameraId);
        if (selectedCamera) {
          applyIntrinsicsToPerspectiveCamera(
            camera,
            normalizeCameraIntrinsics(selectedCamera.intrinsics),
            thumbnailCameraFrame.near,
            thumbnailCameraFrame.far
          );
        } else {
          camera.near = thumbnailCameraFrame.near;
          camera.far = thumbnailCameraFrame.far;
          camera.updateProjectionMatrix();
        }
      } else {
        camera.near = thumbnailCameraFrame.near;
        camera.far = thumbnailCameraFrame.far;
        camera.updateProjectionMatrix();
      }
      controls.target.copy(thumbnailCameraFrame.target);
      controls.update();

      const cameraPosition: [number, number, number] = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ];
      const cameraTarget: [number, number, number] = [
        thumbnailCameraFrame.target.x,
        thumbnailCameraFrame.target.y,
        thumbnailCameraFrame.target.z,
      ];
      writeThumbnailRenderState({
        phase: "framing",
        ready: false,
        hasBoundingBox: true,
        cameraApplied: true,
        error: null,
        cameraPosition,
        cameraTarget,
      });
      readyAnimationFrameId = window.requestAnimationFrame(() => {
        writeThumbnailRenderState({
          phase: "ready",
          ready: true,
          hasBoundingBox: true,
          cameraApplied: true,
          error: null,
          cameraPosition,
          cameraTarget,
        });
      });
    };

    frameThumbnail();

    return () => {
      cancelled = true;
      if (retryAnimationFrameId) {
        window.cancelAnimationFrame(retryAnimationFrameId);
      }
      if (readyAnimationFrameId) {
        window.cancelAnimationFrame(readyAnimationFrameId);
      }
    };
  }, [
    cameraRef,
    controlsRef,
    resolveThumbnailFrontWorldDirection,
    resolveThumbnailUpWorld,
    thumbnailMode,
    robotReady,
    thumbnailFramingRobotRef,
    thumbnailFramingWorldObjects,
  ]);

  // ===== Selection & Highlight Helpers =====
  const highlightedMeshesRef = useRef<THREE.Mesh[]>([]);
  const highlightedLinks = useLinkHighlightStore((state) => state.highlightedLinks);

  const clearHighlights = useCallback(() => {
    highlightedMeshesRef.current.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        setEmissiveColor(material, 0x000000);
        const colorMaterial = material as THREE.Material & {
          color?: { setHex: (value: number) => void };
          userData?: { originalColor?: number };
        };
        if (
          colorMaterial.color &&
          colorMaterial.userData &&
          typeof colorMaterial.userData.originalColor === "number"
        ) {
          colorMaterial.color.setHex(colorMaterial.userData.originalColor);
        }
        // Note: We keep the cloned material to avoid issues with material sharing
        // The material clone is already in place, just reset emissive
      });
    });
    highlightedMeshesRef.current = [];
  }, []);

  const applyHighlightToLink = useCallback(
    (linkName: string, options?: { jointName?: string | null; colorOverride?: number }) => {
    const robot = robotRef.current;
    if (!robot) return;
    const resolveLinkObject = createLinkObjectResolver(robot);
    const link = resolveLinkObject(linkName);
    if (!link) return;
    
    // Determine highlight color based on joint type from joint_colors.json
      const jointName = options?.jointName ?? null;
      let highlightColor = options?.colorOverride ?? hexToThreeJsHex(jointColors.light_gray);
      if (jointName && jointLimits && options?.colorOverride === undefined) {
        const jointInfo = jointLimits[jointName];
        if (jointInfo && jointInfo.type) {
          const jointType = jointInfo.type as keyof typeof jointColors;
          if (jointColors[jointType]) {
            highlightColor = hexToThreeJsHex(jointColors[jointType]);
          }
        }
      }
    
    // Get all link names to detect when we hit a child link
    const allLinkNames = new Set(Object.keys(robot.links || {}));
    
    // Custom traversal that stops when encountering another link
    const traverseLinkOnly = (obj: THREE.Object3D) => {
      // If this is a mesh, highlight it
      if (obj instanceof THREE.Mesh) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const hasHighlightableMaterial = materials.some(
          (material) => "emissive" in material || "color" in material
        );
        if (hasHighlightableMaterial) {
          const needsClone = materials.some((material) => !material.userData.isHighlighted);
          if (needsClone) {
            const clonedMaterials = materials.map((material) => material.clone());
            obj.material = Array.isArray(obj.material) ? clonedMaterials : clonedMaterials[0];
            clonedMaterials.forEach((material) => {
              material.userData.isHighlighted = true;
              material.userData.originalMesh = obj;
              const colorMaterial = material as THREE.Material & {
                color?: { getHex: () => number };
                userData?: { originalColor?: number };
              };
              if (colorMaterial.color && colorMaterial.userData) {
                colorMaterial.userData.originalColor = colorMaterial.color.getHex();
              }
            });
          }
          const activeMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
          activeMaterials.forEach((material) => {
            if ("emissive" in material) {
              setEmissiveColor(material, highlightColor);
            } else if ("color" in material) {
              const colorMaterial = material as THREE.Material & {
                color?: { setHex: (value: number) => void };
              };
              colorMaterial.color?.setHex(highlightColor);
            }
          });
          highlightedMeshesRef.current.push(obj);
        }
      }
      
      // Process children, but skip if child is another link
      for (const child of obj.children) {
        // Skip if this child is another link (child link)
        if (allLinkNames.has(child.name)) {
          continue;
        }
        traverseLinkOnly(child);
      }
    };
    
    traverseLinkOnly(link);
    },
    [jointLimits]
  );

  const highlightLink = useCallback(
    (linkName: string, jointName?: string | null) => {
      clearHighlights();
      applyHighlightToLink(linkName, { jointName });
    },
    [applyHighlightToLink, clearHighlights]
  );

  const highlightLinks = useCallback(
    (linkNames: string[]) => {
      clearHighlights();
      const batchHighlightColor = hexToThreeJsHex(jointColors.light_gray);
      linkNames.forEach((linkName) => {
        applyHighlightToLink(linkName, {
          colorOverride: batchHighlightColor,
        });
      });
    },
    [applyHighlightToLink, clearHighlights]
  );

  const getLinkNameForJoint = (jointName: string): string | null => {
    const robot = robotRef.current;
    if (!robot) return null;
    const joint = robot.joints?.[jointName];
    if (!joint) return null;
    const linkNames = new Set(Object.keys(robot.links || {}));
    for (const child of joint.children ?? []) {
      if (linkNames.has(child.name)) return child.name;
    }
    return null;
  };

  const isWheelLikeJoint = useCallback((jointName: string, joint: URDFJoint | undefined) => {
    if (!joint) return false;
    const label = [
      jointName,
      joint.parent?.name ?? "",
      ...(joint.children ?? []).map((child) => child.name || ""),
    ].join(" ");
    return isStudioWheelLikeLabel(label);
  }, []);

  const getStudioUpAxis = useCallback(cloneStudioUpAxis, []);

  const getStudioGroundPlane = useCallback(() => {
    const runtimeUp = getStudioUpAxis();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(
      runtimeUp,
      new THREE.Vector3(0, 0, 0)
    );
  }, [getStudioUpAxis]);

  const enforceStudioPlanarPose = useCallback(
    (targetRobot: URDFRobot) => clampStudioPlanarPose(targetRobot, getStudioUpAxis()),
    [getStudioUpAxis]
  );

  const enforceWheelPlanarPose = useCallback((targetRobot: URDFRobot) => {
    const clampResult = enforceStudioPlanarPose(targetRobot);
    if (clampResult.clamped) {
      const reasons = clampResult.reasons;
      wheelDriveClampDiagnosticsRef.current.nonPlanarClampCount += 1;
      if (reasons.length === 1) {
        wheelDriveClampDiagnosticsRef.current.lastClampReason = reasons[0];
      } else if (reasons.length > 1) {
        wheelDriveClampDiagnosticsRef.current.lastClampReason = "mixed";
      }
    }
    return clampResult;
  }, [enforceStudioPlanarPose]);

  // Drag state - using world/floor reference frame
  const draggingJointRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; angle: number; lower: number; upper: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Highlight when external selection changes
  useEffect(() => {
    const robot = robotRef.current;
    if (!robot) {
      clearHighlights();
      return;
    }
    if (highlightedLinks.length > 0) {
      highlightLinks(highlightedLinks);
    } else if (selectedJoint) {
      const ln = getLinkNameForJoint(selectedJoint);
      if (ln) highlightLink(ln, selectedJoint);
    } else if (selectedLink) {
      // Highlight the selected link directly
      highlightLink(selectedLink);
    } else {
      clearHighlights();
    }
  }, [selectedJoint, selectedLink, highlightedLinks, highlightLinks, highlightLink, clearHighlights]);

  // Document-level pointer event handlers for dragging
  useEffect(() => {
    if (!isDragging) return;

    const assemblyGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const point = new THREE.Vector3();
    const handleDocumentPointerMove = (e: PointerEvent) => {
      if (isAssemblyWorkspace && draggingAssemblyRef.current) {
        const camera = cameraRef.current;
        const canvas = rendererDomRef.current;
        if (!camera || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        if (!raycaster.ray.intersectPlane(assemblyGroundPlane, point)) return;
        const drag = draggingAssemblyRef.current;
        const entry = assemblyRobotsRef.current.find((item) => item.id === drag.robotId);
        if (!entry) return;
        const prevX = drag.robot.position.x;
        const prevZ = drag.robot.position.z;
        const nextX = drag.startPosition.x + (point.x - drag.startPoint.x);
        const nextZ = drag.startPosition.z + (point.z - drag.startPoint.z);
        const forward = getAssemblyForwardWorld(entry);
        if (forward) {
          const requestedDeltaX = nextX - prevX;
          const requestedDeltaZ = nextZ - prevZ;
          const requestedDistance = Math.hypot(requestedDeltaX, requestedDeltaZ);
          const travelMeters = requestedDeltaX * forward.x + requestedDeltaZ * forward.z;
          if (
            requestedDistance > 1e-6 &&
            Math.abs(travelMeters) < requestedDistance * ASSEMBLY_WHEEL_DRAG_MIN_PROGRESS_RATIO
          ) {
            drag.robot.position.x = nextX;
            drag.robot.position.z = nextZ;
          } else {
            drag.robot.position.x = prevX + forward.x * travelMeters;
            drag.robot.position.z = prevZ + forward.z * travelMeters;
          }
        } else {
          drag.robot.position.x = nextX;
          drag.robot.position.z = nextZ;
        }
        const snapResult = snapRobotToNearestContact(drag.robotId, {
          maxGap: drag.lockedOtherId
            ? ASSEMBLY_MAGNETIC_LOCK_RELEASE_TOLERANCE_M
            : ASSEMBLY_MAGNETIC_SNAP_TOLERANCE_M,
          preferOtherId: drag.lockedOtherId,
        });
        if (snapResult.snapped) {
          if (
            snapResult.otherId &&
            typeof snapResult.absGap === "number" &&
            snapResult.absGap <= ASSEMBLY_MAGNETIC_LOCK_ENTER_TOLERANCE_M
          ) {
            drag.lockedOtherId = snapResult.otherId;
          } else if (!drag.lockedOtherId) {
            drag.lockedOtherId = snapResult.otherId ?? null;
          }
        } else {
          drag.lockedOtherId = null;
        }
        applyWheelRollForWorldDelta(
          entry,
          drag.robot.position.x - prevX,
          drag.robot.position.z - prevZ
        );
        syncAssemblyPlacementState(true);
        return;
      }
      if (!isAssemblyWorkspace && draggingStudioBaseRef.current) {
        const camera = cameraRef.current;
        const canvas = rendererDomRef.current;
        if (!camera || !canvas) return;
        if (!wheelDriveEnabled) {
          draggingStudioBaseRef.current.robot.userData.__studioBaseDragging = false;
          draggingStudioBaseRef.current = null;
          setIsDragging(false);
          onDragActiveChange?.(false);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const studioGroundPlane = getStudioGroundPlane();
        if (!raycaster.ray.intersectPlane(studioGroundPlane, point)) return;
        const studioUp = studioGroundPlane.normal.clone().normalize();

        const drag = draggingStudioBaseRef.current;
        const displacement = point.clone().sub(drag.startPoint);
        const planarDisplacement = projectVectorOntoPlane(displacement, studioUp);
        const nextPosition = drag.startPosition.clone().add(planarDisplacement);
        const requestedDelta = nextPosition.clone().sub(drag.robot.position);
        const requestedDistance = requestedDelta.length();
        if (requestedDistance <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon) return;

        const wheelModel = drag.wheelModel;
        if (wheelDriveEnabled && wheelModel) {
          const localUp = localDirectionFromWorld(studioUp, drag.robot.quaternion);
          const localForward = projectDirectionOntoPlane(
            wheelModel.forwardLocal.clone(),
            localUp,
            new THREE.Vector3(1, 0, 0)
          );

          const forward = projectDirectionOntoPlane(
            worldDirectionFromLocal(localForward, drag.robot.quaternion),
            studioUp,
            projectDirectionOntoPlane(
              worldDirectionFromLocal(new THREE.Vector3(1, 0, 0), drag.robot.quaternion),
              studioUp,
              getPerpendicularDirection(studioUp)
            )
          );
          const right = new THREE.Vector3().crossVectors(studioUp, forward).normalize();
          const requestedLinearTravel = requestedDelta.dot(forward);
          const requestedLateralTravel = requestedDelta.dot(right);
          const requestedAngularTravel =
            requestedLateralTravel / resolveSafeMotionDimension(wheelModel.trackWidth);
          const activeDriveJointNameSet = new Set(
            getPreferredStudioDriveWheels(wheelModel, wheelDriveJointOverrides).map(
              (wheel) => wheel.jointName
            )
          );
          const driveAuthority = computeStudioWheelDriveAuthority(
            wheelModel.wheels.map((wheel) => ({
              jointName: wheel.jointName,
              side: wheel.side,
            })),
            activeDriveJointNameSet
          );
          const linearTravel = requestedLinearTravel * driveAuthority.linearScale;
          const angularTravel = requestedAngularTravel * driveAuthority.angularScale;
          if (
            Math.abs(linearTravel) <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon &&
            Math.abs(angularTravel) <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon
          ) {
            return;
          }
          const turnQuat = new THREE.Quaternion().setFromAxisAngle(studioUp, angularTravel);
          const midTurnQuat = new THREE.Quaternion().setFromAxisAngle(
            studioUp,
            angularTravel * 0.5
          );
          const driveForward = forward.clone().applyQuaternion(midTurnQuat).normalize();

          drag.robot.position.addScaledVector(driveForward, linearTravel);
          drag.robot.quaternion.premultiply(turnQuat);

          const timestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
          wheelModel.wheels.forEach((wheel) => {
            const wheelTravel = getStudioWheelTravelForBodyMotion(
              wheel,
              linearTravel,
              angularTravel,
              wheelModel.trackWidth
            );
            const radius = resolveSafeMotionDimension(wheel.radius);
            const currentAngle = resolveJointScalarValue(wheel.joint) ?? 0;
            const deltaAngle = -(wheelTravel / radius) * wheel.directionSign;
            const nextAngle = currentAngle + deltaAngle;
            wheel.joint.setJointValue(nextAngle);
            setStoreJointValue(wheel.jointName, nextAngle, {
              enforceVelocity: false,
              timestamp,
            });
          });
          enforceWheelPlanarPose(drag.robot);
          drag.robot.updateMatrixWorld(true);
        } else {
          const verticalOffset = nextPosition.dot(studioUp);
          nextPosition.addScaledVector(studioUp, -verticalOffset);
          drag.robot.position.copy(nextPosition);
          enforceStudioPlanarPose(drag.robot);
          drag.robot.updateMatrixWorld(true);
        }
        return;
      }

      const jointName = draggingJointRef.current;
      if (!jointName || !robotRef.current) return;
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const robot = robotRef.current;
      const joint = robot.joints?.[jointName];
      if (!joint) return;
      
      // Use world/floor reference: vertical mouse movement controls joint angle
      // Map mouse Y movement to joint range: full screen height maps to full joint range
      // This is independent of robot orientation - always uses world coordinates
      const screenHeight = window.innerHeight;
      const dy = dragStart.y - e.clientY; // Inverted: mouse up = positive angle
      const dx = e.clientX - dragStart.x;
      
      // Calculate sensitivity: full screen height should cover full joint range
      // Handle unlimited joints (continuous) - use reasonable range for sensitivity calculation
      const isUnlimited = !isFinite(dragStart.lower) || !isFinite(dragStart.upper);
      const effectiveLower = isUnlimited ? -Math.PI * 2 : dragStart.lower;
      const effectiveUpper = isUnlimited ? Math.PI * 2 : dragStart.upper;
      const jointRange = effectiveUpper - effectiveLower;
      const wheelDrag = isWheelLikeJoint(jointName, joint);
      const sensitivity = (jointRange / screenHeight) * (wheelDrag ? 2.2 : 1);
      
      // Calculate new angle based on initial angle + vertical offset
      // Mouse up (negative dy) increases angle, mouse down (positive dy) decreases angle
      const dragSignal = wheelDrag ? dy + dx * 0.35 : dy;
      const next = dragStart.angle + (dragSignal * sensitivity);
      
      // Clamp to joint limits (only if limits are finite)
      let clampedNext = next;
      if (isFinite(dragStart.lower)) {
        clampedNext = Math.max(dragStart.lower, clampedNext);
      }
      if (isFinite(dragStart.upper)) {
        clampedNext = Math.min(dragStart.upper, clampedNext);
      }
      
      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      // Mark that manual joint changes have been made - this prevents animation from overwriting manual changes
      animationController.markManualJointChange();

      // Apply immediately so wheel meshes and camera attachments respond without lag.
      joint.setJointValue(clampedNext);
      robot.updateMatrixWorld?.(true);

      if (onJointChange) {
        onJointChange(jointName, clampedNext);
      } else {
        setStoreJointValue(jointName, clampedNext, { enforceVelocity: false, timestamp: now });
      }
      if (!isAssemblyWorkspace && dragMode === "drag-handle" && robotRef.current) {
        enforceStudioPlanarPose(robotRef.current);
      }
    };

    const handleDocumentPointerUp = () => {
      animationController.setManualDragActive(false);
      if (draggingAssemblyRef.current) {
        draggingAssemblyRef.current = null;
      }
      if (draggingStudioBaseRef.current) {
        draggingStudioBaseRef.current.robot.userData.__studioBaseDragging = false;
        draggingStudioBaseRef.current = null;
        onStudioBaseDragEnd?.();
      }
      if (draggingJointRef.current) {
        draggingJointRef.current = null;
        lastPointerRef.current = null;
        dragStartRef.current = null;
      }
      setIsDragging(false);
      onDragActiveChange?.(false);
    };

    document.addEventListener("pointermove", handleDocumentPointerMove);
    document.addEventListener("pointerup", handleDocumentPointerUp);
    return () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
      animationController.setManualDragActive(false);
    };
  }, [
    animationController,
    cameraRef,
    isDragging,
    isAssemblyWorkspace,
    onJointChange,
    onDragActiveChange,
    onStudioBaseDragEnd,
    rendererDomRef,
    setStoreJointValue,
    applyWheelRollForWorldDelta,
    dragMode,
    enforceStudioPlanarPose,
    enforceWheelPlanarPose,
    getStudioGroundPlane,
    getAssemblyForwardWorld,
    isWheelLikeJoint,
    wheelDriveEnabled,
    wheelDriveJointOverrides,
    snapRobotToNearestContact,
    syncAssemblyPlacementState,
  ]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (isAssemblyWorkspace) {
      let node: THREE.Object3D | null = e.object as THREE.Object3D;
      let robotId: string | null = null;
      while (node) {
        const candidateId = node.userData?.assemblyModelId;
        if (typeof candidateId === "string" && candidateId.length > 0) {
          robotId = candidateId;
          break;
        }
        node = node.parent;
      }
      if (robotId) {
        const entry = assemblyRobotsRef.current.find((item) => item.id === robotId);
        if (entry) {
          setAssemblySelectedRobotId(robotId);
          onSelectPart?.({ robotId });
          const dragPoint = e.ray.intersectPlane(
            new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
            new THREE.Vector3()
          );
          if (dragPoint) {
            draggingAssemblyRef.current = {
              robotId,
              robot: entry.robot,
              startPoint: dragPoint.clone(),
              startPosition: entry.robot.position.clone(),
              lockedOtherId: null,
            };
            setIsDragging(true);
            onDragActiveChange?.(true);
          }
        }
      }
      return;
    }

    const robot = robotRef.current;
    if (!robot) return;
    const hitObject = e.object as THREE.Object3D;
    let hitRobot = false;
    let node: THREE.Object3D | null = hitObject;
    while (node) {
      if (node === robot) {
        hitRobot = true;
        break;
      }
      node = node.parent;
    }

    let obj: THREE.Object3D | null = e.object as THREE.Object3D;
    const linkNames = new Set(Object.keys(robot.links || {}));
    let linkName: string | undefined;
    while (obj) {
      if (linkNames.has(obj.name)) {
        linkName = obj.name;
        break;
      }
      obj = obj.parent;
    }
    if (readOnlyMode && hitRobot) {
      onReadOnlyInteractionAttempt?.();
      return;
    }
    let jointName: string | null = null;
    if (linkName) {
      for (const [jName, jObj] of Object.entries(robot.joints ?? {})) {
        if ((jObj.children ?? []).some((child) => child.name === linkName)) {
          jointName = jName;
          break;
        }
      }
      highlightLink(linkName, jointName);
    }
    if (!jointName) {
      const isDescendantOf = (node: THREE.Object3D, ancestor: THREE.Object3D): boolean => {
        let cursor: THREE.Object3D | null = node;
        while (cursor) {
          if (cursor === ancestor) return true;
          cursor = cursor.parent;
        }
        return false;
      };
      for (const [candidateJointName, candidateJoint] of Object.entries(robot.joints ?? {})) {
        const child = (candidateJoint.children ?? [])[0] as THREE.Object3D | undefined;
        if (!child) continue;
        if (isDescendantOf(hitObject, child)) {
          jointName = candidateJointName;
          if (!linkName) {
            linkName = child.name || undefined;
          }
          break;
        }
      }
      if (linkName) {
        highlightLink(linkName, jointName);
      }
    }
    onSelectPart?.({ linkName, jointName });

    // Joint dragging is always available in move-joints mode.
    // In drag-handle mode, wheel/tire joints can still be dragged.
    const joint = jointName ? robot.joints?.[jointName] : undefined;
    const wheelJoint = !!jointName && isWheelLikeJoint(jointName, joint);
    const canDragJoint =
      !!jointName &&
      (dragMode === "move-joints" || (dragMode === "drag-handle" && wheelJoint)) &&
      (!wheelJoint || wheelDriveEnabled);
    if (jointName && joint && canDragJoint) {
        // Get joint limits from parsed URDF data
        const limits = getJointLimits(jointLimits, jointName);

        // Read current angle directly from joint
        const currentAngle = resolveJointScalarValue(joint) ?? 0;

        // Store drag start state using world/floor reference (vertical movement)
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY, // Use Y for vertical mouse movement
          angle: currentAngle,
          lower: limits.lower,
          upper: limits.upper
        };

      draggingJointRef.current = jointName;
      if (wheelJoint) {
        onWheelLocomotionIntent?.();
      }
      animationController.setManualDragActive(true);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
      onDragActiveChange?.(true);
      return;
    }

    if (dragMode === "drag-handle" && hitRobot) {
      if (!wheelDriveEnabled) {
        return;
      }
      const wheelModel = wheelDriveEnabled
        ? detectStudioWheelDriveModel(robot, getStudioUpAxis(), studioDriveJointHints)
        : null;
      const studioGroundPlane = getStudioGroundPlane();
      const dragPoint = e.ray.intersectPlane(
        studioGroundPlane,
        new THREE.Vector3()
      );
      if (!dragPoint) return;
      onWheelLocomotionIntent?.();
      onStudioBaseDragStart?.();
      animationController.setManualDragActive(true);
      robot.userData.__studioBaseDragging = true;
      draggingStudioBaseRef.current = {
        robot,
        wheelModel,
        startPoint: dragPoint.clone(),
        startPosition: robot.position.clone(),
      };
      setIsDragging(true);
      onDragActiveChange?.(true);
    }
  };

  if (error) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="red" />
      </mesh>
    );
  }

  const activeJointMarker =
    isDragging
      ? draggingJointRef.current
      : null;

  return (
    <group
      ref={sceneGroupRef}
      onPointerDown={handlePointerDown}
    >
      <group ref={robotGroupRef} />
      <JointAxisIndicator
        robot={robotRef.current}
        jointName={activeJointMarker}
        jointAxes={jointAxes}
        jointLimits={jointLimits}
      />
      {rotationPlaneVisible && selectedJoint && jointAxes?.[selectedJoint] && jointLimits?.[selectedJoint] && 
       (jointLimits[selectedJoint].type === "revolute" || jointLimits[selectedJoint].type === "continuous") && (
        <RotationPlane
          robot={robotRef.current}
          jointName={selectedJoint}
          axis={jointAxes[selectedJoint].xyz}
          jointLimits={jointLimits}
          gpuMode={gpuMode}
        />
      )}
    </group>
  );
};

// Rotation plane component that visualizes the plane perpendicular to joint axis
const RotationPlane = ({
  robot,
  jointName,
  axis,
  jointLimits,
  gpuMode = "high",
}: {
  robot: URDFRobot | null;
  jointName: string;
  axis: [number, number, number];
  jointLimits?: JointLimits;
  gpuMode?: GPUMode;
}) => {
  const planeRef = useRef<THREE.LineLoop>(null);
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const defaultNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const fallbackAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const [axisX, axisY, axisZ] = axis;

  // Calculate axis vector and color reactively when axis changes
  const axisVec = useMemo(() => {
    return new THREE.Vector3(axisX, axisY, axisZ).normalize();
  }, [axisX, axisY, axisZ]);
  
  // Determine color based on axis direction (X=red, Y=green, Z=blue) - reactive to axis changes
  const { planeColor, isNegative } = useMemo(() => {
    // Find which axis the joint rotates around (dominant component)
    const absX = Math.abs(axisVec.x);
    const absY = Math.abs(axisVec.y);
    const absZ = Math.abs(axisVec.z);
    
    let color: number;
    let negative = false;
    
    if (absX >= absY && absX >= absZ) {
      // X-axis dominant - Red/Pink
      negative = axisVec.x < 0;
      color = axisVec.x > 0 ? 0xBE2C41 : 0x9A2333; // Red/pink for +X (190, 44, 65), darker for -X
    } else if (absY >= absX && absY >= absZ) {
      // Y-axis dominant - Green
      negative = axisVec.y < 0;
      color = axisVec.y > 0 ? 0x6DA424 : 0x56831C; // Green for +Y (109, 164, 36), darker for -Y
    } else {
      // Z-axis dominant - Blue
      negative = axisVec.z < 0;
      color = axisVec.z > 0 ? 0x3464AD : 0x29508A; // Blue for +Z (52, 100, 173), darker for -Z
    }
    
    return { planeColor: color, isNegative: negative };
  }, [axisVec]);

  // Use an outline-only circle so helper never blocks robot visibility.
  const circleGeometry = useMemo(() => {
    const radius = 0.25;
    const segments = 96;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }, []);

  const planeLineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: planeColor,
        transparent: true,
        opacity: gpuMode === "low" ? 0.55 : 0.7,
        depthTest: true,
        depthWrite: false,
      }),
    [gpuMode, planeColor]
  );

  useEffect(() => () => circleGeometry.dispose(), [circleGeometry]);
  useEffect(() => () => planeLineMaterial.dispose(), [planeLineMaterial]);

  useFrame(() => {
    if (!robot || !planeRef.current) return;

    const joint = robot.joints?.[jointName];
    if (!joint) return;

    // Get joint position in world space
    joint.updateWorldMatrix(true, true);
    joint.getWorldPosition(positionRef.current);
    planeRef.current.position.copy(positionRef.current);

    // Rotate plane so its normal aligns with the joint axis.
    if (Math.abs(axisVec.dot(defaultNormal)) > 0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, Math.PI / 2);
    } else if (Math.abs(axisVec.dot(defaultNormal)) < -0.99) {
      quaternionRef.current.setFromAxisAngle(fallbackAxis, -Math.PI / 2);
    } else {
      quaternionRef.current.setFromUnitVectors(defaultNormal, axisVec);
    }

    planeRef.current.quaternion.copy(quaternionRef.current);
  });

  // Keep negative-axis cue without using filled overlays.
  const lineScale = isNegative ? 0.96 : 1.0;

  return (
    <lineLoop
      ref={planeRef}
      renderOrder={-10}
      geometry={circleGeometry}
      material={planeLineMaterial}
      scale={[lineScale, lineScale, 1]}
      frustumCulled={false}
    >
    </lineLoop>
  );
};

const JointAxisIndicator = ({
  robot,
  jointName,
  jointAxes,
  jointLimits,
}: {
  robot: URDFRobot | null;
  jointName: string | null;
  jointAxes?: JointAxisMap;
  jointLimits?: JointLimits;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const worldQuaternionRef = useRef(new THREE.Quaternion());
  const axisLocalRef = useRef(new THREE.Vector3(0, 0, 1));
  const axisWorldRef = useRef(new THREE.Vector3(0, 0, 1));
  const alignQuaternionRef = useRef(new THREE.Quaternion());
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const shouldRender = useMemo(() => {
    if (!robot || !jointName) return false;
    const jointType = (
      jointLimits?.[jointName]?.type ??
      robot.joints?.[jointName]?.jointType ??
      ""
    ).toLowerCase();
    return jointType === "revolute" || jointType === "continuous";
  }, [jointLimits, jointName, robot]);

  const { straightAxisColor, planeCueBaseColor } = useMemo(() => {
    if (!robot || !jointName) {
      return { straightAxisColor: 0xbe2c41, planeCueBaseColor: 0xbe2c41 };
    }

    const joint = robot.joints?.[jointName];
    const axisFromStore = jointAxes?.[jointName]?.xyz;

    let x = 0;
    let y = 0;
    let z = 1;
    if (
      axisFromStore &&
      Number.isFinite(axisFromStore[0]) &&
      Number.isFinite(axisFromStore[1]) &&
      Number.isFinite(axisFromStore[2])
    ) {
      x = axisFromStore[0];
      y = axisFromStore[1];
      z = axisFromStore[2];
    } else if ((joint as unknown as { axis?: THREE.Vector3 }).axis instanceof THREE.Vector3) {
      x = (joint as unknown as { axis: THREE.Vector3 }).axis.x;
      y = (joint as unknown as { axis: THREE.Vector3 }).axis.y;
      z = (joint as unknown as { axis: THREE.Vector3 }).axis.z;
    }

    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);

    if (absX >= absY && absX >= absZ) {
      return {
        straightAxisColor: 0xbe2c41,
        planeCueBaseColor: x >= 0 ? 0xbe2c41 : 0x9a2333,
      };
    }
    if (absY >= absX && absY >= absZ) {
      return {
        straightAxisColor: 0x6da424,
        planeCueBaseColor: y >= 0 ? 0x6da424 : 0x56831c,
      };
    }
    return {
      straightAxisColor: 0x3464ad,
      planeCueBaseColor: z >= 0 ? 0x3464ad : 0x29508a,
    };
  }, [jointAxes, jointName, robot]);
  const rotationCueColor = planeCueBaseColor;
  const rotationCueHeadColor = planeCueBaseColor;

  const {
    arrowLength,
    shaftRadius,
    headRadius,
    arcRadius,
    arcTubeRadius,
    arcArrowRadius,
    arcArrowLength,
  } = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let robotExtent = 1.0;
    let localJointExtent: number | null = null;

    if (robot && jointName) {
      const jointObj = robot.joints?.[jointName] as
        | (THREE.Object3D & { children?: THREE.Object3D[] })
        | undefined;
      const childCandidates = jointObj?.children ?? [];
      const childLink =
        childCandidates.find((child) => Boolean(robot.links?.[child.name])) ??
        childCandidates[0];
      if (childLink) {
        const localBox = new THREE.Box3().setFromObject(childLink);
        if (!localBox.isEmpty()) {
          const localSize = localBox.getSize(new THREE.Vector3());
          const localMax = Math.max(localSize.x, localSize.y, localSize.z);
          if (Number.isFinite(localMax) && localMax > 1e-4) {
            localJointExtent = localMax;
          }
        }
      }
    }

    if (robot) {
      const box = new THREE.Box3().setFromObject(robot);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (Number.isFinite(maxDim) && maxDim > 1e-4) {
          robotExtent = maxDim;
        }
      }
    }

    const length =
      localJointExtent !== null
        ? clamp(localJointExtent * 0.45, 0.02, 0.12)
        : clamp(robotExtent * 0.045, 0.022, 0.12);
    const shaftR = clamp(length * 0.02, 0.0014, 0.005);
    const headR = clamp(length * 0.06, 0.0038, 0.011);
    const arcR = length * 0.25;
    const arcTubeR = clamp(length * 0.01, 0.001, 0.0028);
    const arcArrowR = clamp(length * 0.04, 0.003, 0.0085);
    const arcArrowL = arcArrowR * 2;

    return {
      arrowLength: length,
      shaftRadius: shaftR,
      headRadius: headR,
      arcRadius: arcR,
      arcTubeRadius: arcTubeR,
      arcArrowRadius: arcArrowR,
      arcArrowLength: arcArrowL,
    };
  }, [jointName, robot]);

  useFrame(() => {
    if (!shouldRender || !groupRef.current || !robot || !jointName) return;
    const joint = robot.joints?.[jointName];
    if (!joint) return;

    const axisFromStore = jointAxes?.[jointName]?.xyz;
    if (
      axisFromStore &&
      Number.isFinite(axisFromStore[0]) &&
      Number.isFinite(axisFromStore[1]) &&
      Number.isFinite(axisFromStore[2])
    ) {
      axisLocalRef.current.set(axisFromStore[0], axisFromStore[1], axisFromStore[2]);
    } else if ((joint as unknown as { axis?: THREE.Vector3 }).axis instanceof THREE.Vector3) {
      axisLocalRef.current.copy(
        (joint as unknown as { axis: THREE.Vector3 }).axis
      );
    } else {
      axisLocalRef.current.set(0, 0, 1);
    }

    if (axisLocalRef.current.lengthSq() < 1e-9) {
      axisLocalRef.current.set(0, 0, 1);
    }
    axisLocalRef.current.normalize();

    joint.updateWorldMatrix(true, true);
    joint.getWorldPosition(worldPositionRef.current);
    joint.getWorldQuaternion(worldQuaternionRef.current);

    axisWorldRef.current
      .copy(axisLocalRef.current)
      .applyQuaternion(worldQuaternionRef.current)
      .normalize();

    alignQuaternionRef.current.setFromUnitVectors(upAxis, axisWorldRef.current);
    groupRef.current.position.copy(worldPositionRef.current);
    groupRef.current.quaternion.copy(alignQuaternionRef.current);
  });

  if (!shouldRender) {
    return null;
  }

  const shaftLength = arrowLength * 0.7;
  const headLength = arrowLength * 0.3;
  const arcYOffset = arrowLength * 0.85;
  const arcSweep = Math.PI * 1.5;

  return (
    <group ref={groupRef} renderOrder={1002} frustumCulled={false}>
      <mesh position={[0, shaftLength / 2, 0]} renderOrder={1002} frustumCulled={false}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftLength, 12]} />
        <meshBasicMaterial
          color={straightAxisColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, shaftLength + headLength / 2, 0]} renderOrder={1002} frustumCulled={false}>
        <coneGeometry args={[headRadius, headLength, 16]} />
        <meshBasicMaterial
          color={straightAxisColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, arcYOffset, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={1002}
        frustumCulled={false}
      >
        <torusGeometry args={[arcRadius, arcTubeRadius, 8, 42, arcSweep]} />
        <meshBasicMaterial
          color={rotationCueColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, arcYOffset, -arcRadius]}
        rotation={[0, 0, -Math.PI / 2]}
        renderOrder={1002}
        frustumCulled={false}
      >
        <coneGeometry args={[arcArrowRadius, arcArrowLength, 8]} />
        <meshBasicMaterial
          color={rotationCueHeadColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// Helper function to convert hex color string to Three.js hex number
const hexToThreeJsHex = (hex: string): number => {
  // Remove # if present
  const cleanHex = hex.replace("#", "");
  return parseInt(cleanHex, 16);
};

// Helper function to get joint type label (capitalize first letter)
const getJointTypeLabel = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1);
};

const parseContactPair = (pairKey: string): [string, string] | null => {
  const parts = pairKey.split("::");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
};

const ASSEMBLY_CONTACT_DETECTION_TOLERANCE_M = 0.008;
const ASSEMBLY_MESH_CONTACT_DISTANCE_LIMIT_M = 0.45;
const ASSEMBLY_MAGNETIC_SNAP_TOLERANCE_M = 0.22;
const ASSEMBLY_MAGNETIC_LOCK_ENTER_TOLERANCE_M = 0.018;
const ASSEMBLY_MAGNETIC_LOCK_RELEASE_TOLERANCE_M = 0.26;
const ASSEMBLY_AXIS_SNAP_TOLERANCE_M = 0.05;
const ASSEMBLY_AXIS_ASSIST_RANGE_M = 0.24;
const ASSEMBLY_WHEEL_DRAG_MIN_PROGRESS_RATIO = 0.22;
const DOMINANT_AXIS_THRESHOLD = 0.9;
const STUDIO_PLANAR_EPSILON = 1e-6;
const STUDIO_WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);
const ROBOT_FRONT_LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
const ROBOT_FRONT_CAMERA_DIRECTION_EPSILON = 1e-10;
const CAMERA_LIKE_LINK_NAME_PATTERN = /(camera|cam)/i;
const ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH = 4;

type StudioPlanarClampReason = "y" | "roll" | "pitch";

type StudioPlanarClampResult = {
  clamped: boolean;
  reasons: StudioPlanarClampReason[];
  floorHeight: number;
};

const cloneStudioUpAxis = () => STUDIO_WORLD_UP_AXIS.clone();

const clampStudioPlanarPose = (
  targetRobot: URDFRobot,
  runtimeUp = cloneStudioUpAxis()
): StudioPlanarClampResult => {
  const dominantAxis = getDominantAxis(runtimeUp);
  if (dominantAxis === "y" && Math.abs(runtimeUp.y) >= DOMINANT_AXIS_THRESHOLD) {
    const clampResult = enforcePlanarBasePose(targetRobot, {
      groundHeightFn: FLAT_GROUND_HEIGHT_FN,
      epsilon: STUDIO_PLANAR_EPSILON,
      lockRollPitch: true,
      updateMatrixWorld: false,
    });
    if (clampResult.clamped) {
      targetRobot.updateMatrixWorld(true);
    }
    return clampResult;
  }

  const reasons: StudioPlanarClampReason[] = [];
  if (dominantAxis === "z") {
    if (Math.abs(targetRobot.position.z) > STUDIO_PLANAR_EPSILON) {
      targetRobot.position.z = 0;
      reasons.push("y");
    }
    if (Math.abs(targetRobot.rotation.x) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.x = 0;
      reasons.push("roll");
    }
    if (Math.abs(targetRobot.rotation.y) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.y = 0;
      reasons.push("pitch");
    }
  } else {
    if (Math.abs(targetRobot.position.x) > STUDIO_PLANAR_EPSILON) {
      targetRobot.position.x = 0;
      reasons.push("y");
    }
    if (Math.abs(targetRobot.rotation.y) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.y = 0;
      reasons.push("roll");
    }
    if (Math.abs(targetRobot.rotation.z) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.z = 0;
      reasons.push("pitch");
    }
  }
  if (reasons.length > 0) {
    targetRobot.updateMatrixWorld(true);
  }
  return {
    clamped: reasons.length > 0,
    reasons,
    floorHeight: 0,
  };
};

const getDominantAxis = (
  axis: THREE.Vector3
): "x" | "y" | "z" => {
  const absX = Math.abs(axis.x);
  const absY = Math.abs(axis.y);
  const absZ = Math.abs(axis.z);
  if (absX >= absY && absX >= absZ) return "x";
  if (absY >= absX && absY >= absZ) return "y";
  return "z";
};

const isFinitePositiveMotionDimension = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > Number.EPSILON;

const resolveRoverApproachRobotFootprint = ({
  robot,
  wheelModel,
  upAxisWorld,
  forwardWorld,
}: {
  robot: URDFRobot;
  wheelModel: StudioWheelDriveModel;
  upAxisWorld: THREE.Vector3;
  forwardWorld: THREE.Vector3;
}): RoverApproachRobotFootprint => {
  const safeTrackWidthM = resolveSafeMotionDimension(wheelModel.trackWidth);
  const lateralWorld = new THREE.Vector3().crossVectors(upAxisWorld, forwardWorld);
  const normalizedLateralWorld = normalizeDirection(
    lateralWorld,
    new THREE.Vector3(0, 1, 0)
  );
  const projectedLengthM =
    resolveProjectedRobotSpanMeters(robot, forwardWorld) ??
    safeTrackWidthM *
      ROVER_APPROACH_NAVIGATION_CONFIG.robotFootprintLengthFallbackTrackWidthRatio;
  const projectedWidthM = Math.max(
    safeTrackWidthM,
    resolveProjectedRobotSpanMeters(robot, normalizedLateralWorld) ?? 0
  );
  return {
    halfLengthM: projectedLengthM * 0.5,
    halfWidthM: projectedWidthM * 0.5,
  };
};

const projectVectorOntoPlane = (vector: THREE.Vector3, planeNormal: THREE.Vector3): THREE.Vector3 => {
  return projectVectorOntoPlaneFromContract(vector, planeNormal);
};

const getPerpendicularDirection = (upAxis: THREE.Vector3): THREE.Vector3 => {
  return getPerpendicularDirectionFromContract(upAxis, new THREE.Vector3(1, 0, 0));
};

const resolveLinkDepthByName = (
  robot: URDFRobot,
  rootLinkName: string
): Map<string, number> => {
  const depthByLinkName = new Map<string, number>([[rootLinkName, 0]]);
  const rootLink =
    (robot.links?.[rootLinkName] as THREE.Object3D | undefined) ??
    robot.getObjectByName?.(rootLinkName) ??
    null;
  if (!rootLink) return depthByLinkName;

  const queue: Array<{ linkObject: THREE.Object3D; depth: number }> = [{ linkObject: rootLink, depth: 0 }];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    const { linkObject, depth } = entry;
    linkObject.children.forEach((child) => {
      const joint = child as URDFJoint & { isURDFJoint?: boolean };
      if (!joint.isURDFJoint) return;
      joint.children.forEach((jointChild) => {
        const linkChild = jointChild as THREE.Object3D & { isURDFLink?: boolean };
        if (!linkChild.isURDFLink || !linkChild.name) return;
        if (depthByLinkName.has(linkChild.name)) return;
        const nextDepth = depth + 1;
        depthByLinkName.set(linkChild.name, nextDepth);
        queue.push({ linkObject: linkChild, depth: nextDepth });
      });
    });
  }

  return depthByLinkName;
};

const resolveBaseCameraForwardLocal = ({
  robot,
  cameras,
  rootLinkName,
  worldUp,
}: {
  robot: URDFRobot;
  cameras: RobotCamera[];
  rootLinkName: string | null;
  worldUp: THREE.Vector3;
}): THREE.Vector3 | null => {
  if (!rootLinkName || cameras.length === 0) return null;
  const depthByLinkName = resolveLinkDepthByName(robot, rootLinkName);
  const localUp = localDirectionFromWorld(worldUp, robot.quaternion);
  const centroidWorld = new THREE.Vector3();
  let bestDirection: THREE.Vector3 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDepth = Number.POSITIVE_INFINITY;

  cameras.forEach((camera) => {
    const parentLinkName = resolveCameraParentLinkNameFromJoint(robot, camera.parent_joint);
    if (!parentLinkName) return;
    const linkDepth = depthByLinkName.get(parentLinkName);
    if (typeof linkDepth !== "number") return;
    if (linkDepth > ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH) return;
    const { position: cameraWorldPosition } = getCameraWorldPose(robot, camera, {
      updateRobotWorld: false,
    });
    const cameraLocalPosition = robot.worldToLocal(cameraWorldPosition.clone());
    const planarDirection = projectDirectionOntoPlane(
      cameraLocalPosition,
      localUp,
      ROBOT_FRONT_LOCAL_FORWARD.clone()
    );
    let planarLengthSq = planarDirection.lengthSq();
    if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) {
      const parentLinkObject =
        (robot.links?.[parentLinkName] as THREE.Object3D | undefined) ??
        robot.getObjectByName?.(parentLinkName) ??
        null;
      if (!parentLinkObject) return;
      const localCentroid = computeOwnedLinkLocalVisualCentroid(parentLinkObject);
      if (!localCentroid) return;
      centroidWorld.copy(localCentroid).applyMatrix4(parentLinkObject.matrixWorld);
      cameraLocalPosition.copy(robot.worldToLocal(centroidWorld.clone()));
      planarDirection.copy(
        projectDirectionOntoPlane(
          cameraLocalPosition,
          localUp,
          ROBOT_FRONT_LOCAL_FORWARD.clone()
        )
      );
      planarLengthSq = planarDirection.lengthSq();
      if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) return;
    }
    planarDirection.multiplyScalar(1 / Math.sqrt(planarLengthSq));
    const score = planarDirection.dot(ROBOT_FRONT_LOCAL_FORWARD);
    if (linkDepth > bestDepth) return;
    if (linkDepth === bestDepth && score <= bestScore) return;
    bestDepth = linkDepth;
    bestScore = score;
    bestDirection = planarDirection.clone();
  });

  return bestDirection;
};

const resolveBaseCameraLikeLinkForwardLocal = ({
  robot,
  rootLinkName,
  worldUp,
}: {
  robot: URDFRobot;
  rootLinkName: string | null;
  worldUp: THREE.Vector3;
}): THREE.Vector3 | null => {
  if (!rootLinkName) return null;
  const depthByLinkName = resolveLinkDepthByName(robot, rootLinkName);
  const localUp = localDirectionFromWorld(worldUp, robot.quaternion);
  const worldPosition = new THREE.Vector3();
  const worldCentroid = new THREE.Vector3();
  let bestDirection: THREE.Vector3 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDepth = Number.POSITIVE_INFINITY;

  depthByLinkName.forEach((linkDepth, linkName) => {
    if (linkName === rootLinkName) return;
    if (linkDepth > ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH) return;
    if (!CAMERA_LIKE_LINK_NAME_PATTERN.test(linkName)) return;
    const linkObject =
      (robot.links?.[linkName] as THREE.Object3D | undefined) ??
      robot.getObjectByName?.(linkName) ??
      null;
    if (!linkObject) return;

    linkObject.updateMatrixWorld(true);
    const localCentroid = computeOwnedLinkLocalVisualCentroid(linkObject);
    if (localCentroid) {
      worldCentroid.copy(localCentroid).applyMatrix4(linkObject.matrixWorld);
      worldPosition.copy(worldCentroid);
    } else {
      linkObject.getWorldPosition(worldPosition);
    }
    const linkLocalPosition = robot.worldToLocal(worldPosition.clone());
    const planarDirection = projectDirectionOntoPlane(
      linkLocalPosition,
      localUp,
      ROBOT_FRONT_LOCAL_FORWARD.clone()
    );
    const planarLengthSq = planarDirection.lengthSq();
    if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) return;
    planarDirection.multiplyScalar(1 / Math.sqrt(planarLengthSq));
    const score = planarDirection.dot(ROBOT_FRONT_LOCAL_FORWARD);
    if (linkDepth > bestDepth) return;
    if (linkDepth === bestDepth && score <= bestScore) return;
    bestDepth = linkDepth;
    bestScore = score;
    bestDirection = planarDirection.clone();
  });

  return bestDirection;
};

const areSortedStringListsEqual = (
  lhs: readonly string[],
  rhs: readonly string[]
): boolean => lhs.length === rhs.length && lhs.every((value, index) => value === rhs[index]);

const AssemblyPlacementHelpers = ({
  poses,
  radii,
  selectedRobotId,
  contactPairs,
}: {
  poses: Record<string, { x: number; y: number; z: number; yaw: number }>;
  radii: Record<string, number>;
  selectedRobotId: string | null;
  contactPairs: string[];
}) => {
  const contactMap = useMemo(() => {
    const next = new Set<string>();
    contactPairs.forEach((pairKey) => {
      const parsed = parseContactPair(pairKey);
      if (!parsed) return;
      next.add(parsed[0]);
      next.add(parsed[1]);
    });
    return next;
  }, [contactPairs]);

  const contactSegments = useMemo(() => {
    return contactPairs
      .map((pairKey, index) => {
        const parsed = parseContactPair(pairKey);
        if (!parsed) return null;
        const lhs = poses[parsed[0]];
        const rhs = poses[parsed[1]];
        if (!lhs || !rhs) return null;
        return {
          id: `${pairKey}-${index}`,
          from: [lhs.x, 0.03, lhs.z] as [number, number, number],
          to: [rhs.x, 0.03, rhs.z] as [number, number, number],
        };
      })
      .filter((item): item is { id: string; from: [number, number, number]; to: [number, number, number] } =>
        Boolean(item)
      );
  }, [contactPairs, poses]);

  const selectedGuide = useMemo(() => {
    if (!selectedRobotId) return null;
    const selectedPose = poses[selectedRobotId];
    if (!selectedPose) return null;
    const selectedRadius = Math.max(radii[selectedRobotId] ?? 0.22, 0.08);
    const candidates = Object.entries(poses).filter(([robotId]) => robotId !== selectedRobotId);
    if (candidates.length === 0) return null;

    let best:
      | {
          robotId: string;
          pose: { x: number; y: number; z: number; yaw: number };
          distance: number;
          targetDistance: number;
          absGap: number;
          snapX: number;
          snapZ: number;
        }
      | null = null;

    candidates.forEach(([robotId, pose]) => {
      const otherRadius = Math.max(radii[robotId] ?? 0.22, 0.08);
      const dx = selectedPose.x - pose.x;
      const dz = selectedPose.z - pose.z;
      const distance = Math.hypot(dx, dz);
      const targetDistance = selectedRadius + otherRadius;
      const absGap = Math.abs(distance - targetDistance);
      const dirX = distance > 1e-6 ? dx / distance : Math.cos(selectedPose.yaw);
      const dirZ = distance > 1e-6 ? dz / distance : Math.sin(selectedPose.yaw);
      const snapX = pose.x + dirX * targetDistance;
      const snapZ = pose.z + dirZ * targetDistance;
      if (!best || absGap < best.absGap) {
        best = { robotId, pose, distance, targetDistance, absGap, snapX, snapZ };
      }
    });

    if (!best) return null;
    const axisCorner = [best.pose.x, 0.035, selectedPose.z] as [number, number, number];
    const nearestPoint = [best.pose.x, 0.035, best.pose.z] as [number, number, number];
    return {
      from: [selectedPose.x, 0.035, selectedPose.z] as [number, number, number],
      to: nearestPoint,
      snap: [best.snapX, 0.035, best.snapZ] as [number, number, number],
      axisCorner,
      axisXAligned: Math.abs(selectedPose.x - best.pose.x) <= 0.03,
      axisZAligned: Math.abs(selectedPose.z - best.pose.z) <= 0.03,
      gapMeters: best.absGap,
      isNearContact: best.absGap <= 0.03,
    };
  }, [poses, radii, selectedRobotId]);

  const robotEntries = Object.entries(poses);
  if (robotEntries.length === 0) return null;

  return (
    <group>
      {robotEntries.map(([robotId, pose]) => {
        const radius = Math.max(radii[robotId] ?? 0.22, 0.08);
        const innerRadius = Math.max(radius - 0.03, 0.03);
        const isSelected = selectedRobotId === robotId;
        const isInContact = contactMap.has(robotId);
        const color = isSelected ? "#ff63d5" : isInContact ? "#4ade80" : "#8a8a8a";
        return (
          <group key={robotId}>
            <mesh
              position={[pose.x, 0.006, pose.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={5}
              userData={{ assemblyModelId: robotId }}
            >
              <ringGeometry args={[innerRadius, radius, 56]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isSelected ? 0.72 : isInContact ? 0.52 : 0.3}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[pose.x, 0.016, pose.z]} renderOrder={6} userData={{ assemblyModelId: robotId }}>
              <sphereGeometry args={[0.018, 12, 12]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isSelected ? 0.95 : 0.65}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
      {contactSegments.map((segment) => (
        <Line
          key={segment.id}
          points={[segment.from, segment.to]}
          color="#4ade80"
          transparent
          opacity={0.85}
          lineWidth={1.25}
          depthTest={false}
          depthWrite={false}
        />
      ))}
      {selectedGuide ? (
        <>
          <Line
            points={[selectedGuide.from, selectedGuide.to]}
            color={selectedGuide.isNearContact ? "#4ade80" : "#f59e0b"}
            transparent
            opacity={0.65}
            lineWidth={1}
            depthTest={false}
            depthWrite={false}
          />
          <Line
            points={[selectedGuide.from, selectedGuide.axisCorner]}
            color={selectedGuide.axisXAligned ? "#4ade80" : "#a3a3a3"}
            transparent
            opacity={0.65}
            lineWidth={0.95}
            depthTest={false}
            depthWrite={false}
          />
          <Line
            points={[selectedGuide.axisCorner, selectedGuide.to]}
            color={selectedGuide.axisZAligned ? "#4ade80" : "#a3a3a3"}
            transparent
            opacity={0.65}
            lineWidth={0.95}
            depthTest={false}
            depthWrite={false}
          />
          <Line
            points={[selectedGuide.from, selectedGuide.snap]}
            color="#ff63d5"
            transparent
            opacity={0.85}
            lineWidth={1.15}
            depthTest={false}
            depthWrite={false}
          />
          <Line
            points={[selectedGuide.snap, selectedGuide.to]}
            color={selectedGuide.gapMeters <= 0.03 ? "#4ade80" : "#ff63d5"}
            transparent
            opacity={0.78}
            lineWidth={1.05}
            depthTest={false}
            depthWrite={false}
          />
          <mesh position={selectedGuide.axisCorner} renderOrder={8}>
            <sphereGeometry args={[0.013, 10, 10]} />
            <meshBasicMaterial color="#a3a3a3" transparent opacity={0.75} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh position={selectedGuide.to} renderOrder={8}>
            <sphereGeometry args={[0.016, 10, 10]} />
            <meshBasicMaterial color="#4ade80" transparent opacity={0.86} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh position={selectedGuide.snap} renderOrder={8}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <meshBasicMaterial
              color={selectedGuide.gapMeters <= 0.03 ? "#4ade80" : "#ff63d5"}
              transparent
              opacity={0.9}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </>
      ) : null}
    </group>
  );
};

const transformContract = getTransformContract();
assertTransformContract(transformContract);
export const Viewer3D = ({
  workspaceMode = "studio",
  assemblyPrimaryModel,
  urdfFile,
  assemblySecondaryModels = [],
  urdfBasePath,
  packageRoots,
  urdfAnalysis,
  initialMeshFiles = {},
  selectedJoint = null,
  selectedLink: selectedLinkProp = null,
  jointValues = {},
  jointLimits = {},
  jointAxes = {},
  onJointSelect,
  onLinkSelect,
  onJointHover,
  onLinkHover,
  onJointChange,
  onRobotJointsLoaded,
  onRobotLoaded,
  onMotionDataNodesGenerated,
  onMotionFileChange,
  onPlayingChange,
  onAnimationFramesChange,
  onFrameChange,
  collisionVisibility = {},
  collisionsVisible = false,
  collisionSimplifyLinks = [],
  collisionMergedLinks = [],
  rotationPlaneVisible = false,
  inertialVisualization = {
    showGlobalCOM: true,
    showLinkCOM: false,
    showInertia: false,
    showReferenceGeometry: false,
    scopedLinkNames: null,
  },
  simulationPrepPanelOpen = false,
  simulationPrepResetPoseRequestKey = null,
  simulationPrepRobotMirrorVisualization = null,
  simulationPrepRobotMirrorDeemphasizedLinkNames = null,
  simulationPrepSymmetryVisualization = null,
  simulationPrepSymmetryOverlayCenterMode = "robot-center",
  onRobotBoundingBoxChange,
  endEffectorLink = null,
  onIkApplied,
  ikDragSuppressed = false,
  vizUrdfContent,
  onAutoPatchWheelRolesUrdf,
  onObjectSelect,
  thumbnailMode = false,
  readOnlyMode = false,
  runtimeRobotBasePose = null,
  enableObjectActionsInReadOnly = false,
  onInertiaReliabilityChange,
}: Viewer3DProps) => {
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  const isAssemblyWorkspace = workspaceModeUi.isAssembly;
  // Use GPU mode hook for rendering
  const { gpuMode } = useGPUMode();
  usePlaybackDebugTrace();
  const motionKernelEnabled = useSyncExternalStore(
    subscribeFeatureFlags,
    () => isFeatureFlagEnabled("motionKernelV2"),
    () => true
  );
  const [, setMotionDataFile] = useState<File | null>(null);
  const [animationFrames, setAnimationFrames] = useState<
    AnimationFrame[] | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [ikHandlesReady, setIkHandlesReady] = useState(false);
  useEffect(() => {
    if (!urdfFile) {
      onInertiaReliabilityChange?.([]);
      setIkHandlesReady(false);
    }
  }, [onInertiaReliabilityChange, urdfFile]);
  const { meshFiles } = useMeshFilesState(initialMeshFiles);
  const [isDraggingJoint, setIsDraggingJoint] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const assemblyPoses = useAssemblyPlacementStore((state) => state.poses);
  const assemblyRadii = useAssemblyPlacementStore((state) => state.radii);
  const assemblySelectedRobotId = useAssemblyPlacementStore((state) => state.selectedRobotId);
  const assemblyContactPairs = useAssemblyPlacementStore((state) => state.contactPairs);
  const orbitDefaults = useIkParamsStore((state) => state.orbitDefaults);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [hasStudioWheelDrive, setHasStudioWheelDrive] = useState(false);
  const [wheelDriveEnabled, setWheelDriveEnabled] = useState(true);
  const handledSimulationPrepResetPoseRequestKeyRef = useRef<string | null>(null);
  const wheelDriveEnabledRef = useRef(wheelDriveEnabled);
  const [studioWheelRoleEntries, setStudioWheelRoleEntries] = useState<StudioWheelRoleEntry[]>([]);
  const [isObjectToolsOpen, setIsObjectToolsOpen] = useState(false);
  const [isWheelRolesOpen, setIsWheelRolesOpen] = useState(false);
  const [wheelDriveJointOverrides, setWheelDriveJointOverrides] = useState<Record<string, boolean>>({});
  const [isIkTrajectoryApplying, setIsIkTrajectoryApplying] = useState(false);
  const [isObjectEditDragging, setIsObjectEditDragging] = useState(false);
  const ikApplyAnimationRef = useRef<number | null>(null);
  const ikApplyTokenRef = useRef(0);
  const insertedLiveCameraIdsRef = useRef<Set<string>>(new Set());
  const cameraConfigs = useCameraStore((state) => state.cameras);
  const upsertCameraConfig = useCameraStore((state) => state.upsertCamera);
  const removeCameraConfig = useCameraStore((state) => state.removeCamera);
  const animationController = useAnimationController();
  const currentAnimationFrameIndexRef = animationController.currentFrameIndexRef;
  const isProtectedDemoRobot = useMemo(
    () => isLeKiwiRobotAsset(urdfFile?.name, robot?.name),
    [robot?.name, urdfFile?.name]
  );
  const isOpenArmDemoRobot = useMemo(
    () => isOpenArmRobotAsset(urdfFile?.name, robot?.name),
    [robot?.name, urdfFile?.name]
  );
  const storeJointValues = useJointStore((s) => s.jointValues);
  const availableJointNames = useJointStore((s) => s.availableJoints);
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const setAvailableJointsStore = useJointStore((s) => s.setAvailableJoints);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const worldObjects = useObjectStore((state) => state.objects);
  const replaceWorldObjectsBySource = useObjectStore(
    (state) => state.replaceObjectsBySource,
  );
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const objectEditMode = useObjectStore((state) => state.editMode);
  const operatorPointCloudFrame = useOperatorPerceptionStore(
    (state) => state.activePointCloudFrame
  );
  const operatorPointCloudFrames = useOperatorPerceptionStore(
    (state) => state.activePointCloudFrames
  );
  const openArmHfLiveObserveRequested = useOperatorPerceptionStore(
    (state) => state.openArmHfLiveObserveRequested
  );
  const liveLeaderJointTelemetryByName = useOperatorPerceptionStore(
    (state) => state.activeLeaderJointTelemetryByName,
  );
  const liveFollowerJointTelemetryByName = useOperatorPerceptionStore(
    (state) => state.activeFollowerJointTelemetryByName,
  );
  const worldLabsPrimarySceneActive = useWorldLabsPrimarySceneActive();
  const activeWorldScenePackageId = useWorldSceneRuntimeStore(
    (state) => state.activePackage?.packageId ?? null
  );
  const pointCloudAutocalibrationRequest = useOperatorPerceptionStore(
    (state) => state.pointCloudAutocalibrationRequest
  );
  const leaderTeleopAvailable = useOperatorLeaderTeleopStore(
    (state) => state.available,
  );
  const localLeaderAssigned = useOperatorLeaderTeleopStore(
    (state) => state.localLeaderAssigned,
  );
  const leaderTeleopUnavailableReason = useOperatorLeaderTeleopStore(
    (state) => state.reason,
  );
  const leaderTeleopViewerModeRequestId = useOperatorLeaderTeleopStore(
    (state) => state.viewerModeRequestId,
  );
  const leaderTeleopViewerModeExitRequestId = useOperatorLeaderTeleopStore(
    (state) => state.viewerModeExitRequestId,
  );
  const setLeaderTeleopViewerModeActive = useOperatorLeaderTeleopStore(
    (state) => state.setLeaderTeleopViewerModeActive,
  );
  const pointCloudAutocalibrationDecision = useOperatorPerceptionStore(
    (state) => state.pointCloudAutocalibrationDecision
  );
  const pointCloudSceneMeshRequest = useOperatorPerceptionStore(
    (state) => state.pointCloudSceneMeshRequest
  );
  const clearPointCloudAutocalibrationRequest = useOperatorPerceptionStore(
    (state) => state.clearPointCloudAutocalibrationRequest
  );
  const markPointCloudAutocalibrationReady = useOperatorPerceptionStore(
    (state) => state.markPointCloudAutocalibrationReady
  );
  const clearPointCloudAutocalibrationReview = useOperatorPerceptionStore(
    (state) => state.clearPointCloudAutocalibrationReview
  );
  const clearPointCloudAutocalibrationDecision = useOperatorPerceptionStore(
    (state) => state.clearPointCloudAutocalibrationDecision
  );
  const clearPointCloudSceneMeshRequest = useOperatorPerceptionStore(
    (state) => state.clearPointCloudSceneMeshRequest
  );
  const setPointCloudSceneMeshStatus = useOperatorPerceptionStore(
    (state) => state.setPointCloudSceneMeshStatus
  );
  const operatorPointCloudOverlayFrames = useMemo(
    () =>
      operatorPointCloudFrames.length > 0
        ? operatorPointCloudFrames
        : operatorPointCloudFrame
          ? [operatorPointCloudFrame]
          : [],
    [operatorPointCloudFrame, operatorPointCloudFrames],
  );
  const autocalibrationAccumulatorRef =
    useRef<PointCloudAutocalibrationAccumulator | null>(null);
  const [
    acceptedPointCloudFloorCalibrationsByCameraId,
    setAcceptedPointCloudFloorCalibrationsByCameraId,
  ] = useState<OperatorPointCloudFloorCalibrationByCameraId>({});
  const [
    pendingPointCloudFloorCalibrationsByCameraId,
    setPendingPointCloudFloorCalibrationsByCameraId,
  ] = useState<OperatorPointCloudFloorCalibrationByCameraId>({});
  const [
    pendingPointCloudAutocalibrationRequestId,
    setPendingPointCloudAutocalibrationRequestId,
  ] = useState<number | null>(null);
  const [
    operatorPointCloudCalibrationPlanes,
    setOperatorPointCloudCalibrationPlanes,
  ] = useState<OperatorPointCloudCalibrationPlaneOverlay[]>([]);
  const [
    acceptedOpenArmDemoTableCalibrationPlanes,
    setAcceptedOpenArmDemoTableCalibrationPlanes,
  ] = useState<OperatorPointCloudCalibrationPlaneOverlay[]>([]);
  const [
    bootstrappedOpenArmDemoTableCalibrationPlanes,
    setBootstrappedOpenArmDemoTableCalibrationPlanes,
  ] = useState<OpenArmDemoTableCalibrationPlane[]>([]);
  const operatorPointCloudFloorCalibrationsByCameraId = useMemo(
    () => ({
      ...acceptedPointCloudFloorCalibrationsByCameraId,
      ...pendingPointCloudFloorCalibrationsByCameraId,
    }),
    [
      acceptedPointCloudFloorCalibrationsByCameraId,
      pendingPointCloudFloorCalibrationsByCameraId,
    ],
  );
  const openArmDemoTableCalibrationPlanes = useMemo<
    readonly OpenArmDemoTableCalibrationPlane[]
  >(
    () =>
      operatorPointCloudCalibrationPlanes.length > 0
        ? operatorPointCloudCalibrationPlanes
        : acceptedOpenArmDemoTableCalibrationPlanes.length > 0
          ? acceptedOpenArmDemoTableCalibrationPlanes
          : bootstrappedOpenArmDemoTableCalibrationPlanes,
    [
      acceptedOpenArmDemoTableCalibrationPlanes,
      bootstrappedOpenArmDemoTableCalibrationPlanes,
      operatorPointCloudCalibrationPlanes,
    ],
  );
  useEffect(() => {
    if (!pointCloudSceneMeshRequest) return;

    if (operatorPointCloudOverlayFrames.length === 0) {
      setPointCloudSceneMeshStatus("No live point cloud available.");
      clearPointCloudSceneMeshRequest();
      return;
    }

    const sceneMeshes = resolveOperatorPointCloudSceneMeshes(
      operatorPointCloudOverlayFrames,
      operatorPointCloudFloorCalibrationsByCameraId,
      openArmDemoTableCalibrationPlanes,
    );
    const sceneObjects: Omit<CreatedObject, "id">[] = sceneMeshes.map(
      (mesh) => ({
        label: mesh.label,
        type: "cube",
        position: new THREE.Vector3(...mesh.position),
        rotation: new THREE.Euler(...mesh.rotationRpyRad, "XYZ"),
        size: new THREE.Vector3(...mesh.size),
        color: mesh.color,
        source: "runtime-detection",
        trackedJointName: null,
        isIkTarget: false,
      }),
    );

    replaceWorldObjectsBySource("runtime-detection", sceneObjects);
    setPointCloudSceneMeshStatus(
      sceneMeshes.length > 0
        ? `Created ${sceneMeshes.length} cloud scene mesh${
            sceneMeshes.length === 1 ? "" : "es"
          }.`
        : "No large planar cloud surfaces found.",
    );
    clearPointCloudSceneMeshRequest();
  }, [
    clearPointCloudSceneMeshRequest,
    operatorPointCloudFloorCalibrationsByCameraId,
    operatorPointCloudOverlayFrames,
    openArmDemoTableCalibrationPlanes,
    pointCloudSceneMeshRequest,
    replaceWorldObjectsBySource,
    setPointCloudSceneMeshStatus,
  ]);
  const finalizePointCloudAutocalibration = useCallback(
    (requestId: number) => {
      const accumulator = autocalibrationAccumulatorRef.current;
      if (!accumulator || accumulator.requestId !== requestId) return;

      const nextCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId =
        {};
      const nextPlanes: OperatorPointCloudCalibrationPlaneOverlay[] = [];
      for (const [cameraId, samples] of accumulator.samplesByCameraId) {
        const result =
          resolveOperatorPointCloudDominantSurfaceCalibrationResult(samples);
        if (!result) continue;
        nextCalibrationsByCameraId[cameraId] = result.calibration;
        nextPlanes.push({
          ...applyOperatorPointCloudFloorCalibrationToPlane(
            result.plane,
            result.calibration,
          ),
          cameraId,
        });
      }

      if (nextPlanes.length > 0) {
        setPendingPointCloudFloorCalibrationsByCameraId(
          nextCalibrationsByCameraId,
        );
        setPendingPointCloudAutocalibrationRequestId(requestId);
        setOperatorPointCloudCalibrationPlanes(nextPlanes);
        markPointCloudAutocalibrationReady(requestId, nextPlanes.length);
      }
      autocalibrationAccumulatorRef.current = null;
      clearPointCloudAutocalibrationRequest();
    },
    [clearPointCloudAutocalibrationRequest, markPointCloudAutocalibrationReady],
  );
  useEffect(() => {
    if (!pointCloudAutocalibrationRequest) {
      autocalibrationAccumulatorRef.current = null;
      return;
    }

    autocalibrationAccumulatorRef.current = {
      lastSampledAtMsByCameraId: new Map(),
      requestId: pointCloudAutocalibrationRequest.requestId,
      samplesByCameraId: new Map(),
    };
    setPendingPointCloudFloorCalibrationsByCameraId({});
    setPendingPointCloudAutocalibrationRequestId(null);
    setOperatorPointCloudCalibrationPlanes([]);
  }, [pointCloudAutocalibrationRequest]);
  useEffect(() => {
    if (!pointCloudAutocalibrationRequest) return;
    const timeoutId = window.setTimeout(
      () =>
        finalizePointCloudAutocalibration(
          pointCloudAutocalibrationRequest.requestId,
        ),
      pointCloudAutocalibrationRequest.durationMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [finalizePointCloudAutocalibration, pointCloudAutocalibrationRequest]);
  useEffect(() => {
    const accumulator = autocalibrationAccumulatorRef.current;
    if (
      !pointCloudAutocalibrationRequest ||
      !accumulator ||
      accumulator.requestId !== pointCloudAutocalibrationRequest.requestId
    ) {
      return;
    }

    for (const frame of operatorPointCloudOverlayFrames) {
      const sampleTimestampMs = Date.now();
      const lastSampledAtMs =
        accumulator.lastSampledAtMsByCameraId.get(frame.cameraId) ?? 0;
      if (
        sampleTimestampMs - lastSampledAtMs <
        OPERATOR_POINT_CLOUD_AUTOCALIBRATION_SAMPLE_INTERVAL_MS
      ) {
        continue;
      }
      const poseTransform = frame.cameraPose
        ? buildOperatorPointCloudPoseTransform(frame.cameraPose)
        : null;
      const samples = collectOperatorPointCloudWorldSamples(frame, poseTransform);
      if (samples.length === 0) continue;
      accumulator.lastSampledAtMsByCameraId.set(
        frame.cameraId,
        sampleTimestampMs,
      );
      const currentSamples =
        accumulator.samplesByCameraId.get(frame.cameraId) ?? [];
      const combinedSamples = [...currentSamples, ...samples];
      accumulator.samplesByCameraId.set(
        frame.cameraId,
        combinedSamples.slice(
          -OPERATOR_POINT_CLOUD_AUTOCALIBRATION_MAX_ACCUMULATED_SAMPLES,
        ),
      );
    }
  }, [operatorPointCloudOverlayFrames, pointCloudAutocalibrationRequest]);
  useEffect(() => {
    if (
      !openArmHfLiveObserveRequested ||
      !isOpenArmDemoRobot ||
      operatorPointCloudOverlayFrames.length === 0 ||
      operatorPointCloudCalibrationPlanes.length > 0 ||
      acceptedOpenArmDemoTableCalibrationPlanes.length > 0 ||
      bootstrappedOpenArmDemoTableCalibrationPlanes.length > 0
    ) {
      return;
    }

    const calibrationPlanes =
      resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames(
        operatorPointCloudOverlayFrames,
      );
    if (calibrationPlanes.length === 0) return;
    setBootstrappedOpenArmDemoTableCalibrationPlanes(calibrationPlanes);
  }, [
    acceptedOpenArmDemoTableCalibrationPlanes.length,
    bootstrappedOpenArmDemoTableCalibrationPlanes.length,
    isOpenArmDemoRobot,
    openArmHfLiveObserveRequested,
    operatorPointCloudCalibrationPlanes.length,
    operatorPointCloudOverlayFrames,
  ]);
  useEffect(() => {
    if (!pointCloudAutocalibrationDecision) return;
    if (
      pendingPointCloudAutocalibrationRequestId !==
      pointCloudAutocalibrationDecision.requestId
    ) {
      clearPointCloudAutocalibrationDecision();
      return;
    }

    if (pointCloudAutocalibrationDecision.action === "accept") {
      setAcceptedPointCloudFloorCalibrationsByCameraId((current) => ({
        ...current,
        ...pendingPointCloudFloorCalibrationsByCameraId,
      }));
      setAcceptedOpenArmDemoTableCalibrationPlanes(
        operatorPointCloudCalibrationPlanes,
      );
    }

    setPendingPointCloudFloorCalibrationsByCameraId({});
    setPendingPointCloudAutocalibrationRequestId(null);
    setOperatorPointCloudCalibrationPlanes([]);
    clearPointCloudAutocalibrationReview();
    clearPointCloudAutocalibrationDecision();
  }, [
    clearPointCloudAutocalibrationDecision,
    clearPointCloudAutocalibrationReview,
    pendingPointCloudAutocalibrationRequestId,
    pendingPointCloudFloorCalibrationsByCameraId,
    pointCloudAutocalibrationDecision,
    operatorPointCloudCalibrationPlanes,
  ]);
  useEffect(() => {
    if (
      openArmHfLiveObserveRequested ||
      operatorPointCloudOverlayFrames.length > 0
    ) {
      return;
    }
    setAcceptedPointCloudFloorCalibrationsByCameraId({});
    setAcceptedOpenArmDemoTableCalibrationPlanes([]);
    setBootstrappedOpenArmDemoTableCalibrationPlanes([]);
    setPendingPointCloudFloorCalibrationsByCameraId({});
    setPendingPointCloudAutocalibrationRequestId(null);
    setOperatorPointCloudCalibrationPlanes([]);
    clearPointCloudAutocalibrationReview();
    clearPointCloudAutocalibrationDecision();
  }, [
    clearPointCloudAutocalibrationDecision,
    clearPointCloudAutocalibrationReview,
    openArmHfLiveObserveRequested,
    operatorPointCloudOverlayFrames.length,
  ]);
  const livePointCloudCameraConfigs = useMemo<RobotCamera[]>(() => {
    if (!openArmHfLiveObserveRequested || !isOpenArmDemoRobot) return [];
    const insertedLiveCameraIds = insertedLiveCameraIdsRef.current;
    const storedNonLiveCameraKeys = new Set(
      cameraConfigs
        .filter((camera) => !insertedLiveCameraIds.has(camera.id))
        .flatMap((camera) => [camera.id, camera.name]),
    );
    return operatorPointCloudOverlayFrames.flatMap((frame) => {
      if (
        !frame.cameraPose ||
        !frame.cameraId.trim() ||
        storedNonLiveCameraKeys.has(frame.cameraId)
      ) {
        return [];
      }
      const liveCameraPose =
        resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose(frame.cameraPose);
      return [{
        id: frame.cameraId,
        name: frame.cameraId,
        parent_joint: OPENARM_HF_LIVE_CAMERA_PARENT_JOINT,
        pose: {
          xyz: liveCameraPose.xyz,
          rpy: liveCameraPose.rpy,
        },
        intrinsics: {
          width: frame.intrinsics.width,
          height: frame.intrinsics.height,
          fov_deg: OPENARM_HF_LIVE_CAMERA_FOV_DEG,
          fx: frame.intrinsics.fx,
          fy: frame.intrinsics.fy,
          cx: frame.intrinsics.ppx,
          cy: frame.intrinsics.ppy,
        },
      }];
    });
  }, [
    cameraConfigs,
    isOpenArmDemoRobot,
    openArmHfLiveObserveRequested,
    operatorPointCloudOverlayFrames,
  ]);
  useEffect(() => {
    const insertedLiveCameraIds = insertedLiveCameraIdsRef.current;
    const liveCameraIds = new Set(livePointCloudCameraConfigs.map((camera) => camera.id));
    const storeCameraKeys = new Set(
      cameraConfigs
        .filter((camera) => !insertedLiveCameraIds.has(camera.id))
        .flatMap((camera) => [camera.id, camera.name]),
    );
    const storeCameraById = new Map(
      cameraConfigs.map((camera) => [camera.id, camera] as const),
    );

    for (const camera of livePointCloudCameraConfigs) {
      if (storeCameraKeys.has(camera.id) || storeCameraKeys.has(camera.name)) continue;
      const storedCamera = storeCameraById.get(camera.id);
      const shouldUpsertCamera =
        !storedCamera ||
        storedCamera.name !== camera.name ||
        storedCamera.parent_joint !== camera.parent_joint ||
        !cameraPoseClose(storedCamera.pose, camera.pose) ||
        !cameraIntrinsicsClose(
          normalizeCameraIntrinsics(storedCamera.intrinsics),
          normalizeCameraIntrinsics(camera.intrinsics),
        );
      if (shouldUpsertCamera) {
        upsertCameraConfig(camera);
      }
      insertedLiveCameraIds.add(camera.id);
    }

    for (const cameraId of [...insertedLiveCameraIds]) {
      if (liveCameraIds.has(cameraId)) continue;
      removeCameraConfig(cameraId);
      insertedLiveCameraIds.delete(cameraId);
    }
  }, [cameraConfigs, livePointCloudCameraConfigs, removeCameraConfig, upsertCameraConfig]);
  const visibleCameraConfigs = useMemo(
    () => {
      const insertedLiveCameraIds = insertedLiveCameraIdsRef.current;
      const cameraConfigsByKey = new Map<string, RobotCamera>();
      const nonLiveCameraConfigs = cameraConfigs.filter(
        (camera) => !insertedLiveCameraIds.has(camera.id),
      );
      for (const camera of [...nonLiveCameraConfigs, ...livePointCloudCameraConfigs]) {
        const duplicateCamera = cameraConfigsByKey.get(camera.id) ??
          cameraConfigsByKey.get(camera.name);
        if (!duplicateCamera) {
          cameraConfigsByKey.set(camera.id, camera);
          cameraConfigsByKey.set(camera.name, camera);
        }
      }
      const cameraConfigsWithLive = [...new Set(cameraConfigsByKey.values())];
      return readOnlyMode
        ? cameraConfigsWithLive.filter(
            (camera) => !shouldHideCameraInReadOnlyRuntime(camera),
          )
        : cameraConfigsWithLive;
    },
    [cameraConfigs, livePointCloudCameraConfigs, readOnlyMode]
  );
  const cameraIconConfigs = useMemo(
    () =>
      filterVisibleCameraIconConfigs(
        visibleCameraConfigs,
        insertedLiveCameraIdsRef.current,
      ),
    [visibleCameraConfigs],
  );
  const setObjectEditMode = useObjectStore((state) => state.setEditMode);
  const duplicateObject = useObjectStore((state) => state.duplicateObject);
  const removeObject = useObjectStore((state) => state.removeObject);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const setDisplayMetrics = useDisplayStore((state) => state.setDisplayMetrics);
  const setDisplayStatus = useDisplayStore((state) => state.setDisplayStatus);
  const setDiagnosticHealth = useRuntimeHealthStore((state) => state.setDiagnostic);
  const getStudioUpAxis = useCallback(cloneStudioUpAxis, []);
  const studioWheelDriveRef = useRef<StudioWheelDriveState | null>(null);
  const selectedWorldObject = useMemo(
    () =>
      selectedObjectId != null
        ? worldObjects.find((object) => object.id === selectedObjectId) ?? null
        : null,
    [selectedObjectId, worldObjects]
  );
  const roverApproachWorldNavigationObjects = useMemo(
    () => worldObjects.map(serializeWorldObjectObstacleSource),
    [worldObjects]
  );
  const hasStudioRobot = !isAssemblyWorkspace && Boolean(robot);
  const canUseRoverGuide = hasStudioRobot;
  const robotFrontLocalDirectionRef = useRef(ROBOT_FRONT_LOCAL_FORWARD.clone());
  const lastSimulationPrepSymmetryCameraScopeKeyRef = useRef<string | null>(null);
  const lastSimulationPrepRobotMirrorCameraScopeKeyRef = useRef<string | null>(null);
  const ikEndEffectorLinks = useMemo(() => {
    if (isAssemblyWorkspace) {
      return [];
    }

    const selectedEe = endEffectorLink?.trim();
    if (selectedEe) {
      return [selectedEe];
    }

    return findAutoEndEffectorLinksFromAnalysis(urdfAnalysis)
      .map((link) => link.trim())
      .filter(Boolean);
  }, [endEffectorLink, isAssemblyWorkspace, urdfAnalysis]);
  const primaryIkEndEffectorLink = ikEndEffectorLinks[0] ?? null;
  const resolveRobotFrontLocalDirection = useCallback(() => {
    return robotFrontLocalDirectionRef.current.clone();
  }, []);
  useEffect(() => {
    if (!hasStudioRobot || !robot) {
      robotFrontLocalDirectionRef.current.copy(ROBOT_FRONT_LOCAL_FORWARD);
      return;
    }
    robot.updateMatrixWorld(true);
    const rootLinkName = resolveRobotRootLinkName(robot, urdfAnalysis?.rootLinks);
    const baseCameraForward = resolveBaseCameraForwardLocal({
      robot,
      cameras: visibleCameraConfigs,
      rootLinkName,
      worldUp: getStudioUpAxis(),
    });
    if (baseCameraForward) {
      robotFrontLocalDirectionRef.current.copy(baseCameraForward);
      return;
    }
    const baseCameraLinkForward = resolveBaseCameraLikeLinkForwardLocal({
      robot,
      rootLinkName,
      worldUp: getStudioUpAxis(),
    });
    if (baseCameraLinkForward) {
      robotFrontLocalDirectionRef.current.copy(baseCameraLinkForward);
      return;
    }
    robotFrontLocalDirectionRef.current.copy(ROBOT_FRONT_LOCAL_FORWARD);
  }, [hasStudioRobot, visibleCameraConfigs, getStudioUpAxis, robot, urdfAnalysis]);
  const resolveRobotFrontWorldDirection = useCallback(() => {
    const upAxis = getStudioUpAxis();
    if (!hasStudioRobot || !robot) {
      return projectDirectionOntoPlane(
        ROBOT_FRONT_LOCAL_FORWARD.clone(),
        upAxis,
        getPerpendicularDirection(upAxis)
      );
    }
    const localUp = localDirectionFromWorld(upAxis, robot.quaternion);
    const localForward = projectDirectionOntoPlane(
      resolveRobotFrontLocalDirection(),
      localUp,
      ROBOT_FRONT_LOCAL_FORWARD.clone()
    );
    return projectDirectionOntoPlane(
      worldDirectionFromLocal(localForward, robot.quaternion),
      upAxis,
      getPerpendicularDirection(upAxis)
    );
  }, [getStudioUpAxis, hasStudioRobot, resolveRobotFrontLocalDirection, robot]);
  const wheelActivityByJointNameRef = useRef<Record<string, number>>({});
  const wheelDriveJointOverridesRef = useRef<Record<string, boolean>>({});
  const wheelRoleLastUiUpdateMsRef = useRef(0);
  const playbackWheelSynthesisStateRef = useRef<{
    position: THREE.Vector3;
    forwardWorld: THREE.Vector3;
  } | null>(null);
  const wheelDriveBaseLockRef = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);
  const autoRoverApproachActiveRef = useRef(false);
  const manualApproachInterruptRef = useRef(false);
  const roverApproachGuideLineRef = useRef(createRoverApproachGuideLineState());
  const roverApproachRoutePreviewRef = useRef(createRoverApproachRoutePreviewState());
  const hideRoverApproachVisualOverlay = useCallback(() => {
    hideRoverApproachGuideLine(roverApproachGuideLineRef.current);
    hideRoverApproachRoutePreview(roverApproachRoutePreviewRef.current);
  }, []);
  const hideRoverApproachRoutePreviewOverlay = useCallback(() => {
    hideRoverApproachRoutePreview(roverApproachRoutePreviewRef.current);
  }, []);
  const wheelLocomotionArmedRef = useRef(false);
  const armWheelLocomotion = useCallback(() => {
    wheelLocomotionArmedRef.current = true;
  }, []);
  const disarmWheelLocomotion = useCallback(() => {
    wheelLocomotionArmedRef.current = false;
  }, []);
  useEffect(() => {
    if (!hasStudioRobot || !robot) {
      hideRoverApproachVisualOverlay();
    }
  }, [hasStudioRobot, hideRoverApproachVisualOverlay, robot]);
  useEffect(() => {
    if (!isPlaying) {
      playbackWheelSynthesisStateRef.current = null;
    }
  }, [isPlaying]);
  useEffect(() => {
    if (!hasStudioRobot || !robot) {
      playbackWheelSynthesisStateRef.current = null;
    }
  }, [hasStudioRobot, robot]);
  const { urdfContent } = useUrdfFileContent({
    urdfFile,
    robot,
    onLinkSelect,
    onAutoOpenFk: () => {},
  });
  const effectiveUrdfForWheelHints =
    typeof vizUrdfContent === "string" && vizUrdfContent.trim().length > 0
      ? vizUrdfContent
      : urdfContent ?? "";
  const studioDriveJointHints = useMemo(
    () => extractStudioDriveJointHintsFromUrdf(effectiveUrdfForWheelHints),
    [effectiveUrdfForWheelHints]
  );
  useEffect(() => {
    wheelDriveEnabledRef.current = wheelDriveEnabled;
  }, [wheelDriveEnabled]);
  useEffect(() => {
    wheelDriveJointOverridesRef.current = wheelDriveJointOverrides;
  }, [wheelDriveJointOverrides]);
  useEffect(() => {
    const wheelDrive = studioWheelDriveRef.current;
    if (!wheelDrive) return;
    const driveWheelNameSet = new Set(
      getPreferredStudioDriveWheels(wheelDrive.model, wheelDriveJointOverrides).map(
        (wheel) => wheel.jointName
      )
    );
    setStudioWheelRoleEntries(
      buildStudioWheelRoleEntries(
        wheelDrive.model,
        wheelActivityByJointNameRef.current,
        driveWheelNameSet
      )
    );
  }, [wheelDriveJointOverrides]);
  const studioWheelJointNameSet = useMemo<Set<string>>(
    () => new Set(Object.keys(robot?.joints ?? {})),
    [robot]
  );
  const studioWheelRoleDisplayEntries = useMemo<StudioWheelRoleDisplayEntry[]>(
    () => toStudioWheelRoleDisplayEntries(studioWheelRoleEntries, studioWheelJointNameSet),
    [studioWheelJointNameSet, studioWheelRoleEntries]
  );
  const activeStudioWheelDriveCount = useMemo(
    () =>
      studioWheelRoleDisplayEntries.filter((entry) => entry.driveEnabled).length,
    [studioWheelRoleDisplayEntries]
  );
  const studioWheelDriveAuthority = useMemo(
    () =>
      computeStudioWheelDriveAuthority(
        studioWheelRoleDisplayEntries.map((entry) => ({
          jointName: entry.jointName,
          side: entry.side,
        })),
        new Set(
          studioWheelRoleDisplayEntries
            .filter((entry) => entry.driveEnabled)
            .map((entry) => entry.jointName)
        )
      ),
    [studioWheelRoleDisplayEntries]
  );
  const studioWheelRoleMarkers = useMemo<StudioWheelRoleMarker[]>(() => {
    if (!hasStudioRobot || !isWheelRolesOpen || !robot) return [];
    return studioWheelRoleDisplayEntries
      .map((entry) => {
        const joint = robot.joints?.[entry.jointName];
        if (!joint) return null;
        return {
          jointName: entry.jointName,
          wheelNumber: entry.wheelNumber,
          driveEnabled: entry.driveEnabled,
          side: entry.side,
          role: entry.role,
          anchorObject: resolveStudioWheelMarkerAnchorObject(joint),
        } satisfies StudioWheelRoleMarker;
      })
      .filter((entry): entry is StudioWheelRoleMarker => Boolean(entry));
  }, [hasStudioRobot, isWheelRolesOpen, robot, studioWheelRoleDisplayEntries]);
  const linkInertials = useMemo(
    () => (isAssemblyWorkspace ? [] : extractLinkInertials(urdfAnalysis, urdfContent ?? "")),
    [isAssemblyWorkspace, urdfAnalysis, urdfContent]
  );
  const inertialStats = useMemo(
    () =>
      isAssemblyWorkspace
        ? {
            totalMass: 0,
            contributingLinks: 0,
            totalLinks: 0,
            missingInertialLinks: [],
            invalidMassLinks: [],
            invalidTensorLinks: [],
          }
        : computeInertialStats(urdfAnalysis, urdfContent ?? ""),
    [isAssemblyWorkspace, urdfAnalysis, urdfContent]
  );

  // Drag mode state
  const [dragMode, setDragMode] = useState<DragMode>(() =>
    isAssemblyWorkspace ? "move-joints" : "drag-handle"
  );
  const canUseDragHandleMode = useMemo(
    () =>
      canUseViewerDragHandleMode({
        isAssemblyWorkspace,
        simulationPrepPanelOpen,
      }),
    [isAssemblyWorkspace, simulationPrepPanelOpen]
  );
  const canUseLeaderTeleopMode = useMemo(
    () =>
      canUseViewerLeaderTeleopMode({
        leaderTeleopAvailable: leaderTeleopAvailable || localLeaderAssigned,
        isAssemblyWorkspace,
      }),
    [leaderTeleopAvailable, localLeaderAssigned, isAssemblyWorkspace],
  );
  const canOpenDragModeMenu = canUseDragHandleMode || canUseLeaderTeleopMode;
  const effectiveDragMode = useMemo(
    () =>
      resolveEffectiveViewerDragMode({
        dragMode,
        leaderTeleopAvailable: leaderTeleopAvailable || localLeaderAssigned,
        isAssemblyWorkspace,
        simulationPrepPanelOpen,
      }),
    [
      dragMode,
      leaderTeleopAvailable,
      localLeaderAssigned,
      isAssemblyWorkspace,
      simulationPrepPanelOpen,
    ]
  );
  const liveTeleopJointTelemetryByName = useMemo(
    () =>
      resolveLiveTeleopJointTelemetryByName({
        leaderTelemetryByName: liveLeaderJointTelemetryByName,
        followerTelemetryByName: liveFollowerJointTelemetryByName,
      }),
    [liveFollowerJointTelemetryByName, liveLeaderJointTelemetryByName],
  );
  const liveTeleopJointTelemetryCount = Object.keys(
    liveTeleopJointTelemetryByName,
  ).length;
  const liveTeleopJointSyncActive =
    resolveLiveTeleopJointSyncActive({
      dragMode: effectiveDragMode,
      isPlaying,
      liveTelemetryCount: liveTeleopJointTelemetryCount,
    });
  useOperatorLeaderTelemetryBridge({
    active: effectiveDragMode === "hardware-teleop" && localLeaderAssigned && !isPlaying,
    availableJointNames,
  });
  useEffect(() => {
    const active = effectiveDragMode === "hardware-teleop";
    setLeaderTeleopViewerModeActive(active);
    return () => setLeaderTeleopViewerModeActive(false);
  }, [effectiveDragMode, setLeaderTeleopViewerModeActive]);
  const readOnlyNoticeShownAtRef = useRef<number | null>(null);
  const [isDragModeMenuOpen, setIsDragModeMenuOpen] = useState(false);
  const handledLeaderTeleopViewerModeRequestIdRef = useRef(0);
  useEffect(() => {
    if (leaderTeleopViewerModeRequestId <= 0) return;
    if (
      handledLeaderTeleopViewerModeRequestIdRef.current ===
      leaderTeleopViewerModeRequestId
    ) {
      return;
    }
    if (!canUseLeaderTeleopMode) return;
    handledLeaderTeleopViewerModeRequestIdRef.current =
      leaderTeleopViewerModeRequestId;
    setDragMode("hardware-teleop");
    setIsDragModeMenuOpen(false);
  }, [canUseLeaderTeleopMode, leaderTeleopViewerModeRequestId]);
  const handledLeaderTeleopViewerModeExitRequestIdRef = useRef(0);
  useEffect(() => {
    if (leaderTeleopViewerModeExitRequestId <= 0) return;
    if (
      handledLeaderTeleopViewerModeExitRequestIdRef.current ===
      leaderTeleopViewerModeExitRequestId
    ) {
      return;
    }
    handledLeaderTeleopViewerModeExitRequestIdRef.current =
      leaderTeleopViewerModeExitRequestId;
    if (dragMode !== "hardware-teleop") return;
    setDragMode(canUseDragHandleMode ? "drag-handle" : "move-joints");
    setIsDragModeMenuOpen(false);
  }, [
    canUseDragHandleMode,
    dragMode,
    leaderTeleopViewerModeExitRequestId,
  ]);
  useEffect(() => {
    if (dragMode === "hardware-teleop" && !canUseLeaderTeleopMode) {
      setDragMode(canUseDragHandleMode ? "drag-handle" : "move-joints");
      setIsDragModeMenuOpen(false);
      return;
    }
    if (!canUseDragHandleMode && dragMode !== "move-joints") {
      setDragMode("move-joints");
      setIsDragModeMenuOpen(false);
    }
  }, [canUseDragHandleMode, canUseLeaderTeleopMode, dragMode]);

  useEffect(() => {
    if (!liveTeleopJointSyncActive) return;
    const currentJointValues = useJointStore.getState().jointValues;
    const { jointValues: liveJointValues, changed } =
      resolveLiveTeleopJointTargets({
        telemetryByName: liveTeleopJointTelemetryByName,
        availableJointNames,
        currentJointValues,
      });
    if (!changed || Object.keys(liveJointValues).length === 0) return;
    setStoreJointValues({
      ...currentJointValues,
      ...liveJointValues,
    });
  }, [
    availableJointNames,
    liveTeleopJointSyncActive,
    liveTeleopJointTelemetryByName,
    setStoreJointValues,
  ]);

  const motionKernel = useMemo(() => {
    if (!motionKernelEnabled || isAssemblyWorkspace || !robot) {
      return null;
    }
    const partitions = buildMotionPartitions({
      robot,
      urdfAnalysis,
      endEffectorLinks: ikEndEffectorLinks,
    });
    return createMotionKernel(partitions);
  }, [ikEndEffectorLinks, isAssemblyWorkspace, motionKernelEnabled, robot, urdfAnalysis]);
  const adaptiveTrajectoryRepository = useMemo(
    () => createLocalStorageAdaptiveTrajectoryRepository(),
    []
  );
  const ikAllowedJointNamesByEe = useMemo(() => {
    const byEe = new Map<string, string[]>();
    motionKernel?.partitions.manipulators.forEach((manipulator) => {
      byEe.set(manipulator.endEffectorLink, manipulator.ownedJointNames);
    });
    return byEe;
  }, [motionKernel]);
  const resetApproachArmTargetsRef = useRef<() => Record<string, number>>(() => ({}));
  const enforceRoverApproachPlanarPose = useCallback(
    (targetRobot: URDFRobot) => {
      clampStudioPlanarPose(targetRobot, getStudioUpAxis());
    },
    [getStudioUpAxis]
  );
  const runRoverApproachBeforeIkSolve = useCallback(
    async (context: IkObjectPreSolveContext): Promise<IkObjectPreSolveResult> =>
      executeRoverApproachBeforeIkSolve({
        context,
        isAssemblyWorkspace,
        robot,
        urdfAnalysis,
        primaryIkEndEffectorLink,
        wheelDriveEnabled,
        worldObjects,
        roverApproachWorldNavigationObjects,
        getStudioUpAxis,
        resolveRobotFrontWorldDirection,
        hideRoverApproachRoutePreviewOverlay,
        enforceRoverApproachPlanarPose,
        resolveRoverApproachRobotFootprint,
        resolveRoverFootprintSupportRadiusM:
          resolveRoverApproachFootprintSupportRadiusM,
        manualApproachInterruptRef,
        autoRoverApproachActiveRef,
        wheelDriveEnabledRef,
        studioWheelDriveRef,
        wheelDriveJointOverridesRef,
        roverApproachGuideLineRef,
        roverApproachRoutePreviewRef,
        resetApproachArmTargetsRef,
        setDisplayStatus,
        setDisplayMetrics,
        setDiagnosticHealth,
        setStoreJointValue,
      }),
    [
      enforceRoverApproachPlanarPose,
      getStudioUpAxis,
      hideRoverApproachRoutePreviewOverlay,
      isAssemblyWorkspace,
      primaryIkEndEffectorLink,
      robot,
      roverApproachWorldNavigationObjects,
      resolveRobotFrontWorldDirection,
      setDiagnosticHealth,
      setDisplayMetrics,
      setDisplayStatus,
      setStoreJointValue,
      urdfAnalysis,
      wheelDriveEnabled,
      worldObjects,
    ]
  );

  const {
    followOrbitIncremental,
    handleIkDragSolved,
    handleIkDragStateChange,
    ikDialogOpen,
    ikDragEnabled,
    ikError,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkHandleDragging,
    isIkRunning,
    liveIkSeedValues,
    orbitFollowProgress,
    cancelActiveObjectSolve,
    retryRememberedBlockedObjectSolve,
    setIkDialogOpen,
    solveIkForObject,
    stopOrbitFollow,
  } = useIkSolver({
    apiBaseUrl: API_BASE_URL,
    dragMode: effectiveDragMode,
    robot,
    urdfContent,
    urdfAnalysis,
    endEffectorLink: primaryIkEndEffectorLink,
    jointLimits,
    onIkApplied,
    onManualJointChange: animationController.markManualJointChange,
    allowRemote: FEATURE_GATES.ikRemoteSolve.enabled,
    enableIk:
      !ikDragSuppressed &&
      !isAssemblyWorkspace &&
      (!readOnlyMode || enableObjectActionsInReadOnly),
    motionKernel,
    wheelDriveEnabled,
    onBeforeObjectIkSolve: runRoverApproachBeforeIkSolve,
  });
  const hasActiveObjectTargetInteraction = isObjectTargetInteractionActive({
    isIkRunning,
    isIkTrajectoryApplying,
    isFollowingOrbit,
  });
  useEffect(() => {
    if (
      !canUseRoverGuide ||
      !robot ||
      !shouldShowRoverApproachGuideForSelectedObject({
        hasActiveObjectTargetInteraction,
        selectedObject: selectedWorldObject,
      })
    ) {
      hideRoverApproachVisualOverlay();
      return;
    }
    const baseWorld = new THREE.Vector3();
    robot.updateMatrixWorld(true);
    robot.getWorldPosition(baseWorld);
    updateRoverApproachGuideLineToTarget({
      guideState: roverApproachGuideLineRef.current,
      robot,
      object: selectedWorldObject,
      endEffectorLink: primaryIkEndEffectorLink,
      fallbackSegmentStartWorld: baseWorld,
      targetWorld: selectedWorldObject.position,
      upAxisWorld: getStudioUpAxis(),
    });
    return () => {
      hideRoverApproachVisualOverlay();
    };
  }, [
    getStudioUpAxis,
    hasActiveObjectTargetInteraction,
    hideRoverApproachVisualOverlay,
    primaryIkEndEffectorLink,
    robot,
    canUseRoverGuide,
    selectedWorldObject,
  ]);
  const applyRoverBrakeStop = useCallback(() => {
    manualApproachInterruptRef.current = true;
    cancelActiveObjectSolve();
    disarmWheelLocomotion();
  }, [cancelActiveObjectSolve, disarmWheelLocomotion]);
  const handleStudioBaseDragStart = useCallback(() => {
    manualApproachInterruptRef.current = true;
    cancelActiveObjectSolve();
  }, [cancelActiveObjectSolve]);
  const handleStudioBaseDragEnd = useCallback(() => {
    retryRememberedBlockedObjectSolve();
  }, [retryRememberedBlockedObjectSolve]);

  const endEffectorPose = useMemo(
    () =>
      primaryIkEndEffectorLink && robot
        ? extractLinkPose(robot, primaryIkEndEffectorLink)
        : null,
    [primaryIkEndEffectorLink, robot]
  );
  const activeIkDragHandlesRef = useRef<Set<string>>(new Set());
  const handlePerEeDragStateChange = useCallback(
    (eeLink: string, dragging: boolean) => {
      const activeHandles = activeIkDragHandlesRef.current;
      const hadHandle = activeHandles.has(eeLink);
      if (dragging) {
        if (hadHandle) {
          return;
        }
        const wasEmpty = activeHandles.size === 0;
        activeHandles.add(eeLink);
        if (wasEmpty) {
          handleIkDragStateChange(true);
        }
        return;
      }
      if (!hadHandle) {
        return;
      }
      activeHandles.delete(eeLink);
      if (activeHandles.size === 0) {
        // Pass the specific eeLink so only its smooth state is cleared; other
        // simultaneous handles (collaborative session) are unaffected.
        handleIkDragStateChange(false, eeLink);
      }
    },
    [handleIkDragStateChange]
  );
  useEffect(() => {
    if (activeIkDragHandlesRef.current.size === 0) {
      return;
    }
    const validLinks = new Set(ikEndEffectorLinks);
    let hasRemoved = false;
    activeIkDragHandlesRef.current.forEach((linkName) => {
      if (!validLinks.has(linkName)) {
        activeIkDragHandlesRef.current.delete(linkName);
        hasRemoved = true;
      }
    });
    if (hasRemoved && activeIkDragHandlesRef.current.size === 0) {
      handleIkDragStateChange(false);
    }
  }, [handleIkDragStateChange, ikEndEffectorLinks]);
  useEffect(() => {
    if (ikDragEnabled || activeIkDragHandlesRef.current.size === 0) {
      return;
    }
    activeIkDragHandlesRef.current.clear();
    handleIkDragStateChange(false);
  }, [handleIkDragStateChange, ikDragEnabled]);

  const enforceStudioPlanarPose = useCallback(
    (targetRobot: URDFRobot) => clampStudioPlanarPose(targetRobot, getStudioUpAxis()),
    [getStudioUpAxis]
  );
  const captureWheelDriveBaseLock = useCallback((targetRobot: URDFRobot) => {
    wheelDriveBaseLockRef.current = {
      position: targetRobot.position.clone(),
      quaternion: targetRobot.quaternion.clone(),
    };
  }, []);
  const enforceWheelDriveBaseLock = useCallback(
    (targetRobot: URDFRobot) => {
      if (!wheelDriveBaseLockRef.current) {
        captureWheelDriveBaseLock(targetRobot);
      }
      const lockedPose = wheelDriveBaseLockRef.current;
      if (!lockedPose) {
        return;
      }
      targetRobot.position.copy(lockedPose.position);
      targetRobot.quaternion.copy(lockedPose.quaternion);
      targetRobot.updateMatrixWorld(true);
    },
    [captureWheelDriveBaseLock]
  );

  const clampIkSolutionForApply = useCallback(
    (solution: Record<string, number>) => {
      if (!jointLimits || Object.keys(jointLimits).length === 0) {
        return { solution, clampedJoints: [] as string[] };
      }
      const clamped: Record<string, number> = { ...solution };
      const clampedJoints: string[] = [];
      Object.entries(solution).forEach(([jointName, value]) => {
        if (!Number.isFinite(value)) return;
        const limits = getJointLimits(jointLimits, jointName);
        if (!Number.isFinite(limits.lower) || !Number.isFinite(limits.upper)) {
          return;
        }
        if (value < limits.lower || value > limits.upper) {
          clamped[jointName] = Math.min(limits.upper, Math.max(limits.lower, value));
          clampedJoints.push(jointName);
        }
      });
      return { solution: clamped, clampedJoints };
    },
    [jointLimits]
  );
  const cancelIkApplyAnimation = useCallback(() => {
    ikApplyTokenRef.current += 1;
    setIsIkTrajectoryApplying(false);
    if (ikApplyAnimationRef.current !== null) {
      cancelAnimationFrame(ikApplyAnimationRef.current);
      ikApplyAnimationRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelIkApplyAnimation();
    };
  }, [cancelIkApplyAnimation]);

  const applyIkSolutionWithPath = useCallback(
    (
      targetSolution: Record<string, number>,
      onComplete?: () => void
    ) => {
      const armAllowedJoints = primaryIkEndEffectorLink
        ? new Set(ikAllowedJointNamesByEe.get(primaryIkEndEffectorLink) ?? [])
        : null;
      let scopedTargetSolution = motionKernel
        ? motionKernel.sanitizeManipulatorTargets(targetSolution, {
            endEffectorLink: primaryIkEndEffectorLink,
            wheelDriveEnabled,
          })
        : targetSolution;
      if (!motionKernel && armAllowedJoints && armAllowedJoints.size > 0) {
        const armOnlySolution: Record<string, number> = {};
        Object.entries(scopedTargetSolution).forEach(([jointName, value]) => {
          if (!Number.isFinite(value)) return;
          if (!armAllowedJoints.has(jointName)) return;
          armOnlySolution[jointName] = value;
        });
        scopedTargetSolution = armOnlySolution;
      }
      const targetJoints = Object.entries(scopedTargetSolution).filter(([, value]) =>
        Number.isFinite(value)
      );
      cancelIkApplyAnimation();
      if (targetJoints.length === 0) {
        onComplete?.();
        return;
      }

      animationController.markManualJointChange();

      const jointState = useJointStore.getState();
      const startSnapshot = { ...jointState.jointValues };
      const velocityLimitEnabled = jointState.velocityLimitEnabled;
      const globalMaxVelocity = Math.max(
        Number.isFinite(jointState.globalMaxJointVelocity)
          ? jointState.globalMaxJointVelocity
          : 1,
        0.05
      );

      const deltas: Record<string, number> = {};
      const jointSpecs: Array<{
        jointName: string;
        startValue: number;
        targetValue: number;
        maxVelocity: number;
        maxAcceleration: number;
      }> = [];
      const velocityFloorRadPerSec = 2.6;
      let requiredTimeSec = 0;

      for (const [jointName, rawTarget] of targetJoints) {
        const target = rawTarget as number;
        const start = Number.isFinite(startSnapshot[jointName])
          ? startSnapshot[jointName]
          : target;
        deltas[jointName] = target - start;
        const configuredLimit = jointState.jointVelocityLimits[jointName];
        const baseVelocity = velocityLimitEnabled
          ? Number.isFinite(configuredLimit ?? NaN)
            ? (configuredLimit as number)
            : globalMaxVelocity
          : globalMaxVelocity;
        const motionSafetyVelocityLimit = resolveIkMotionSafetyVelocityLimit(
          jointLimits,
          jointName
        );
        const maxVelocity = Math.min(
          Math.max(baseVelocity, velocityFloorRadPerSec),
          motionSafetyVelocityLimit
        );
        const maxAcceleration = Math.min(
          Math.max(maxVelocity * 6, 0.8),
          resolveIkMotionSafetyAccelerationLimit()
        );
        jointSpecs.push({
          jointName,
          startValue: start,
          targetValue: target,
          maxVelocity,
          maxAcceleration,
        });
        const timeSec = Math.abs(deltas[jointName]) / Math.max(maxVelocity, 1e-6);
        if (timeSec > requiredTimeSec) {
          requiredTimeSec = timeSec;
        }
      }

      const maxDelta = Math.max(...Object.values(deltas).map((value) => Math.abs(value)), 0);
      if (maxDelta <= 1e-4) {
        const merged = { ...useJointStore.getState().jointValues, ...scopedTargetSolution };
        if (robot) {
          applyJointValues(robot, merged, { filter: false });
          if (!isAssemblyWorkspace) {
            if (wheelDriveEnabled) {
              enforceStudioPlanarPose(robot);
            } else {
              enforceWheelDriveBaseLock(robot);
            }
          } else {
            robot.updateMatrixWorld?.(true);
          }
        }
        setStoreJointValues(merged);
        onIkApplied?.(merged, {
          inputSource: OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
        });
        onComplete?.();
        setIsIkTrajectoryApplying(false);
        return;
      }

      setIsIkTrajectoryApplying(true);
      const token = ++ikApplyTokenRef.current;
      const startTime = performance.now();
      let lastFrameTime = startTime;
      const minDtSec = 1 / 240;
      const maxDtSec = 1 / 30;
      const epsilon = 8e-5;
      const completionTolerance = 8e-4;
      const durationSec = Math.max(0.1, Math.min(0.5, requiredTimeSec * 1.2));
      const maxRuntimeMs = Math.min(
        8000,
        Math.max(2500, Math.round(requiredTimeSec * 5000))
      );
      const trajectoryContextKey = [
        (urdfFile?.name ?? robot?.name ?? "robot").toLowerCase(),
        targetJoints
          .map(([jointName]) => jointName)
          .sort((lhs, rhs) => lhs.localeCompare(rhs))
          .join("|"),
      ].join("::");
      const trajectoryRuntime = new AdaptiveTrajectoryRuntime({
        contextKey: trajectoryContextKey,
        jointSpecs,
        durationSec,
        epsilon,
        completionTolerance,
        repository: adaptiveTrajectoryRepository,
      });

      const step = (now: number) => {
        if (ikApplyTokenRef.current !== token) return;
        const rawDtSec = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        const dtSec = Math.min(
          maxDtSec,
          Math.max(
            minDtSec,
            Number.isFinite(rawDtSec) && rawDtSec > 0 ? rawDtSec : minDtSec
          )
        );
        const elapsedSec = Math.max(0, (now - startTime) / 1000);

        const currentValues = { ...useJointStore.getState().jointValues };
        const stepResult = trajectoryRuntime.step(currentValues, elapsedSec, dtSec);
        const frameValues = {
          ...currentValues,
          ...stepResult.desiredValues,
        };
        let unresolvedJoints = stepResult.unresolvedJoints;
        const hasChange = stepResult.hasChange;
        const nextFrameValues = frameValues;
        if (hasChange) {
          trajectoryRuntime.reconcileApplied(currentValues, nextFrameValues, dtSec);
        }

        if (hasChange && robot) {
          applyJointValues(robot, nextFrameValues, { filter: false });
          if (!isAssemblyWorkspace) {
            if (wheelDriveEnabled) {
              enforceStudioPlanarPose(robot);
            } else {
              enforceWheelDriveBaseLock(robot);
            }
          } else {
            robot.updateMatrixWorld?.(true);
          }
        }
        if (hasChange) {
          setStoreJointValues(nextFrameValues);
        }

        unresolvedJoints = 0;
        for (const [jointName, rawTarget] of targetJoints) {
          const target = rawTarget as number;
          const next = nextFrameValues[jointName];
          if (!Number.isFinite(next)) continue;
          if (Math.abs(target - next) > completionTolerance) {
            unresolvedJoints += 1;
          }
        }
        const runtimeMs = now - startTime;
        if (unresolvedJoints > 0 && runtimeMs < maxRuntimeMs) {
          ikApplyAnimationRef.current = requestAnimationFrame(step);
          return;
        }

        const didConverge = unresolvedJoints === 0;
        trajectoryRuntime.finalize(didConverge, runtimeMs);

        ikApplyAnimationRef.current = null;
        const finalValues = nextFrameValues;
        if (robot) {
          applyJointValues(robot, finalValues, { filter: false });
          if (!isAssemblyWorkspace) {
            if (wheelDriveEnabled) {
              enforceStudioPlanarPose(robot);
            } else {
              enforceWheelDriveBaseLock(robot);
            }
          } else {
            robot.updateMatrixWorld?.(true);
          }
        }
        setStoreJointValues(finalValues);
        onIkApplied?.(finalValues, {
          inputSource: OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
        });
        onComplete?.();
        setIsIkTrajectoryApplying(false);
      };

      ikApplyAnimationRef.current = requestAnimationFrame(step);
    },
    [
      animationController,
      cancelIkApplyAnimation,
      enforceWheelDriveBaseLock,
      enforceStudioPlanarPose,
      isAssemblyWorkspace,
      onIkApplied,
      ikAllowedJointNamesByEe,
      jointLimits,
      motionKernel,
      primaryIkEndEffectorLink,
      robot,
      urdfFile,
      setStoreJointValues,
      setIsIkTrajectoryApplying,
      wheelDriveEnabled,
      adaptiveTrajectoryRepository,
    ]
  );

  const lastAutoAppliedResultRef = useRef<IkResponsePayload | null>(null);
  const closeIkDialog = useCallback(() => {
    setIkDialogOpen(false);
  }, [setIkDialogOpen]);
  const handleObjectIkTargetClick = useCallback(
    (targetObject: CreatedObject) => {
      manualApproachInterruptRef.current = true;
      cancelActiveObjectSolve();
      cancelIkApplyAnimation();
      stopOrbitFollow();
      lastAutoAppliedResultRef.current = null;
      solveIkForObject(targetObject);
    },
    [
      cancelActiveObjectSolve,
      cancelIkApplyAnimation,
      solveIkForObject,
      stopOrbitFollow,
    ]
  );
  useEffect(() => {
    if (!ikResult || isIkRunning || !ikTargetName) return;
    if (lastAutoAppliedResultRef.current === ikResult) return;
    lastAutoAppliedResultRef.current = ikResult;

    const { solution } = clampIkSolutionForApply(ikResult.solution);
    const scopedArmSolution = motionKernel
      ? motionKernel.sanitizeManipulatorTargets(solution, {
          endEffectorLink: primaryIkEndEffectorLink,
          wheelDriveEnabled,
        })
      : solution;
    const openPostureSolution = scopedArmSolution;
    const targetObj = useObjectStore.getState().objects.find((o) => o.id === ikTargetName);
    const shouldFollowOrbit = targetObj?.ikTargetType === "orbit";
    applyIkSolutionWithPath(openPostureSolution, () => {
      if (shouldFollowOrbit && !isFollowingOrbit) {
        followOrbitIncremental(ikTargetName);
      }
    });
    closeIkDialog();
  }, [
    applyIkSolutionWithPath,
    clampIkSolutionForApply,
    followOrbitIncremental,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkRunning,
    motionKernel,
    primaryIkEndEffectorLink,
    closeIkDialog,
    wheelDriveEnabled,
  ]);

  // Use selectedLink from props
  const selectedLink = selectedLinkProp;

  const formatVec3 = useCallback((vec: [number, number, number], digits = 4) => {
    return `${vec[0].toFixed(digits)}, ${vec[1].toFixed(digits)}, ${vec[2].toFixed(digits)}`;
  }, []);

  const comPosition = (() => {
    if (isAssemblyWorkspace) return null;
    const com = computeCenterOfMassWorld(robot, linkInertials);
    return com ? ([com.x, com.y, com.z] as [number, number, number]) : null;
  })();
  const comPositionText = comPosition ? formatVec3(comPosition, 2) : "--";
  const totalMassText =
    inertialStats.totalMass > 0 ? `${inertialStats.totalMass.toFixed(2)} kg` : "--";

  const eePositionText = endEffectorPose
    ? formatVec3(endEffectorPose.position, 2)
    : "--";
  const eeHandlesText =
    ikEndEffectorLinks.length > 0
      ? ikEndEffectorLinks.map((linkName, index) => `${index + 1}:${linkName}`).join(" · ")
      : "None";
  const eeHeaderText = ikEndEffectorLinks.length === 1 ? "EE" : "EEs";
  const jointNamesByType = useMemo(() => {
    const namesByType: Record<string, string[]> = {};
    Object.entries(jointLimits || {}).forEach(([name, info]) => {
      const type = info?.type || "continuous";
      const existing = namesByType[type];
      if (existing) {
        existing.push(name);
      } else {
        namesByType[type] = [name];
      }
    });
    return namesByType;
  }, [jointLimits]);
  const selectFirstJointOfType = useCallback((type: string) => {
    const typeJoints = jointNamesByType[type] ?? [];
    if (typeJoints.length > 0 && onJointSelect) {
      onJointSelect(typeJoints[0]);
    }
  }, [jointNamesByType, onJointSelect]);
  const selectedCameraIdForCentering = useCameraStore((state) => state.selectedCameraId);
  const setLiveRobotBasePose = useRobotPoseStore((state) => state.setPose);
  const clearLiveRobotBasePose = useRobotPoseStore((state) => state.clearPose);
  const viewerPolicy = useMemo(
    () => {
      const showSceneChrome = !thumbnailMode;
      const showEditableChrome = showSceneChrome && !readOnlyMode;
      const showStudioSceneChrome = showSceneChrome && workspaceModeUi.showStudioChrome;
      const showStudioEditableSceneChrome = showStudioSceneChrome && !readOnlyMode;
      const renderPerformancePolicy = buildViewerRenderPerformancePolicy({
        requestedGpuMode: gpuMode,
        workspaceMode,
        thumbnailMode,
        readOnlyMode,
        showStudioSceneChrome,
      });

      return {
        hasStudioRobot,
        canUseReadOnlyRoverGuide: readOnlyMode && hasStudioRobot,
        showSceneChrome,
        showEditableChrome,
        showStudioSceneChrome,
        showStudioEditableSceneChrome,
        showTopRightTools: showStudioSceneChrome && Boolean(urdfFile),
        showHeader: showEditableChrome,
        ...renderPerformancePolicy,
      };
    },
    [
      gpuMode,
      hasStudioRobot,
      readOnlyMode,
      thumbnailMode,
      urdfFile,
      workspaceMode,
      workspaceModeUi.showStudioChrome,
    ]
  );
  const effectiveGpuMode = viewerPolicy.effectiveGpuMode;
  const simulationPrepOverlayActive =
    !thumbnailMode &&
    (simulationPrepPanelOpen ||
      simulationPrepSymmetryVisualization !== null ||
      inertialVisualization.scopedLinkNames !== null);
  const showWorldLayoutOverlays = !simulationPrepOverlayActive;
  const viewerUi = useMemo(
    () => {
      return {
        showHeader: viewerPolicy.showHeader,
        showJointTypesPanel:
          viewerPolicy.showEditableChrome && Object.keys(jointLimits || {}).length > 0,
        showEndEffectorSummary:
          viewerPolicy.showStudioEditableSceneChrome &&
          !isWheelRolesOpen &&
          ikHandlesReady &&
          ikEndEffectorLinks.length > 0,
        showSceneChrome: viewerPolicy.showSceneChrome,
        showStudioSceneChrome: viewerPolicy.showStudioSceneChrome,
        showStudioEditableSceneChrome: viewerPolicy.showStudioEditableSceneChrome,
        showIkHandles:
          viewerPolicy.showStudioEditableSceneChrome &&
          workspaceModeUi.showIkPanel &&
          !simulationPrepPanelOpen &&
          !ikDragSuppressed &&
          ikHandlesReady &&
          ikDragEnabled &&
          Boolean(urdfContent) &&
          ikEndEffectorLinks.length > 0,
        showWheelRoleMarkers: viewerPolicy.showStudioEditableSceneChrome && isWheelRolesOpen,
        showCreatedObjects: viewerPolicy.showStudioSceneChrome && showWorldLayoutOverlays,
        showIkDialog: workspaceModeUi.showIkPanel,
        showTopRightTools: viewerPolicy.showTopRightTools,
        canvasDpr: viewerPolicy.canvasDpr,
        enableCanvasAntialias: viewerPolicy.enableCanvasAntialias,
        canvasPowerPreference: viewerPolicy.canvasPowerPreference,
        enableShadows: viewerPolicy.enableShadows,
        canPublishLiveRobotBasePose: viewerPolicy.canPublishLiveRobotBasePose,
        canRunStudioWheelDrive: viewerPolicy.canRunStudioWheelDrive,
      };
    },
    [
      ikDragEnabled,
      ikDragSuppressed,
      ikEndEffectorLinks.length,
      ikHandlesReady,
      isWheelRolesOpen,
      jointLimits,
      simulationPrepPanelOpen,
      showWorldLayoutOverlays,
      urdfContent,
      viewerPolicy,
      workspaceModeUi.showIkPanel,
    ]
  );
  const pointCloudGpuOverlayVisible =
    viewerUi.showStudioSceneChrome &&
    !thumbnailMode &&
    openArmHfLiveObserveRequested &&
    operatorPointCloudOverlayFrames.length > 0;
  const inertiaLegendItems = [
    {
      key: "shape",
      label: "Shape fill",
      borderColor: formatHexColor(INERTIA_SHAPE_FILL_COLOR_HEALTHY),
      backgroundColor: toRgbaColor(INERTIA_SHAPE_FILL_COLOR_HEALTHY, INERTIA_BOX_OPACITY),
      markerColor: null,
    },
    {
      key: "volume",
      label: "Volume outline",
      borderColor: formatHexColor(INERTIA_VOLUME_EDGE_COLOR_HEALTHY),
      backgroundColor: "transparent",
      markerColor: null,
    },
    {
      key: "center",
      label: "Center offset",
      borderColor: formatHexColor(INERTIA_CENTER_MARKER_COLOR),
      backgroundColor: "transparent",
      markerColor: formatHexColor(INERTIA_CENTER_MARKER_COLOR),
    },
  ];
  const inertiaSeverityLegendItems = [
    {
      key: "low",
      label: "Low",
      color: formatHexColor(INERTIA_SHAPE_FILL_COLOR_HEALTHY),
    },
    {
      key: "moderate",
      label: "Moderate",
      color: formatHexColor(INERTIA_SHAPE_FILL_COLOR_WARNING),
    },
    {
      key: "high",
      label: "High",
      color: formatHexColor(INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC),
    },
  ];
  const inertiaReferenceColorHex = formatHexColor(INERTIA_REFERENCE_BOX_COLOR);
  const showInertiaLegend =
    viewerUi.showStudioSceneChrome &&
    !thumbnailMode &&
    (
      inertialVisualization.showInertia ||
      inertialVisualization.showReferenceGeometry ||
      simulationPrepSymmetryVisualization !== null
    );

  useEffect(() => {
    if (!viewerUi.canPublishLiveRobotBasePose || !robot) {
      clearLiveRobotBasePose();
      return;
    }
    let rafId = 0;
    const publishPose = () => {
      setLiveRobotBasePose(extractRobotBasePose(robot));
      rafId = requestAnimationFrame(publishPose);
    };
    publishPose();
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [clearLiveRobotBasePose, robot, setLiveRobotBasePose, viewerUi.canPublishLiveRobotBasePose]);

  useEffect(() => {
    return () => {
      clearLiveRobotBasePose();
    };
  }, [clearLiveRobotBasePose]);

  useEffect(() => {
    if (!readOnlyMode || !robot || !runtimeRobotBasePose) {
      return;
    }
    applyRobotBasePose(robot, runtimeRobotBasePose);
  }, [readOnlyMode, robot, runtimeRobotBasePose]);

  useOrbitControlsBindings({ controlsRef, robot });
  
  useRobotCameraCentering({
    robot,
    controlsRef,
    followContinuously:
      !thumbnailMode &&
      !isDraggingJoint &&
      !isIkHandleDragging &&
      !selectedCameraIdForCentering,
  });
  useRobotBoundingBoxSync({
    robot,
    onRobotBoundingBoxChange,
    onRobotLoaded,
    isDragging: isDraggingJoint || isIkHandleDragging,
  });
  const { resetPose, setJointTargetsToInitialPose } = useRobotJointSync({
    robot,
    jointValues,
    storeJointValues,
    setStoreJointValues,
    setAvailableJointsStore,
    onRobotJointsLoaded,
    onJointChange,
    isDraggingJoint,
    isIkHandleDragging,
    isIkTrajectoryApplying,
    isPlaying,
    liveTeleopJointSyncActive,
    animationController,
    jointLimits,
    initialPosePolicy: DEMO_MODE ? "limits-center" : "robot",
  });
  useEffect(() => {
    resetApproachArmTargetsRef.current = () => {
      if (isAssemblyWorkspace) return;
      const wheelJointNames = new Set(
        studioWheelDriveRef.current?.model.wheels.map((wheel) => wheel.jointName) ?? []
      );
      const ownedArmJointNames = resolveApproachArmResetJointNames({
        primaryIkEndEffectorLink,
        ikAllowedJointNamesByEe,
        robot,
        wheelJointNames,
      });
      if (ownedArmJointNames.length === 0) return;
      return setJointTargetsToInitialPose(ownedArmJointNames) || {};
    };
  }, [
    ikAllowedJointNamesByEe,
    isAssemblyWorkspace,
    primaryIkEndEffectorLink,
    robot,
    setJointTargetsToInitialPose,
  ]);
  const resetStudioBasePoseAndLocomotionState = useCallback(
    (targetRobot: URDFRobot) => {
      disarmWheelLocomotion();
      targetRobot.userData.__studioBaseDragging = false;
      targetRobot.position.set(0, 0, 0);
      targetRobot.quaternion.identity();
      enforceStudioPlanarPose(targetRobot);
      targetRobot.updateMatrixWorld(true);

      const wheelDrive = studioWheelDriveRef.current;
      if (wheelDrive) {
        wheelDrive.model.wheels.forEach((wheel) => {
          const current = resolveJointScalarValue(targetRobot.joints?.[wheel.jointName]);
          wheelDrive.previousAngles[wheel.jointName] = Number.isFinite(current) ? current : 0;
        });
      }

      if (wheelDriveEnabled) {
        wheelDriveBaseLockRef.current = null;
      } else {
        captureWheelDriveBaseLock(targetRobot);
      }
    },
    [
      captureWheelDriveBaseLock,
      disarmWheelLocomotion,
      enforceStudioPlanarPose,
      wheelDriveEnabled,
    ]
  );
  const handleResetPoseToOrigin = useCallback(() => {
    cancelActiveObjectSolve();
    cancelIkApplyAnimation();
    stopOrbitFollow();
    lastAutoAppliedResultRef.current = ikResult;
    closeIkDialog();
    resetPose();
    if (!robot) return;
    resetStudioBasePoseAndLocomotionState(robot);
  }, [
    cancelActiveObjectSolve,
    cancelIkApplyAnimation,
    ikResult,
    resetPose,
    resetStudioBasePoseAndLocomotionState,
    robot,
    closeIkDialog,
    stopOrbitFollow,
  ]);
  const previousEffectiveDragModeForLeaderFallbackRef =
    useRef<DragMode>(effectiveDragMode);
  useEffect(() => {
    const previousDragMode = previousEffectiveDragModeForLeaderFallbackRef.current;
    previousEffectiveDragModeForLeaderFallbackRef.current = effectiveDragMode;
    if (
      shouldResetPoseAfterLeaderTeleopFallback({
        previousDragMode,
        currentDragMode: effectiveDragMode,
        leaderTeleopAvailable: canUseLeaderTeleopMode,
      })
    ) {
      handleResetPoseToOrigin();
    }
  }, [canUseLeaderTeleopMode, effectiveDragMode, handleResetPoseToOrigin]);
  useEffect(() => {
    if (
      !shouldApplySimulationPrepResetPoseRequest({
        requestKey: simulationPrepResetPoseRequestKey,
        handledRequestKey: handledSimulationPrepResetPoseRequestKeyRef.current,
      })
    ) {
      return;
    }
    if (!robot) {
      return;
    }

    handleResetPoseToOrigin();
    handledSimulationPrepResetPoseRequestKeyRef.current = simulationPrepResetPoseRequestKey;
  }, [handleResetPoseToOrigin, robot, simulationPrepResetPoseRequestKey]);
  function toggleCameraMenu() {
    if (!hasCameras) {
      return;
    }
    setIsCameraMenuOpen((previous) => !previous);
  }
  function closeObjectTools() {
    setIsObjectToolsOpen(false);
  }
  function toggleWheelRoles() {
    setIsWheelRolesOpen((previous) => !previous);
  }
  function toggleObjectTools() {
    if (!selectedWorldObject) {
      return;
    }
    setIsObjectToolsOpen((previous) => !previous);
  }
  function selectDragMode(nextDragMode: DragMode) {
    if (nextDragMode === "hardware-teleop" && !canUseLeaderTeleopMode) {
      return;
    }
    setIsDragModeMenuOpen(false);
    setDragMode(nextDragMode);
  }
  const activeRobotUuidRef = useRef<string | null>(null);
  useEffect(() => {
    const nextRobotUuid = robot?.uuid ?? null;
    if (activeRobotUuidRef.current === nextRobotUuid) {
      return;
    }
    activeRobotUuidRef.current = nextRobotUuid;
    const preservedFrameTimestamp = resolveRemountPreservedFrameTimestamp({
      animationFrames,
      currentFrameIndex: animationController.currentFrameIndexRef.current,
    });
    disarmWheelLocomotion();
    cancelActiveObjectSolve();
    cancelIkApplyAnimation();
    stopOrbitFollow();
    lastAutoAppliedResultRef.current = null;
    closeIkDialog();
    animationController.setPaused(true);
    animationController.setResetAnimationStart(true);
    animationController.setPreserveFrameTime(preservedFrameTimestamp);
  }, [
    animationFrames,
    animationController,
    cancelActiveObjectSolve,
    cancelIkApplyAnimation,
    closeIkDialog,
    disarmWheelLocomotion,
    robot,
    stopOrbitFollow,
  ]);
  const handleToggleWheelDriveJoint = useCallback((jointName: string) => {
    setWheelDriveJointOverrides((previous) => {
      const model = studioWheelDriveRef.current?.model;
      if (!model) return previous;
      const allJointNames = model.wheels.map((wheel) => wheel.jointName);
      if (!allJointNames.includes(jointName)) return previous;
      const defaultDriveJointNames = model.wheels
        .filter((wheel) => wheel.drivePreferred)
        .map((wheel) => wheel.jointName);
      const defaultDriveJointNameSet = new Set(defaultDriveJointNames);
      const activeDriveJointNameSet = resolveStudioActiveDriveJointNames(
        allJointNames,
        defaultDriveJointNames,
        previous
      );
      const currentlyEnabled = activeDriveJointNameSet.has(jointName);
      const nextEnabled = !currentlyEnabled;
      const defaultEnabled = defaultDriveJointNameSet.has(jointName);

      if (nextEnabled === defaultEnabled) {
        if (!Object.prototype.hasOwnProperty.call(previous, jointName)) {
          return previous;
        }
        const next = { ...previous };
        delete next[jointName];
        return next;
      }

      if (previous[jointName] === nextEnabled) {
        return previous;
      }
      return {
        ...previous,
        [jointName]: nextEnabled,
      };
    });
  }, []);

  useEffect(() => {
    if (isAssemblyWorkspace || !robot) {
      wheelDriveBaseLockRef.current = null;
      return;
    }
    if (wheelDriveEnabled) {
      wheelDriveBaseLockRef.current = null;
      return;
    }
    captureWheelDriveBaseLock(robot);
    robot.userData.__studioBaseDragging = false;
  }, [captureWheelDriveBaseLock, isAssemblyWorkspace, robot, wheelDriveEnabled]);

  useEffect(() => {
    if (wheelDriveEnabled) return;
    applyRoverBrakeStop();
  }, [applyRoverBrakeStop, wheelDriveEnabled]);

  useEffect(() => {
    if (isDraggingJoint) return;
    disarmWheelLocomotion();
  }, [disarmWheelLocomotion, isDraggingJoint]);
  useEffect(() => {
    if (!isPlaying) return;
    disarmWheelLocomotion();
  }, [disarmWheelLocomotion, isPlaying]);
  useEffect(() => {
    if (isAssemblyWorkspace || !robot) {
      return;
    }
    const wheelDrive = studioWheelDriveRef.current;
    if (!wheelDrive) {
      return;
    }
    wheelDrive.model.wheels.forEach((wheel) => {
      const currentAngle = resolveJointScalarValue(robot.joints?.[wheel.jointName]);
      if (Number.isFinite(currentAngle)) {
        wheelDrive.previousAngles[wheel.jointName] = currentAngle;
      }
    });
  }, [isAssemblyWorkspace, isPlaying, robot]);

  useEffect(() => {
    if (isAssemblyWorkspace || !robot) {
      studioWheelDriveRef.current = null;
      wheelActivityByJointNameRef.current = {};
      wheelRoleLastUiUpdateMsRef.current = 0;
      disarmWheelLocomotion();
      setWheelDriveJointOverrides({});
      setStudioWheelRoleEntries([]);
      setHasStudioWheelDrive(false);
      return;
    }
    const model = detectStudioWheelDriveModel(robot, getStudioUpAxis(), studioDriveJointHints);
    if (!model) {
      studioWheelDriveRef.current = null;
      wheelActivityByJointNameRef.current = {};
      wheelRoleLastUiUpdateMsRef.current = 0;
      disarmWheelLocomotion();
      setWheelDriveJointOverrides({});
      setStudioWheelRoleEntries([]);
      setHasStudioWheelDrive(false);
      return;
    }
    setWheelDriveJointOverrides((previous) => {
      const validJointNames = new Set(model.wheels.map((wheel) => wheel.jointName));
      const next: Record<string, boolean> = {};
      let changed = false;
      Object.entries(previous).forEach(([jointName, enabled]) => {
        if (validJointNames.has(jointName)) {
          next[jointName] = enabled;
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
    setHasStudioWheelDrive(true);
    const jointSnapshot = useJointStore.getState().jointValues;
    const previousAngles: Record<string, number> = {};
    model.wheels.forEach((wheel) => {
      const fromStore = jointSnapshot[wheel.jointName];
      const fromRobot = resolveJointScalarValue(robot.joints?.[wheel.jointName]);
      previousAngles[wheel.jointName] = Number.isFinite(fromStore)
        ? fromStore
        : Number.isFinite(fromRobot)
          ? fromRobot
          : 0;
    });
    const nextActivityByJointName: Record<string, number> = {};
    model.wheels.forEach((wheel) => {
      nextActivityByJointName[wheel.jointName] = 0;
    });
    wheelActivityByJointNameRef.current = nextActivityByJointName;
    wheelRoleLastUiUpdateMsRef.current = 0;
    const initialDriveWheelNameSet = new Set(
      getPreferredStudioDriveWheels(model, wheelDriveJointOverridesRef.current).map(
        (wheel) => wheel.jointName
      )
    );
    setStudioWheelRoleEntries(
      buildStudioWheelRoleEntries(model, nextActivityByJointName, initialDriveWheelNameSet)
    );
    studioWheelDriveRef.current = { model, previousAngles };
  }, [
    getStudioUpAxis,
    isAssemblyWorkspace,
    robot,
    studioDriveJointHints,
    disarmWheelLocomotion,
  ]);
  useEffect(() => {
    if (isAssemblyWorkspace || !onAutoPatchWheelRolesUrdf) return;
    const wheelDrive = studioWheelDriveRef.current;
    if (!wheelDrive) return;

    const activeDriveJointNames = toSortedUniqueJointNames(
      getPreferredStudioDriveWheels(
        wheelDrive.model,
        wheelDriveJointOverrides
      ).map((wheel) => wheel.jointName)
    );
    const persistedDriveJointNames = toSortedUniqueJointNames(
      Array.from(extractStudioDriveJointHintsFromUrdf(effectiveUrdfForWheelHints))
    );
    if (areSortedStringListsEqual(activeDriveJointNames, persistedDriveJointNames)) {
      return;
    }

    const persistResult = persistStudioDriveJointHintsToUrdf(
      effectiveUrdfForWheelHints,
      activeDriveJointNames
    );
    if (!persistResult.success) {
      return;
    }
    if (persistResult.content === effectiveUrdfForWheelHints) {
      return;
    }
    onAutoPatchWheelRolesUrdf(persistResult.content);
  }, [
    effectiveUrdfForWheelHints,
    isAssemblyWorkspace,
    onAutoPatchWheelRolesUrdf,
    wheelDriveJointOverrides,
  ]);

  useEffect(() => {
    if (!viewerUi.canRunStudioWheelDrive || !robot) return;
    let rafId = 0;
    let lastTickMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    const tick = (time?: number) => {
      const nowMs =
        typeof time === "number" && Number.isFinite(time)
          ? time
          : typeof performance !== "undefined"
            ? performance.now()
            : Date.now();
      const dtSeconds = Math.min(Math.max((nowMs - lastTickMs) / 1000, 1 / 240), 0.1);
      lastTickMs = nowMs;
      const upAxis = getStudioUpAxis();
      const updateWheelRolesUi = (model: StudioWheelDriveModel) => {
        if (nowMs - wheelRoleLastUiUpdateMsRef.current < STUDIO_WHEEL_ROLE_UI_REFRESH_MS) {
          return;
        }
        wheelRoleLastUiUpdateMsRef.current = nowMs;
        const driveWheelNameSet = new Set(
          getPreferredStudioDriveWheels(model, wheelDriveJointOverridesRef.current).map(
            (wheel) => wheel.jointName
          )
        );
        setStudioWheelRoleEntries(
          buildStudioWheelRoleEntries(
            model,
            wheelActivityByJointNameRef.current,
            driveWheelNameSet
          )
        );
      };
      const updateWheelActivity = (
        model: StudioWheelDriveModel,
        includeTravel: boolean
      ): { leftTravel: number[]; rightTravel: number[]; unknownTravel: number[] } => {
        const leftTravel: number[] = [];
        const rightTravel: number[] = [];
        const unknownTravel: number[] = [];
        const touchedWheelNames = new Set<string>();
        const activityByJointName = wheelActivityByJointNameRef.current;
        const driveWheels = getPreferredStudioDriveWheels(
          model,
          wheelDriveJointOverridesRef.current
        );
        const driveWheelNames = new Set(driveWheels.map((wheel) => wheel.jointName));

        model.wheels.forEach((wheel) => {
          const prev = studioWheelDriveRef.current?.previousAngles[wheel.jointName] ?? 0;
          const current = resolveJointScalarValue(robot.joints?.[wheel.jointName]);
          if (!Number.isFinite(current)) return;
          if (studioWheelDriveRef.current) {
            studioWheelDriveRef.current.previousAngles[wheel.jointName] = current;
          }

          const deltaAngle = resolveShortestWheelAngleDeltaRad(prev, current);
          const previousActivity = activityByJointName[wheel.jointName] ?? 0;
          if (
            !Number.isFinite(deltaAngle) ||
            Math.abs(deltaAngle) <= WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon
          ) {
            activityByJointName[wheel.jointName] = previousActivity * STUDIO_WHEEL_ROLE_DECAY;
            touchedWheelNames.add(wheel.jointName);
            return;
          }
          const radius = resolveSafeMotionDimension(wheel.radius);
          const travel = -(deltaAngle * radius) * wheel.directionSign;
          const wheelSpeedMps =
            Math.abs(travel) /
            Math.max(
              dtSeconds,
              WHEEL_PLAYBACK_MOTION_PARAMS.minWheelSpeedSampleDtSeconds
            );
          activityByJointName[wheel.jointName] =
            previousActivity * (1 - STUDIO_WHEEL_ROLE_EMA_ALPHA) +
            wheelSpeedMps * STUDIO_WHEEL_ROLE_EMA_ALPHA;
          touchedWheelNames.add(wheel.jointName);

          if (!includeTravel || !driveWheelNames.has(wheel.jointName)) return;
          if (wheel.side === "left") {
            leftTravel.push(travel);
          } else if (wheel.side === "right") {
            rightTravel.push(travel);
          } else {
            unknownTravel.push(travel);
          }
        });

        model.wheels.forEach((wheel) => {
          if (touchedWheelNames.has(wheel.jointName)) return;
          const previousActivity = activityByJointName[wheel.jointName] ?? 0;
          activityByJointName[wheel.jointName] = previousActivity * STUDIO_WHEEL_ROLE_DECAY;
        });

        return {
          leftTravel,
          rightTravel,
          unknownTravel,
        };
      };
      if (!wheelDriveEnabled) {
        const wheelDrive = studioWheelDriveRef.current;
        if (wheelDrive) {
          const activityByJointName = wheelActivityByJointNameRef.current;
          wheelDrive.model.wheels.forEach((wheel) => {
            const current = resolveJointScalarValue(wheel.joint);
            if (Number.isFinite(current)) {
              wheelDrive.previousAngles[wheel.jointName] = current;
            }
            const previousActivity = activityByJointName[wheel.jointName] ?? 0;
            activityByJointName[wheel.jointName] = previousActivity * STUDIO_WHEEL_ROLE_DECAY;
          });
          updateWheelRolesUi(wheelDrive.model);
        }
        enforceWheelDriveBaseLock(robot);
        rafId = requestAnimationFrame(tick);
        return;
      }
      const wheelDrive = studioWheelDriveRef.current;
      if (!wheelDrive || wheelDrive.model.wheels.length === 0) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (robot.userData.__studioBaseDragging === true) {
        updateWheelActivity(wheelDrive.model, false);
        updateWheelRolesUi(wheelDrive.model);
        enforceStudioPlanarPose(robot);
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (autoRoverApproachActiveRef.current) {
        updateWheelActivity(wheelDrive.model, false);
        updateWheelRolesUi(wheelDrive.model);
        rafId = requestAnimationFrame(tick);
        return;
      }
      const allowWheelLocomotion = isWheelLocomotionAllowed({
        isWheelLocomotionArmed: wheelLocomotionArmedRef.current,
        isManualDragActive: isDraggingJoint,
        isPlaybackActive: isPlaying,
        isAutoApproachActive: autoRoverApproachActiveRef.current,
      });

      const { leftTravel, rightTravel, unknownTravel } = updateWheelActivity(
        wheelDrive.model,
        allowWheelLocomotion || isPlaying
      );
      updateWheelRolesUi(wheelDrive.model);
      if (isPlaying) {
        const resolveCurrentForwardWorld = () => {
          const localUp = localDirectionFromWorld(upAxis, robot.quaternion);
          const localForward = projectDirectionOntoPlane(
            wheelDrive.model.forwardLocal.clone(),
            localUp,
            ROBOT_FRONT_LOCAL_FORWARD.clone()
          );
          return projectDirectionOntoPlane(
            worldDirectionFromLocal(localForward, robot.quaternion),
            upAxis,
            getPerpendicularDirection(upAxis)
          );
        };
        const hasObservedWheelTravelInFrame = hasObservedWheelTravel({
          leftTravel,
          rightTravel,
          unknownTravel,
        });
        const previousPlaybackState = playbackWheelSynthesisStateRef.current;
        const playbackFrame =
          animationFrames?.[currentAnimationFrameIndexRef.current] ??
          null;
        const frameHasBasePose = Boolean(playbackFrame?.basePose);
        let currentForwardWorld = resolveCurrentForwardWorld();

        if (
          hasObservedWheelTravelInFrame &&
          !frameHasBasePose &&
          WHEEL_PLAYBACK_MOTION_PARAMS.allowBaseMotionSynthesisWithoutBasePose
        ) {
          const rawBodyMotion = resolveWheelPlaybackBodyMotion({
            leftTravel,
            rightTravel,
            unknownTravel,
            trackWidth: wheelDrive.model.trackWidth,
          });
          if (rawBodyMotion.hasMotion) {
            const clampedBodyMotion = clampWheelPlaybackBodyMotionStep({
              linearTravel: rawBodyMotion.linearTravel,
              angularTravel: rawBodyMotion.angularTravel,
              dtSeconds,
            });
            const linearTravel = clampedBodyMotion.linearTravel;
            const angularTravel = clampedBodyMotion.angularTravel;
            const halfTurnQuat = new THREE.Quaternion().setFromAxisAngle(
              upAxis,
              angularTravel * 0.5
            );
            const driveForward = currentForwardWorld
              .clone()
              .applyQuaternion(halfTurnQuat)
              .normalize();
            robot.position.addScaledVector(driveForward, linearTravel);
            const turnQuat = new THREE.Quaternion().setFromAxisAngle(
              upAxis,
              angularTravel
            );
            robot.quaternion.premultiply(turnQuat);
            enforceStudioPlanarPose(robot);
            robot.updateMatrixWorld(true);
            currentForwardWorld = resolveCurrentForwardWorld();
          }
        } else if (
          !hasObservedWheelTravelInFrame &&
          frameHasBasePose &&
          previousPlaybackState
        ) {
          const planarTranslationDelta = projectVectorOntoPlaneFromContract(
            robot.position.clone().sub(previousPlaybackState.position),
            upAxis
          );
          const travelDirectionWorld = projectDirectionOntoPlane(
            previousPlaybackState.forwardWorld.clone().add(currentForwardWorld),
            upAxis,
            currentForwardWorld
          );
          const rawLinearTravel = planarTranslationDelta.dot(travelDirectionWorld);
          const rawAngularTravel = computeSignedPlanarYawErrorRad(
            previousPlaybackState.forwardWorld,
            currentForwardWorld,
            upAxis
          );
          const clampedBodyMotion = clampWheelPlaybackBodyMotionStep({
            linearTravel: rawLinearTravel,
            angularTravel: rawAngularTravel,
            dtSeconds,
          });
          const linearTravel = clampedBodyMotion.linearTravel;
          const angularTravel = clampedBodyMotion.angularTravel;

          if (clampedBodyMotion.hasMotion) {
            wheelDrive.model.wheels.forEach((wheel) => {
              const wheelTravel = getStudioWheelTravelForBodyMotion(
                wheel,
                linearTravel,
                angularTravel,
                resolveSafeMotionDimension(wheelDrive.model.trackWidth)
              );
              const radius = resolveSafeMotionDimension(wheel.radius);
              const currentAngle = resolveJointScalarValue(wheel.joint) ?? 0;
              const deltaAngle = -(wheelTravel / radius) * wheel.directionSign;
              const nextAngle = currentAngle + deltaAngle;
              wheel.joint.setJointValue(nextAngle);
              wheelDrive.previousAngles[wheel.jointName] = nextAngle;
              setStoreJointValue(wheel.jointName, nextAngle, {
                enforceVelocity: false,
                timestamp: nowMs,
              });
            });
            robot.updateMatrixWorld(true);
            currentForwardWorld = resolveCurrentForwardWorld();
          }
        }
        playbackWheelSynthesisStateRef.current = {
          position: robot.position.clone(),
          forwardWorld: currentForwardWorld.clone(),
        };
        rafId = requestAnimationFrame(tick);
        return;
      }
      playbackWheelSynthesisStateRef.current = null;
      if (!allowWheelLocomotion) {
        enforceStudioPlanarPose(robot);
        rafId = requestAnimationFrame(tick);
        return;
      }

      const rawBodyMotion = resolveWheelPlaybackBodyMotion({
        leftTravel,
        rightTravel,
        unknownTravel,
        trackWidth: wheelDrive.model.trackWidth,
      });
      if (rawBodyMotion.hasMotion) {
        const driveWheelJointNames = new Set(
          getPreferredStudioDriveWheels(
            wheelDrive.model,
            wheelDriveJointOverridesRef.current
          ).map((wheel) => wheel.jointName)
        );
        const driveAuthority = computeStudioWheelDriveAuthority(
          wheelDrive.model.wheels.map((wheel) => ({
            jointName: wheel.jointName,
            side: wheel.side,
          })),
          driveWheelJointNames
        );
        const clampedBodyMotion = clampWheelPlaybackBodyMotionStep({
          linearTravel: rawBodyMotion.linearTravel,
          angularTravel: rawBodyMotion.angularTravel,
          dtSeconds,
        });
        const linearTravel =
          clampedBodyMotion.linearTravel * driveAuthority.linearScale;
        const angularTravel =
          clampedBodyMotion.angularTravel * driveAuthority.angularScale;

        if (
          Math.abs(linearTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon ||
          Math.abs(angularTravel) > WHEEL_PLAYBACK_MOTION_PARAMS.motionEpsilon
        ) {
          const localUp = localDirectionFromWorld(upAxis, robot.quaternion);
          const localForward = projectDirectionOntoPlane(
            wheelDrive.model.forwardLocal.clone(),
            localUp,
            new THREE.Vector3(1, 0, 0)
          );
          const forwardWorld = projectDirectionOntoPlane(
            worldDirectionFromLocal(localForward, robot.quaternion),
            upAxis,
            projectDirectionOntoPlane(
              worldDirectionFromLocal(new THREE.Vector3(1, 0, 0), robot.quaternion),
              upAxis,
              getPerpendicularDirection(upAxis)
            )
          );
          const halfTurnQuat = new THREE.Quaternion().setFromAxisAngle(
            upAxis,
            angularTravel * 0.5
          );
          const driveForward = forwardWorld.clone().applyQuaternion(halfTurnQuat).normalize();
          robot.position.addScaledVector(driveForward, linearTravel);
          const turnQuat = new THREE.Quaternion().setFromAxisAngle(upAxis, angularTravel);
          robot.quaternion.premultiply(turnQuat);
          wheelDrive.model.wheels.forEach((wheel) => {
            if (driveWheelJointNames.has(wheel.jointName)) return;
            const wheelTravel = getStudioWheelTravelForBodyMotion(
              wheel,
              linearTravel,
              angularTravel,
              resolveSafeMotionDimension(wheelDrive.model.trackWidth)
            );
            const radius = resolveSafeMotionDimension(wheel.radius);
            const currentAngle = resolveJointScalarValue(wheel.joint) ?? 0;
            const deltaAngle = -(wheelTravel / radius) * wheel.directionSign;
            const nextAngle = currentAngle + deltaAngle;
            wheel.joint.setJointValue(nextAngle);
            setStoreJointValue(wheel.jointName, nextAngle, {
              enforceVelocity: false,
              timestamp: nowMs,
            });
          });
          enforceStudioPlanarPose(robot);
          robot.updateMatrixWorld(true);
        }
      }
      enforceStudioPlanarPose(robot);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    animationFrames,
    currentAnimationFrameIndexRef,
    enforceWheelDriveBaseLock,
    enforceStudioPlanarPose,
    getStudioUpAxis,
    isAssemblyWorkspace,
    isDraggingJoint,
    isPlaying,
    robot,
    setStoreJointValue,
    wheelDriveEnabled,
    viewerUi.canRunStudioWheelDrive,
  ]);

  const { handleMotionDataUpload } = useMotionDataUpload({
    robot,
    setAnimationFrames,
    setIsPlaying,
    setMotionDataFile,
    setStoreJointValues,
    onMotionFileChange,
  });
  const {
    handleRun,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  } = usePlaybackHandlers({
    animationFrames,
    robot,
    isPlaying,
    setIsPlaying,
    setAnimationFrames,
    setCurrentFrame,
    onPlayingChange,
    onFrameChange,
    animationController,
  });
  const {
    cameras,
    selectedCameraId,
    selectCamera,
    isCameraMenuOpen,
    setIsCameraMenuOpen,
    setView,
    handleGlobalCameraViewChange,
    handleCameraViewChange,
  } = useViewerCameraControls({
    robot,
    controlsRef,
    cameraRef,
    jointValues: storeJointValues,
    camerasOverride: visibleCameraConfigs,
    floorCalibrationsByCameraId: operatorPointCloudFloorCalibrationsByCameraId,
    suspendSelectedCameraSync: isIkHandleDragging,
  });
  const closeCameraMenu = useCallback(() => {
    setIsCameraMenuOpen(false);
  }, [setIsCameraMenuOpen]);
  const selectGlobalCameraView = useCallback(() => {
    closeCameraMenu();
    selectCamera(null);
    handleGlobalCameraViewChange();
  }, [closeCameraMenu, handleGlobalCameraViewChange, selectCamera]);
  const selectNamedCameraView = useCallback((cameraId: string) => {
    closeCameraMenu();
    selectCamera(cameraId);
    handleCameraViewChange(cameraId);
  }, [closeCameraMenu, handleCameraViewChange, selectCamera]);
  useEffect(() => {
    if (thumbnailMode) {
      lastSimulationPrepSymmetryCameraScopeKeyRef.current = null;
      return;
    }
    if (!simulationPrepSymmetryVisualization) {
      lastSimulationPrepSymmetryCameraScopeKeyRef.current = null;
      return;
    }
    if (!robot) {
      return;
    }

    const symmetryScopeKey = buildRepeatedInertiaSymmetryVisualizationScopeKey({
      symmetryRootLinkName: simulationPrepSymmetryVisualization.symmetryRootLinkName,
      outlierBranchRootLinkName:
        simulationPrepSymmetryVisualization.outlierBranchRootLinkName,
    });
    if (lastSimulationPrepSymmetryCameraScopeKeyRef.current === symmetryScopeKey) {
      return;
    }

    const applySymmetryCameraFrame = () => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !camera) {
        return;
      }

      const resolveLinkObject = createLinkObjectResolver(robot);
      const focusCenter = new THREE.Vector3().fromArray(
        simulationPrepSymmetryOverlayCenterMode === "root-mesh-center"
          ? simulationPrepSymmetryVisualization.rootMeshCenterPositionMeters
          : simulationPrepSymmetryVisualization.symmetryCenterPositionMeters
      );
      const focusRadius = resolveSimulationPrepSymmetryFocusRadius({
        chain: simulationPrepSymmetryVisualization,
        resolveLinkObject,
      });
      const worldUp = getStudioUpAxis();
      const frontWorld = resolveRobotFrontWorldDirection();
      const cameraDirection = buildSimulationPrepSymmetryCameraDirection({
        forwardWorld: frontWorld,
        upWorld: worldUp,
      });
      const cameraDistance = resolveSimulationPrepSymmetryCameraDistance({
        aspect: camera.aspect,
        fovDegrees: camera.fov,
        focusRadiusMeters: focusRadius,
      });

      camera.up.copy(frontWorld);
      camera.position.copy(focusCenter).addScaledVector(cameraDirection, cameraDistance);
      controls.target.copy(focusCenter);
      controls.update();
      lastSimulationPrepSymmetryCameraScopeKeyRef.current = symmetryScopeKey;
    };

    selectCamera(null);
    if (selectedCameraId !== null) {
      requestAnimationFrame(applySymmetryCameraFrame);
      return;
    }
    applySymmetryCameraFrame();
  }, [
    getStudioUpAxis,
    resolveRobotFrontWorldDirection,
    robot,
    selectedCameraId,
    selectCamera,
    simulationPrepSymmetryVisualization,
    simulationPrepSymmetryOverlayCenterMode,
    thumbnailMode,
  ]);
  useEffect(() => {
    if (thumbnailMode) {
      lastSimulationPrepRobotMirrorCameraScopeKeyRef.current = null;
      return;
    }
    if (!simulationPrepRobotMirrorVisualization) {
      lastSimulationPrepRobotMirrorCameraScopeKeyRef.current = null;
      return;
    }
    if (!robot) {
      return;
    }

    const resolveLinkObject = createLinkObjectResolver(robot);
    const focusLinkNames = collectSimulationPrepRobotMirrorFocusLinkNames(
      simulationPrepRobotMirrorVisualization
    );
    const focusRadius = resolveSimulationPrepRobotMirrorFocusRadius({
      check: simulationPrepRobotMirrorVisualization,
      resolveLinkObject,
    });
    const frontWorld = resolveRobotFrontWorldDirection();
    const mirrorCameraFrameKey = buildSimulationPrepMirrorCameraFrameKey({
      planeLabel: buildRobotMirrorSymmetryVisualizationScopeKey(
        simulationPrepRobotMirrorVisualization
      ),
      originMeters: simulationPrepRobotMirrorVisualization.originMeters,
      planeNormalWorld: simulationPrepRobotMirrorVisualization.planeNormalWorld,
      focusLinkNames,
      focusRadiusMeters: focusRadius,
      frontWorld,
    });
    if (lastSimulationPrepRobotMirrorCameraScopeKeyRef.current === mirrorCameraFrameKey) {
      return;
    }

    const applyRobotMirrorCameraFrame = () => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !camera) {
        return;
      }

      const focusCenter = new THREE.Vector3().fromArray(
        simulationPrepRobotMirrorVisualization.originMeters
      );
      const mirrorCameraFrame = buildSimulationPrepMirrorCameraFrame({
        planeNormalWorld: new THREE.Vector3().fromArray(
          simulationPrepRobotMirrorVisualization.planeNormalWorld
        ),
        frontWorld,
        upWorld: getStudioUpAxis(),
      });
      const cameraDistance = resolveSimulationPrepSymmetryCameraDistance({
        aspect: camera.aspect,
        fovDegrees: camera.fov,
        focusRadiusMeters: focusRadius,
      });

      camera.up.copy(mirrorCameraFrame.upWorld);
      camera.position
        .copy(focusCenter)
        .addScaledVector(mirrorCameraFrame.directionWorld, cameraDistance);
      controls.target.copy(focusCenter);
      controls.update();
      lastSimulationPrepRobotMirrorCameraScopeKeyRef.current = mirrorCameraFrameKey;
    };

    selectCamera(null);
    if (selectedCameraId !== null) {
      requestAnimationFrame(applyRobotMirrorCameraFrame);
      return;
    }
    applyRobotMirrorCameraFrame();
  }, [
    getStudioUpAxis,
    resolveRobotFrontWorldDirection,
    robot,
    selectedCameraId,
    selectCamera,
    simulationPrepRobotMirrorVisualization,
    thumbnailMode,
  ]);
  const deleteSelectedWorldObject = useCallback(() => {
    if (!selectedWorldObject) {
      return;
    }
    removeObject(selectedWorldObject.id);
    closeObjectTools();
  }, [removeObject, selectedWorldObject]);
  const duplicateSelectedWorldObject = useCallback(() => {
    if (!selectedWorldObject) {
      return;
    }
    duplicateObject(selectedWorldObject.id);
  }, [duplicateObject, selectedWorldObject]);
  const toggleWheelDriveMode = useCallback(() => {
    if (wheelDriveEnabled) {
      applyRoverBrakeStop();
    }
    setWheelDriveEnabled(!wheelDriveEnabled);
  }, [applyRoverBrakeStop, wheelDriveEnabled]);
  const selectWorldObjectEditMode = useCallback((mode: "move" | "rotate" | "resize") => {
    setObjectEditMode(mode);
  }, [setObjectEditMode]);
  const hasCameras = cameras.length > 0;
  const focusWorldObject = useCallback(
    (object: CreatedObject) => {
      const applyFocus = () => {
        const controls = controlsRef.current;
        const camera = cameraRef.current;
        if (!controls || !camera) {
          return;
        }
        const center = object.position.clone();
        const radius = Math.max(
          object.size.length() * 0.5,
          WORLD_OBJECT_EDIT_PARAMS.frameFocusMinRadiusM
        );
        const verticalFovRad = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFovRad =
          2 * Math.atan(Math.tan(verticalFovRad * 0.5) * camera.aspect);
        const minHalfFovRad = Math.max(
          WORLD_OBJECT_EDIT_PARAMS.frameFocusMinHalfFovRad,
          Math.min(verticalFovRad, horizontalFovRad) * 0.5
        );
        const distance =
          Math.max(
            radius / Math.sin(minHalfFovRad),
            radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusDistanceScale,
            WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceM
          ) * WORLD_OBJECT_EDIT_PARAMS.frameFocusPaddingScale;
        const direction = new THREE.Vector3()
          .subVectors(camera.position, controls.target)
          .normalize();
        if (
          direction.lengthSq() <
          WORLD_OBJECT_EDIT_PARAMS.frameFocusDirectionEpsilon
        ) {
          direction.copy(DEFAULT_OBJECT_FRAME_DIRECTION);
        }
        camera.position.copy(center).addScaledVector(direction, distance);
        controls.target.copy(center);
        controls.minDistance = Math.max(
          radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceScale,
          WORLD_OBJECT_EDIT_PARAMS.frameFocusMinDistanceFallbackM
        );
        controls.maxDistance = Math.max(
          radius * WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxDistanceScale,
          controls.minDistance * WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxToMinDistanceRatio,
          WORLD_OBJECT_EDIT_PARAMS.frameFocusMaxDistanceFallbackM
        );
        controls.update();
      };

      selectCamera(null);
      if (selectedCameraId !== null) {
        requestAnimationFrame(applyFocus);
        return;
      }
      applyFocus();
    },
    [selectCamera, selectedCameraId]
  );

  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }
    const selectedObject = worldObjects.find((object) => object.id === selectedObjectId);
    if (!selectedObject) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedObject(null);
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        focusWorldObject(selectedObject);
        return;
      }
      if (readOnlyMode) {
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        event.stopPropagation();
        duplicateObject(selectedObject.id);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        removeObject(selectedObject.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    duplicateObject,
    focusWorldObject,
    readOnlyMode,
    removeObject,
    selectedObjectId,
    setSelectedObject,
    worldObjects,
  ]);

  useEffect(() => {
    if (hasCameras) return;
    closeCameraMenu();
  }, [closeCameraMenu, hasCameras]);
  useEffect(() => {
    if (selectedWorldObject) {
      return;
    }
    closeObjectTools();
  }, [selectedWorldObject]);
  const handleResetPoseWithGlobalView = useCallback(() => {
    handleResetPoseToOrigin();
    selectGlobalCameraView();
    if (readOnlyMode && typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage(
        {
          type: RESET_RUNTIME_TRACE_MESSAGE_TYPE,
          requestId: String(Date.now()),
          reason: "reset-pose",
        },
        window.location.origin
      );
    }
  }, [
    handleResetPoseToOrigin,
    readOnlyMode,
    selectGlobalCameraView,
  ]);
  const handleReadOnlyInteractionAttempt = useCallback(() => {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!shouldShowPreviewReadOnlyNotice(readOnlyNoticeShownAtRef.current, nowMs)) {
      return;
    }
    readOnlyNoticeShownAtRef.current = nowMs;
    toast.info(PREVIEW_READ_ONLY_NOTICE_PARAMS.message);
  }, []);

  const handlePlaybackEnd = useCallback(
    (frameIndex: number) => {
      recordPlaybackTrace("viewer:playbackEnd", { frameIndex });
      if (!isPlaying) {
        return;
      }
      setIsPlaying(false);
      onPlayingChange?.(false);
      animationController.setPaused(true);
    },
    [animationController, isPlaying, onPlayingChange]
  );

  const handleObjectEditDragStateChange = useCallback(
    (dragging: boolean) => {
      setIsObjectEditDragging(dragging);
      if (controlsRef.current) {
        controlsRef.current.enabled =
          !dragging && !isDraggingJoint && !isIkHandleDragging;
      }
    },
    [isDraggingJoint, isIkHandleDragging]
  );

  useViewerWindowBindings({
    handleRun,
    handleMotionDataUpload,
    handlePlayEpisode,
    handleStopAnimation,
    handleClearAnimation,
    handleSetFrame,
  });

  useDragModeEffects({
    dragMode: effectiveDragMode,
    isDragModeMenuOpen,
    setIsDragModeMenuOpen,
  });

  usePlaybackNotifications({
    animationFrames,
    isPlaying,
    currentFrame,
    setCurrentFrame,
    onAnimationFramesChange,
    onMotionDataNodesGenerated,
    onPlayingChange,
    onFrameChange,
    onJointChange,
  });

  return (
    <div className="h-full flex flex-col">
      {viewerUi.showHeader && (
        <div className="flex items-center justify-between mb-1.5 px-2">
          <span className="text-xs text-muted-foreground">
            {urdfFile 
              ? `${urdfFile.name.replace(/^viz-/, "")} loaded`
                : "No robot"}
          </span>
        </div>
      )}

      {/* 3D Viewer Area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Joint Types Panel - Blender Style */}
        {viewerUi.showJointTypesPanel && (() => {
          // Helper to convert hex to rgba
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };

          // Count joints by type
          const totalJoints = Object.keys(jointLimits || {}).length;
          const typeCounts: Record<string, number> = {};

          Object.values(jointLimits || {}).forEach(j => {
            const type = j?.type || "continuous";
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          });

          // Get all joint types that exist in the robot, ordered by importance (most common first)
          const typeOrder: string[] = ["revolute", "continuous", "prismatic", "fixed", "planar", "floating", "mimic"];
          const existingTypes = Object.keys(typeCounts).sort((a, b) => {
            const aIndex = typeOrder.indexOf(a);
            const bIndex = typeOrder.indexOf(b);
            if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });

          return (
          <div className="absolute top-4 left-4 z-10 w-44 rounded border border-border/40 bg-background/98 shadow-md backdrop-blur-sm">
            <div className="border-b border-border/20 px-2 py-1">
              <div className="text-[8px] font-semibold uppercase tracking-tight text-muted-foreground/80">
                Joint Types {totalJoints}
              </div>
            </div>

            <div className="space-y-1 p-1.5">
              <div className="space-y-0.5">
                {existingTypes.map((type) => {
                  const count = typeCounts[type];
                  const color = (jointColors as Record<string, string>)[type] || jointColors.light_gray;
                  const isFixed = type === "fixed";
                  const typeJoints = jointNamesByType[type] ?? [];
                  const isSelected = selectedJoint && typeJoints.includes(selectedJoint);

                  return (
                    <div
                      key={type}
                      className={cn(
                        "flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer transition-colors",
                        isSelected
                          ? "bg-primary/15 border border-primary/30"
                          : "hover:bg-muted/15 border border-transparent"
                      )}
                      onClick={() => selectFirstJointOfType(type)}
                    >
                      <div
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-[2px] border"
                        style={{
                          borderColor: color,
                          backgroundColor: isFixed ? color : hexToRgba(color, 0.25)
                        }}
                      />
                      <span className="flex-1 truncate text-[10px] font-medium capitalize text-foreground">
                        {getJointTypeLabel(type)}
                      </span>
                      <span className="flex-shrink-0 text-[8px] text-muted-foreground/75">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border/15 pt-1 text-[8.5px] leading-tight">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground/80">L</span>
                  <span className="truncate text-foreground">{selectedLink || "None"}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-muted-foreground/80">J</span>
                  <span className="truncate text-foreground">{selectedJoint || "None"}</span>
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {viewerUi.showEndEffectorSummary && (
          <div className="absolute bottom-4 left-4 z-20 max-w-[25rem] rounded border border-border/40 bg-background/92 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            <div className="truncate font-mono text-[8.5px] leading-tight text-foreground">
              {eeHeaderText} ({ikEndEffectorLinks.length}) {eeHandlesText}
            </div>
            <div className="truncate font-mono text-[8.5px] leading-tight text-foreground/90">
              Primary {primaryIkEndEffectorLink ?? "--"} {eePositionText}
            </div>
            <div className="truncate font-mono text-[8.5px] leading-tight text-foreground/90">
              Mass {totalMassText} · COM {comPositionText}
            </div>
          </div>
        )}
        {showInertiaLegend && (
          <TooltipProvider delayDuration={100}>
            <div className="absolute bottom-4 right-4 z-20 max-w-[28rem] rounded border border-border/40 bg-background/92 px-2.5 py-2 shadow-sm backdrop-blur-sm">
              <div className="flex justify-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/75 hover:text-foreground"
                      aria-label="How viewer overlays work"
                    >
                      <CircleHelp className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    className="max-w-80 space-y-1.5 text-[11px] leading-snug text-muted-foreground"
                  >
                    {INERTIA_OVERLAY_TOOLTIP_LINES.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {simulationPrepSymmetryVisualization !== null
                      ? SYMMETRY_OVERLAY_TOOLTIP_LINES.map((line) => (
                          <div key={line}>{line}</div>
                        ))
                      : null}
                  </TooltipContent>
                </Tooltip>
              </div>
              {inertialVisualization.showInertia && (
                <div className="mt-2">
                  <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
                    Inertia
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
                    {inertiaLegendItems.map((item) => (
                      <span key={item.key} className="inline-flex items-center gap-1">
                        {item.markerColor ? (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: item.markerColor }}
                          />
                        ) : (
                          <span
                            className="h-2 w-2 rounded-sm border"
                            style={{
                              borderColor: item.borderColor,
                              backgroundColor: item.backgroundColor,
                            }}
                          />
                        )}
                        <span>{item.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(inertialVisualization.showInertia || inertialVisualization.showReferenceGeometry) && (
                <div className="mt-2">
                  <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
                    Reference And Severity
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
                    {inertialVisualization.showReferenceGeometry && (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-sm border bg-transparent"
                          style={{ borderColor: inertiaReferenceColorHex }}
                        />
                        <span>Reference geometry</span>
                      </span>
                    )}
                    {inertialVisualization.showInertia &&
                      inertiaSeverityLegendItems.map((item) => (
                        <span key={item.key} className="inline-flex items-center gap-1">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>{item.label} mismatch</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
              {simulationPrepSymmetryVisualization !== null && (
                <div className="mt-2">
                  <div className="text-[8px] font-medium uppercase tracking-tight text-muted-foreground/75">
                    Symmetry
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] leading-none text-foreground/90">
                    {SYMMETRY_OVERLAY_LEGEND_ITEMS.map((item) => (
                      <span key={item.key} className="inline-flex items-center gap-1">
                        <span
                          className="block h-px w-4"
                          style={{ backgroundColor: item.color }}
                        />
                        <span>{item.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TooltipProvider>
        )}

        <ViewerCanvasErrorBoundary>
        <Canvas
          id={thumbnailMode ? "urdf-thumb-canvas" : undefined}
          camera={{ position: [1.5, 1.5, 0.8], fov: 50 }}
          style={{ background: thumbnailMode ? "transparent" : "hsl(var(--background))" }}
          dpr={viewerUi.canvasDpr}
          gl={{ 
            antialias: viewerUi.enableCanvasAntialias,
            powerPreference: viewerUi.canvasPowerPreference,
            stencil: false,
            depth: true,
            alpha: thumbnailMode
          }}
          onCreated={({ scene, camera, gl }) => {
            // ROS REP-103 / URDF Standard: Z-up coordinate system
            // X=forward (red), Y=left (green), Z=up (blue)
            scene.up.set(0, 0, 1);
            camera.up.set(0, 0, 1);
            cameraRef.current = camera as THREE.PerspectiveCamera;
            rendererDomRef.current = gl.domElement as HTMLCanvasElement;
            sceneRef.current = scene;
            // Expose camera to window for object dragging
            // Configure shadows based on GPU mode
            gl.shadowMap.enabled = viewerUi.enableShadows;
            if (viewerUi.enableShadows) {
              gl.shadowMap.type = THREE.PCFSoftShadowMap;
            }
            if (thumbnailMode) {
              gl.setClearColor(0x000000, 0);
            }
            // Disable face culling at the WebGL renderer level
            const renderer = gl as THREE.WebGLRenderer;
            const context = renderer.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
            context.disable(context.CULL_FACE);
          }}
        >
          {effectiveGpuMode === "low" ? (
            <ambientLight intensity={0.8} />
          ) : (
            <>
              <ambientLight intensity={0.7} />
              <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
              <directionalLight position={[-5, 3, -5]} intensity={0.4} />
              <pointLight position={[0, 5, 0]} intensity={0.5} />
            </>
          )}

          {viewerUi.showSceneChrome && !worldLabsPrimarySceneActive && (
            <>
              {/* Infinite grid - Blender-style grey infinite grid */}
              <ViewerWorldGrid gpuMode={effectiveGpuMode} />
              
              {/* Floor plane */}
              <ViewerFloorPlane gpuMode={effectiveGpuMode} />
              {viewerUi.showStudioSceneChrome && showWorldLayoutOverlays && (
                <>
                  <RoverApproachRoutePreview
                    routePreviewStateRef={roverApproachRoutePreviewRef}
                    resolveUpAxis={getStudioUpAxis}
                  />
                  <RoverApproachGuideLine
                    guideLineStateRef={roverApproachGuideLineRef}
                    resolveUpAxis={getStudioUpAxis}
                  />
                </>
              )}
              {isAssemblyWorkspace && showWorldLayoutOverlays && (
                <AssemblyPlacementHelpers
                  poses={assemblyPoses}
                  radii={assemblyRadii}
                  selectedRobotId={assemblySelectedRobotId}
                  contactPairs={assemblyContactPairs}
                />
              )}
            </>
          )}

          <WorldLabsEnvironmentLayer />
          <WorldLabsColliderLayer visible={false} />
          <WorldLabsSplatLayer />

          {urdfFile && (
            <>
              <URDFModel
                file={urdfFile}
                workspaceMode={workspaceMode}
                assemblyPrimaryModel={assemblyPrimaryModel}
                secondaryModels={assemblySecondaryModels}
                urdfBasePath={urdfBasePath}
                packageRoots={packageRoots}
                urdfAnalysis={urdfAnalysis}
                meshFiles={meshFiles}
                animationFrames={animationFrames}
                isPlaying={isPlaying}
                onRobotLoaded={setRobot}
                onRobotReadyChange={setIkHandlesReady}
                selectedJoint={selectedJoint}
                selectedLink={selectedLink}
                jointLimits={jointLimits}
                jointAxes={jointAxes}
                gpuMode={effectiveGpuMode}
                playbackSpeed={playbackSpeed}
                rotationPlaneVisible={rotationPlaneVisible}
                dragMode={effectiveDragMode}
                wheelDriveEnabled={wheelDriveEnabled}
                wheelDriveJointOverrides={wheelDriveJointOverrides}
                studioDriveJointHints={studioDriveJointHints}
                animationController={animationController}
                thumbnailMode={thumbnailMode}
                resolveThumbnailFrontWorldDirection={resolveRobotFrontWorldDirection}
                resolveThumbnailUpWorld={getStudioUpAxis}
                controlsRef={controlsRef}
                cameraRef={cameraRef}
                rendererDomRef={rendererDomRef}
                activeWorldScenePackageId={activeWorldScenePackageId}
                readOnlyMode={readOnlyMode}
                onReadOnlyInteractionAttempt={handleReadOnlyInteractionAttempt}
                onSelectPart={({ jointName, linkName }) => {
                  const nextSelection = resolveViewerPartSelection({
                    jointName,
                    linkName,
                    simulationPrepPanelOpen,
                  });
                  // Update selection and highlight
                  onLinkSelect?.(nextSelection.linkName);
                  onJointSelect?.(nextSelection.jointName);
                  onLinkHover?.(nextSelection.linkName);
                  onJointHover?.(nextSelection.jointName);
                }}
                onJointChange={(j, v) => {
                  if (onJointChange) {
                    onJointChange(j, v);
                  } else {
                    const timestamp =
                      typeof performance !== "undefined" ? performance.now() : Date.now();
                    setStoreJointValue(j, v, {
                      enforceVelocity: false,
                      timestamp,
                    });
                  }
                }}
                onDragActiveChange={setIsDraggingJoint}
                onWheelLocomotionIntent={armWheelLocomotion}
                onStudioBaseDragStart={handleStudioBaseDragStart}
                onStudioBaseDragEnd={handleStudioBaseDragEnd}
                onFrameChange={setCurrentFrame}
                onPlaybackEnd={handlePlaybackEnd}
              />
              {collisionsVisible ? (
                <CollisionGeometries
                  urdfAnalysis={urdfAnalysis}
                  meshFiles={meshFiles}
                  urdfBasePath={urdfBasePath}
                  packageRoots={packageRoots}
                  collisionVisibility={collisionVisibility}
                  collisionSimplifyLinks={collisionSimplifyLinks}
                  collisionMergedLinks={collisionMergedLinks}
                  robot={robot}
                  gpuMode={effectiveGpuMode}
                />
              ) : null}
              {viewerUi.showStudioSceneChrome && (
                <>
                  <InertialVisualization
                    robot={robot}
                    linkDataByName={urdfAnalysis?.linkDataByName ?? null}
                    meshFiles={meshFiles}
                    urdfBasePath={urdfBasePath}
                    packageRoots={packageRoots}
                    jointValues={storeJointValues}
                    showGlobal={inertialVisualization.showGlobalCOM && !thumbnailMode}
                    showLinkCom={inertialVisualization.showLinkCOM && !thumbnailMode}
                    showInertia={inertialVisualization.showInertia && !thumbnailMode}
                    showReferenceGeometry={
                      inertialVisualization.showReferenceGeometry && !thumbnailMode
                    }
                    scopedLinkNames={inertialVisualization.scopedLinkNames}
                    deemphasizedOutlineLinkNames={simulationPrepRobotMirrorDeemphasizedLinkNames}
                    gpuMode={effectiveGpuMode}
                    onReliabilityChange={onInertiaReliabilityChange}
                  />
                  <SimulationPrepSymmetryOverlay
                    robot={robot}
                    chain={thumbnailMode ? null : simulationPrepSymmetryVisualization}
                    centerMode={simulationPrepSymmetryOverlayCenterMode}
                  />
                  <SimulationPrepRobotMirrorOverlay
                    robot={robot}
                    check={thumbnailMode ? null : simulationPrepRobotMirrorVisualization}
                  />
                </>
              )}
              {viewerUi.showIkHandles &&
                ikEndEffectorLinks.map((ikEeLink, handleIndex) => (
                  <IKDragControls
                    key={`ik-handle-${ikEeLink}`}
                    robot={robot}
                    endEffectorLink={ikEeLink}
                    urdfContent={urdfContent!}
                    urdfAnalysis={urdfAnalysis}
                    currentJointValues={liveIkSeedValues}
                    allowedJointNames={ikAllowedJointNamesByEe.get(ikEeLink)}
                    onIkSolved={(solution, solvedEeLink) =>
                      handleIkDragSolved(solution, { endEffectorLink: solvedEeLink })
                    }
                    onDragStateChange={(dragging) =>
                      handlePerEeDragStateChange(ikEeLink, dragging)
                    }
                    enabled={ikDragEnabled}
                    wheelDriveEnabled={wheelDriveEnabled}
                    handleIndex={handleIndex}
                    handleCount={isWheelRolesOpen ? 1 : ikEndEffectorLinks.length}
                  />
                ))}
              {viewerUi.showWheelRoleMarkers && (
                <StudioWheelRoleMarkers markers={studioWheelRoleMarkers} />
              )}
              {viewerUi.showCreatedObjects && (
                <CreatedObjects
                  robot={robot}
                  gpuMode={effectiveGpuMode}
                  endEffectorLink={endEffectorLink}
                  enableObjectActionsInReadOnly={enableObjectActionsInReadOnly}
                  allowRetargetOnClick={hasActiveObjectTargetInteraction}
                  onIkTargetClick={
                    readOnlyMode && !enableObjectActionsInReadOnly
                      ? undefined
                      : handleObjectIkTargetClick
                  }
                  onObjectSelect={(objectId, object) => {
                    onJointSelect?.(null);
                    onLinkSelect?.(null);
                    useCameraStore.getState().selectCamera(null);
                    if (readOnlyMode || enableObjectActionsInReadOnly) {
                      onObjectSelect?.(objectId, object);
                    }
                  }}
                  editable={!readOnlyMode}
                  onEditDragStateChange={handleObjectEditDragStateChange}
                  orbitDefaults={orbitDefaults}
                />
              )}
            </>
          )}

          {/* Custom axes helper - solid lines for positive, dots for negative */}
          {viewerUi.showSceneChrome && <CustomAxesHelper size={10} />}
          
          {/* Blender-style 3D axis gizmo */}
          {viewerUi.showStudioSceneChrome && <AxisGizmo3D onViewChange={setView} />}
          
          {/* Camera icons visualization */}
          {viewerUi.showStudioSceneChrome && showWorldLayoutOverlays && robot && (
            <CameraIcons
              camerasOverride={cameraIconConfigs}
              floorCalibrationsByCameraId={operatorPointCloudFloorCalibrationsByCameraId}
              robot={robot}
              gpuMode={effectiveGpuMode}
            />
          )}
          {pointCloudGpuOverlayVisible && (
            <>
              <OperatorPointCloudCalibrationPlanes
                planes={operatorPointCloudCalibrationPlanes}
                visible={true}
              />
              {operatorPointCloudOverlayFrames.map((frame) => (
                <OperatorPointCloudOverlay
                  key={frame.cameraId}
                  frame={frame}
                  floorCalibration={
                    operatorPointCloudFloorCalibrationsByCameraId[frame.cameraId] ?? null
                  }
                  visible={true}
                />
              ))}
            </>
          )}
          
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!isDraggingJoint && !isIkHandleDragging && !isObjectEditDragging}
            enablePan={true}
            enableRotate={true}
            enableZoom={true}
            screenSpacePanning={true}
            enableDamping={false}
            panSpeed={1.0}
            rotateSpeed={1.0}
            zoomSpeed={1.0}
          />
        </Canvas>
        </ViewerCanvasErrorBoundary>

        {viewerUi.showIkDialog && (
          <IKResultDialog
            open={ikDialogOpen}
            running={isIkRunning}
            error={ikError}
            result={ikResult}
            targetName={ikTargetName}
            isOrbitTarget={
              ikTargetName
                ? useObjectStore.getState().objects.find((o) => o.id === ikTargetName)?.ikTargetType === "orbit"
                : false
            }
            onClose={closeIkDialog}
            onFollowOrbit={() => {
              if (ikTargetName && ikResult) {
                followOrbitIncremental(ikTargetName);
              }
            }}
          />
        )}

        {/* Runtime preview keeps only reset; full studio keeps the extended toolset. */}
        {viewerUi.showTopRightTools && (
          <div className="absolute top-4 right-48 z-20 flex items-center gap-2">
            {!readOnlyMode && (
              <div className="relative">
                <button
                  type="button"
                  className={cn(
                    "px-3 py-1 text-xs rounded border border-border/60 bg-background/90 shadow-sm transition-colors flex items-center gap-1",
                    robot ? "text-foreground hover:bg-muted" : "text-muted-foreground opacity-70 cursor-not-allowed"
                  )}
                  disabled={!robot}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canOpenDragModeMenu) {
                      setIsDragModeMenuOpen((prev) => !prev);
                    }
                  }}
                >
                  <span className="text-muted-foreground text-[10px]">Utils:</span>
                  {getDragModeDisplayName(effectiveDragMode)}
                  {canOpenDragModeMenu ? (
                    <span className="text-[10px] text-muted-foreground">▼</span>
                  ) : null}
                </button>
                {isDragModeMenuOpen && (
                  <div
                    className="absolute right-0 mt-1 w-48 bg-background/95 border border-border/70 rounded shadow-md text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className={cn(
                        "w-full text-left px-3 py-1.5 hover:bg-muted transition-colors",
                        effectiveDragMode === "move-joints" && "bg-muted/70 font-medium"
                      )}
                      onClick={() => selectDragMode("move-joints")}
                    >
                      Move Joints
                    </button>
                    {canUseDragHandleMode ? (
                      <button
                        className={cn(
                          "w-full text-left px-3 py-1.5 hover:bg-muted transition-colors",
                          effectiveDragMode === "drag-handle" && "bg-muted/70 font-medium"
                        )}
                        onClick={() => selectDragMode("drag-handle")}
                      >
                        Drag Handle
                      </button>
                    ) : null}
                    <button
                      className={cn(
                        "w-full text-left px-3 py-1.5 transition-colors",
                        canUseLeaderTeleopMode
                          ? "hover:bg-muted"
                          : "cursor-not-allowed text-muted-foreground/60",
                        effectiveDragMode === "hardware-teleop" && "bg-muted/70 font-medium"
                      )}
                      disabled={!canUseLeaderTeleopMode}
                      title={
                        canUseLeaderTeleopMode
                          ? "Use the configured leader input"
                          : leaderTeleopUnavailableReason
                      }
                      onClick={() => selectDragMode("hardware-teleop")}
                    >
                      Leader Teleop
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className={cn(
                "px-3 py-1 text-xs rounded border border-border/60 bg-background/90 shadow-sm transition-colors",
                robot ? "text-foreground hover:bg-muted" : "text-muted-foreground opacity-70 cursor-not-allowed"
              )}
              disabled={!robot}
              onClick={(e) => {
                e.stopPropagation();
                handleResetPoseWithGlobalView();
              }}
            >
              Reset Pose
            </button>

            {!readOnlyMode && (
              <div
                className="relative"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={cn(
                    "px-2 py-1 text-[11px] rounded border border-border/60 bg-background/90 shadow-sm transition-colors",
                    selectedWorldObject
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground opacity-70 cursor-not-allowed"
                  )}
                  disabled={!selectedWorldObject}
                  onClick={toggleObjectTools}
                  aria-expanded={isObjectToolsOpen}
                  title="Selected object tools"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span>
                      {selectedWorldObject
                        ? WORLD_OBJECT_EDIT_MODE_LABELS[objectEditMode]
                        : "Object"}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {selectedWorldObject ? (isObjectToolsOpen ? "▲" : "▼") : ""}
                    </span>
                  </span>
                </button>
                {selectedWorldObject && isObjectToolsOpen && (
                  <div className="absolute right-0 mt-1 z-30 w-48 rounded border border-border/70 bg-background/95 p-1 shadow-md">
                    <div className="grid grid-cols-2 gap-1">
                      {(["move", "rotate", "resize"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => selectWorldObjectEditMode(mode)}
                          className={cn(
                            "rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted",
                            objectEditMode === mode && "bg-muted text-foreground"
                          )}
                          title={
                            mode === "move"
                              ? "Move (G)"
                              : mode === "rotate"
                                ? "Rotate (R)"
                                : "Transform (S)"
                          }
                        >
                          {WORLD_OBJECT_EDIT_MODE_LABELS[mode]}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={duplicateSelectedWorldObject}
                        className="rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted"
                        title="Duplicate selected (Shift+D)"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelectedWorldObject}
                        className="rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted"
                        title="Delete selected (Delete)"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="mt-1 px-0.5 text-[8px] leading-none text-muted-foreground/80">
                      G move • R rotate • S transform • Shift+D duplicate • Del delete
                    </div>
                  </div>
                )}
              </div>
            )}

            {!readOnlyMode && hasStudioWheelDrive && studioWheelRoleDisplayEntries.length > 0 && (
              <div
                className="relative"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] rounded border border-border/60 bg-background/90 text-foreground shadow-sm transition-colors hover:bg-muted"
                  onClick={toggleWheelRoles}
                  aria-expanded={isWheelRolesOpen}
                  title="Wheel drive mode and per-wheel role toggles."
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        wheelDriveEnabled ? "bg-emerald-500" : "bg-muted-foreground/45"
                      )}
                    />
                    <span>Wheels {activeStudioWheelDriveCount}/{studioWheelRoleDisplayEntries.length}</span>
                    <span className="text-[9px] text-muted-foreground">
                      {isWheelRolesOpen ? "▲" : "▼"}
                    </span>
                  </span>
                </button>
                {isWheelRolesOpen && (
                  <div className="absolute right-0 mt-1 z-30 w-48 rounded border border-border/70 bg-background/95 p-1 shadow-md">
                    <div className="mb-1 flex items-center gap-1">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded border border-border/60 bg-background/85 px-2 py-1 text-[9px] text-foreground transition-colors hover:bg-muted"
                        onClick={toggleWheelDriveMode}
                        title={wheelDriveEnabled ? "Set wheels to brake" : "Enable wheel drive"}
                      >
                        <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.08em] text-muted-foreground">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              wheelDriveEnabled ? "bg-emerald-500" : "bg-muted-foreground/45"
                            )}
                          />
                          Motion
                        </span>
                        <span className="font-mono text-[8px] uppercase text-muted-foreground">
                          {wheelDriveEnabled ? "On" : "Brake"}
                        </span>
                      </button>
                    </div>
                    <div className="grid gap-1">
                      {studioWheelRoleDisplayEntries.map((entry) => (
                        <button
                          key={entry.jointName}
                          type="button"
                          onClick={() => handleToggleWheelDriveJoint(entry.jointName)}
                          aria-pressed={entry.driveEnabled}
                          title={`${entry.jointName} • ${entry.driveEnabled ? "On" : "Off"}`}
                          className={cn(
                            "w-full rounded border border-border/60 bg-background/85 px-1.5 py-1 text-[9px] text-foreground transition-colors hover:bg-muted",
                            "flex items-center justify-between gap-2",
                            !entry.driveEnabled && "text-muted-foreground"
                          )}
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex h-4 min-w-4 items-center justify-center rounded border px-1 font-mono text-[8px] font-semibold leading-none",
                                "border-border/70 bg-background/85 text-foreground"
                              )}
                            >
                              {entry.wheelNumber}
                            </span>
                            <span className="text-[8px] uppercase tracking-[0.08em]">
                              {entry.side}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                entry.driveEnabled && wheelDriveEnabled
                                  ? "bg-emerald-500"
                                  : "bg-muted-foreground/45"
                              )}
                            />
                            <span className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground/80">
                              {getStudioWheelRoleLabel(entry.role)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!readOnlyMode && isFollowingOrbit && (
              <button
                type="button"
                className="px-3 py-1 text-xs rounded border border-orange-500/60 bg-orange-500/10 text-orange-600 shadow-sm hover:bg-orange-500/20 transition-colors flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  stopOrbitFollow();
                }}
              >
                Stop Orbit ({orbitFollowProgress.toFixed(0)}%)
              </button>
            )}
          </div>
        )}

        {/* Camera POV button (mirror gizmo camera circle) */}
        {robot && (
          <div className="absolute top-4 right-4 z-20">
            <div className="relative">
              <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur-sm">
                <button
                  type="button"
                  aria-label="Global Camera"
                  title="Global Camera"
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors",
                    selectedCameraId === null
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectGlobalCameraView();
                  }}
                >
                  <Globe className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Cameras"
                  title="Cameras"
                  disabled={!hasCameras}
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors",
                    !hasCameras
                      ? "cursor-not-allowed text-muted-foreground/60"
                      : selectedCameraId !== null || isCameraMenuOpen
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCameraMenu();
                  }}
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
              </div>
              {isCameraMenuOpen && hasCameras && (
                <div
                  className="absolute right-0 mt-1 w-44 bg-background/95 border border-border/70 rounded shadow-md text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="border-b border-border/60 px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    Cameras
                  </div>
                  {cameras.map((camera) => (
                    <button
                      key={camera.id}
                      className={cn(
                        "w-full text-left px-3 py-1 hover:bg-muted transition-colors",
                        selectedCameraId === camera.id && "bg-muted/70 font-medium"
                      )}
                      onClick={() => {
                        selectNamedCameraView(camera.id);
                      }}
                    >
                      {camera.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!urdfFile && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-muted-foreground/60">
              Upload URDF to view model
            </span>
          </div>
        )}

      </div>

    </div>
  );
};
