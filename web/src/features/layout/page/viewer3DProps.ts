import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RepeatedInertiaSymmetryCenterMode } from "@/features/layout/page/repeatedInertiaSymmetryCenterMode";
import type {
  InertialVisualizationSettings,
  MeshFiles,
  RobotBasePose,
} from "@/shared/types/feature";
import type { JointAxisMap, JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import type { AssemblySecondaryModel } from "@/features/assembly/types";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { IkAppliedMetadata } from "@/features/viewer/useIkSolver";

type Viewer3DPropsInput = {
  workspaceMode: WorkspaceMode;
  assemblyPrimaryModel?: { id: string; name: string };
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
  collisionsVisible: boolean;
  collisionSimplifyLinks: string[];
  collisionMergedLinks: string[];
  rotationPlaneVisible: boolean;
  inertialVisualization: InertialVisualizationSettings;
  simulationPrepPanelOpen?: boolean;
  simulationPrepResetPoseRequestKey?: string | null;
  simulationPrepRobotMirrorVisualization?: RobotMirrorSymmetryCheck | null;
  simulationPrepRobotMirrorDeemphasizedLinkNames?: string[] | null;
  simulationPrepSymmetryVisualization?: RepeatedInertiaSymmetryChain | null;
  simulationPrepSymmetryOverlayCenterMode?: RepeatedInertiaSymmetryCenterMode;
  setSelectedJoint: (joint: string | null) => void;
  setSelectedLink: (link: string | null) => void;
  setHoveredJoint: (joint: string | null) => void;
  setHoveredLink: (link: string | null) => void;
  handleJointChange: (jointName: string, value: number) => void;
  handleRobotJointsLoaded: (
    jointNames: string[],
    jointValues: Record<string, number>
  ) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setHasAnimationFrames: (hasFrames: boolean) => void;
  handleFrameChange: (frame: number, total: number) => void;
  setRobotBoundingBox: (box: THREE.Box3 | null) => void;
  setRobot: (robot: URDFRobot | null) => void;
  endEffectorLink: string | null;
  handleIkApplied: (
    values: Record<string, number>,
    metadata: IkAppliedMetadata,
  ) => void;
  ikDragSuppressed?: boolean;
  vizUrdfContent: string;
  updateUrdfFile: (content: string) => void;
  runtimeRobotBasePose?: RobotBasePose | null;
  onObjectSelect?: Viewer3DProps["onObjectSelect"];
  onInertiaReliabilityChange?: Viewer3DProps["onInertiaReliabilityChange"];
  enableObjectActionsInReadOnly?: boolean;
  thumbnailMode?: boolean;
  readOnlyMode?: boolean;
  preferStudioRuntime?: boolean;
};

export const toViewer3DProps = ({
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
  simulationPrepPanelOpen = false,
  simulationPrepResetPoseRequestKey = null,
  simulationPrepRobotMirrorVisualization = null,
  simulationPrepRobotMirrorDeemphasizedLinkNames = null,
  simulationPrepSymmetryVisualization = null,
  simulationPrepSymmetryOverlayCenterMode = "robot-center",
  setSelectedJoint,
  setSelectedLink,
  setHoveredJoint,
  setHoveredLink,
  handleJointChange,
  handleRobotJointsLoaded,
  setIsPlaying,
  setHasAnimationFrames,
  handleFrameChange,
  setRobotBoundingBox,
  setRobot,
  endEffectorLink,
  handleIkApplied,
  ikDragSuppressed = false,
  vizUrdfContent,
  updateUrdfFile,
  runtimeRobotBasePose = null,
  onObjectSelect,
  onInertiaReliabilityChange,
  enableObjectActionsInReadOnly = false,
  thumbnailMode = false,
  readOnlyMode = false,
  preferStudioRuntime = false,
}: Viewer3DPropsInput): Viewer3DProps => {
  const effectiveInertialVisualization =
    simulationPrepPanelOpen || inertialVisualization.scopedLinkNames === null
      ? inertialVisualization
      : {
          ...inertialVisualization,
          scopedLinkNames: null,
        };
  const effectiveSimulationPrepRobotMirrorVisualization = simulationPrepPanelOpen
    ? simulationPrepRobotMirrorVisualization
    : null;
  const effectiveSimulationPrepRobotMirrorDeemphasizedLinkNames = simulationPrepPanelOpen
    ? simulationPrepRobotMirrorDeemphasizedLinkNames
    : null;
  const effectiveSimulationPrepSymmetryVisualization = simulationPrepPanelOpen
    ? simulationPrepSymmetryVisualization
    : null;

  return {
    workspaceMode,
    assemblyPrimaryModel,
    urdfFile,
    assemblySecondaryModels,
    urdfBasePath,
    packageRoots,
    urdfAnalysis,
    initialMeshFiles: meshFiles,
    selectedJoint: hoveredJoint || selectedJoint,
    selectedLink,
    jointValues,
    jointLimits,
    jointAxes,
    onJointSelect: readOnlyMode ? undefined : setSelectedJoint,
    onLinkSelect: readOnlyMode ? undefined : setSelectedLink,
    onJointHover: readOnlyMode ? undefined : setHoveredJoint,
    onLinkHover: readOnlyMode ? undefined : setHoveredLink,
    onJointChange: readOnlyMode ? (() => {}) : handleJointChange,
    onRobotJointsLoaded: handleRobotJointsLoaded,
    onPlayingChange: setIsPlaying,
    onAnimationFramesChange: setHasAnimationFrames,
    onFrameChange: handleFrameChange,
    collisionVisibility,
    collisionsVisible,
    collisionSimplifyLinks,
    collisionMergedLinks,
    rotationPlaneVisible,
    inertialVisualization: effectiveInertialVisualization,
    simulationPrepPanelOpen,
    simulationPrepResetPoseRequestKey,
    simulationPrepRobotMirrorVisualization: effectiveSimulationPrepRobotMirrorVisualization,
    simulationPrepRobotMirrorDeemphasizedLinkNames:
      effectiveSimulationPrepRobotMirrorDeemphasizedLinkNames,
    simulationPrepSymmetryVisualization: effectiveSimulationPrepSymmetryVisualization,
    simulationPrepSymmetryOverlayCenterMode,
    onRobotBoundingBoxChange: setRobotBoundingBox,
    onRobotLoaded: setRobot,
    endEffectorLink,
    onIkApplied: handleIkApplied,
    ikDragSuppressed,
    vizUrdfContent,
    onAutoPatchWheelRolesUrdf: updateUrdfFile,
    readOnlyMode,
    thumbnailMode,
    preferStudioRuntime,
    runtimeRobotBasePose,
    onObjectSelect,
    onInertiaReliabilityChange,
    enableObjectActionsInReadOnly,
  };
};
