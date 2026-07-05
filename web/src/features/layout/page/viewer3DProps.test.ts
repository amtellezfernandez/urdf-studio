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

  it("disables editable joint handlers in read-only mode", () => {
    const onJointSelect = vi.fn();
    const onLinkSelect = vi.fn();
    const onJointHover = vi.fn();
    const onLinkHover = vi.fn();
    const onJointChange = vi.fn();

    const props = buildViewer3DProps({
      readOnlyMode: true,
      setSelectedJoint: onJointSelect,
      setSelectedLink: onLinkSelect,
      setHoveredJoint: onJointHover,
      setHoveredLink: onLinkHover,
      handleJointChange: onJointChange,
    });

    expect(props.onJointSelect).toBeUndefined();
    expect(props.onLinkSelect).toBeUndefined();
    expect(props.onJointHover).toBeUndefined();
    expect(props.onLinkHover).toBeUndefined();

    props.onJointChange?.("joint_a", 1.2);
    expect(onJointChange).not.toHaveBeenCalled();
  });

  it("keeps editable joint handlers active outside read-only mode", () => {
    const onJointSelect = vi.fn();
    const onLinkSelect = vi.fn();
    const onJointHover = vi.fn();
    const onLinkHover = vi.fn();
    const onJointChange = vi.fn();

    const props = buildViewer3DProps({
      readOnlyMode: false,
      setSelectedJoint: onJointSelect,
      setSelectedLink: onLinkSelect,
      setHoveredJoint: onJointHover,
      setHoveredLink: onLinkHover,
      handleJointChange: onJointChange,
    });

    expect(props.onJointSelect).toBe(onJointSelect);
    expect(props.onLinkSelect).toBe(onLinkSelect);
    expect(props.onJointHover).toBe(onJointHover);
    expect(props.onLinkHover).toBe(onLinkHover);
    expect(props.onJointChange).toBe(onJointChange);
  });
});
