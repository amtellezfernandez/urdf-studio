/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { URDFRobot } from "urdf-loader";

import { useRobotJointSync } from "@/features/viewer/useRobotJointSync";
import type { AnimationController } from "@/features/viewer/useAnimationController";
import { useJointStore } from "@/shared/store/useJointStore";

const createAnimationControllerMock = (): AnimationController =>
  ({
    manualFrameTimeRef: { current: null },
    preserveFrameTimeRef: { current: null },
    currentFrameIndexRef: { current: 0 },
    resetAnimationStartRef: { current: false },
    isPausedRef: { current: true },
    hasManualJointChangesRef: { current: false },
    isManualDragActiveRef: { current: false },
    skipFrameUpdateRef: { current: false },
    setManualFrameTime: vi.fn(),
    setPreserveFrameTime: vi.fn(),
    setCurrentFrameIndex: vi.fn(),
    setResetAnimationStart: vi.fn(),
    setPaused: vi.fn(),
    setManualDragActive: vi.fn(),
    setSkipFrameUpdate: vi.fn(),
    markManualJointChange: vi.fn(),
    clearManualJointChange: vi.fn(),
  }) as AnimationController;

const createRobot = (
  jointAngles: Record<string, number>
): URDFRobot & {
  setJointValues: ReturnType<typeof vi.fn>;
  updateMatrixWorld: ReturnType<typeof vi.fn>;
} =>
  ({
    joints: Object.fromEntries(
      Object.entries(jointAngles).map(([jointName, angle]) => [
        jointName,
        {
          jointType: "revolute",
          angle,
          parent: { name: `${jointName}_parent` },
          children: [{ name: `${jointName}_child` }],
        },
      ])
    ),
    setJointValues: vi.fn(),
    updateMatrixWorld: vi.fn(),
  }) as unknown as URDFRobot & {
    setJointValues: ReturnType<typeof vi.fn>;
    updateMatrixWorld: ReturnType<typeof vi.fn>;
  };

const resetJointStore = () => {
  useJointStore.setState({
    jointValues: {},
    initialJointValues: {},
    dataZeroJointValues: {},
    importedDataZeroJointValues: {},
    dataZeroJointSource: "auto",
    jointUpdateTimes: {},
    availableJoints: [],
    jointTopologyByName: {},
  });
};

describe("useRobotJointSync", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resetJointStore();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies the loaded robot initial pose before stale external joint values can move it", async () => {
    const robot = createRobot({ shoulder: 0, elbow: 0.25 });
    const staleJointValues = { shoulder: 1.2, elbow: -0.7 };
    const setStoreJointValues = vi.fn();
    const setAvailableJointsStore = vi.fn();
    const onRobotJointsLoaded = vi.fn();
    const animationController = createAnimationControllerMock();

    const Harness = () => {
      useRobotJointSync({
        robot,
        jointValues: staleJointValues,
        storeJointValues: staleJointValues,
        setStoreJointValues,
        setAvailableJointsStore,
        onRobotJointsLoaded,
        isDraggingJoint: false,
        isIkHandleDragging: false,
        isIkTrajectoryApplying: false,
        isPlaying: false,
        animationController,
      });
      return null;
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    const initialJointAngles = { shoulder: 0, elbow: 0.25 };
    expect(robot.setJointValues).toHaveBeenCalledWith(initialJointAngles);
    expect(robot.setJointValues).not.toHaveBeenCalledWith(staleJointValues);
    expect(robot.updateMatrixWorld).toHaveBeenCalledWith(true);
    expect(setStoreJointValues).toHaveBeenCalledWith(initialJointAngles);
    expect(setAvailableJointsStore).toHaveBeenCalledWith(["shoulder", "elbow"]);
    expect(onRobotJointsLoaded).toHaveBeenCalledWith(
      ["shoulder", "elbow"],
      initialJointAngles
    );
    expect(animationController.clearManualJointChange).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
  });
});
