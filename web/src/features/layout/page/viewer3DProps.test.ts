import { describe, expect, it, vi } from "vitest";
import { toViewer3DProps } from "@/features/layout/page/viewer3DProps";

describe("toViewer3DProps", () => {
  it("forwards the simulation prep panel state so viewer world chrome can be suppressed", () => {
    const props = toViewer3DProps({
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
      simulationPrepPanelOpen: true,
      simulationPrepResetPoseRequestKey: "request-1",
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
    });

    expect(props.simulationPrepPanelOpen).toBe(true);
    expect(props.simulationPrepResetPoseRequestKey).toBe("request-1");
    expect(typeof props.onLinkHover).toBe("function");
  });
});
