import { describe, expect, it, vi } from "vitest";
import { toViewer3DProps } from "@/features/layout/page/viewer3DProps";

type Viewer3DPropsInput = Parameters<typeof toViewer3DProps>[0];

const buildViewer3DProps = (overrides: Partial<Viewer3DPropsInput> = {}) =>
  toViewer3DProps({
    workspaceMode: "studio",
    urdfFile: null,
    assemblySecondaryModels: [],
    urdfAnalysis: null,
    meshFiles: {},
    hoveredJoint: null,
    hoveredLink: null,
    selectedJoint: null,
    selectedLink: null,
    jointValues: {},
    jointLimits: {},
    jointAxes: {},
    collisionVisibility: {},
    collisionsVisible: false,
    collisionSimplifyLinks: [],
    collisionMergedLinks: [],
    rotationPlaneVisible: false,
    inertialVisualization: {
      showGlobalCOM: false,
      showLinkCOM: false,
      showInertia: false,
      showReferenceGeometry: false,
      scopedLinkNames: null,
    },
    setSelectedJoint: vi.fn(),
    setSelectedLink: vi.fn(),
    setHoveredJoint: vi.fn(),
    setHoveredLink: vi.fn(),
    handleJointChange: vi.fn(),
    handleRobotJointsLoaded: vi.fn(),
    setIsPlaying: vi.fn(),
    setHasAnimationFrames: vi.fn(),
    handleFrameChange: vi.fn(),
    setRobotBoundingBox: vi.fn(),
    setRobot: vi.fn(),
    endEffectorLink: null,
    handleIkApplied: vi.fn(),
    vizUrdfContent: "",
    updateUrdfFile: vi.fn(),
    ...overrides,
  });

describe("toViewer3DProps", () => {
  it("forwards the simulation prep panel state so viewer world chrome can be suppressed", () => {
    const props = buildViewer3DProps({
      simulationPrepPanelOpen: true,
      simulationPrepResetPoseRequestKey: "request-1",
    });

    expect(props.simulationPrepPanelOpen).toBe(true);
    expect(props.simulationPrepResetPoseRequestKey).toBe("request-1");
    expect(typeof props.onLinkHover).toBe("function");
  });

  it("suppresses simulation prep overlays when the panel is closed", () => {
    const props = buildViewer3DProps({
      simulationPrepPanelOpen: false,
      inertialVisualization: {
        showGlobalCOM: false,
        showLinkCOM: false,
        showInertia: true,
        showReferenceGeometry: true,
        scopedLinkNames: ["left_link"],
      },
      simulationPrepRobotMirrorVisualization: {
        planeLabel: "xz",
      } as unknown as Viewer3DPropsInput["simulationPrepRobotMirrorVisualization"],
      simulationPrepRobotMirrorDeemphasizedLinkNames: ["right_link"],
      simulationPrepSymmetryVisualization: {
        symmetryRootLinkName: "base_link",
        outlierBranchRootLinkName: "left_link",
      } as unknown as Viewer3DPropsInput["simulationPrepSymmetryVisualization"],
    });

    expect(props.inertialVisualization?.scopedLinkNames).toBeNull();
    expect(props.simulationPrepRobotMirrorVisualization).toBeNull();
    expect(props.simulationPrepRobotMirrorDeemphasizedLinkNames).toBeNull();
    expect(props.simulationPrepSymmetryVisualization).toBeNull();
  });
});
