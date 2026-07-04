import { describe, expect, it, vi } from "vitest";

import { resetRobotLoadMotionState } from "@/features/viewer/robotLoadMotionReset";
import type { AnimationController } from "@/features/viewer/useAnimationController";

const createAnimationControllerMock = (): AnimationController =>
  ({
    manualFrameTimeRef: { current: 123 },
    preserveFrameTimeRef: { current: 123 },
    currentFrameIndexRef: { current: 4 },
    resetAnimationStartRef: { current: true },
    isPausedRef: { current: false },
    hasManualJointChangesRef: { current: true },
    isManualDragActiveRef: { current: true },
    skipFrameUpdateRef: { current: true },
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

describe("resetRobotLoadMotionState", () => {
  it("clears playback, wheel locomotion, drag state, and frame locks before a robot load", () => {
    const animationController = createAnimationControllerMock();
    const clearPlayback = vi.fn();
    const clearPlaybackWheelSynthesis = vi.fn();
    const disarmWheelLocomotion = vi.fn();
    const setDraggingJoint = vi.fn();

    resetRobotLoadMotionState({
      animationController,
      clearPlayback,
      clearPlaybackWheelSynthesis,
      disarmWheelLocomotion,
      setDraggingJoint,
    });

    expect(clearPlayback).toHaveBeenCalledTimes(1);
    expect(disarmWheelLocomotion).toHaveBeenCalledTimes(1);
    expect(clearPlaybackWheelSynthesis).toHaveBeenCalledTimes(1);
    expect(setDraggingJoint).toHaveBeenCalledWith(false);
    expect(animationController.setManualDragActive).toHaveBeenCalledWith(false);
    expect(animationController.setPaused).toHaveBeenCalledWith(true);
    expect(animationController.setManualFrameTime).toHaveBeenCalledWith(null);
    expect(animationController.setPreserveFrameTime).toHaveBeenCalledWith(null);
    expect(animationController.setCurrentFrameIndex).toHaveBeenCalledWith(0);
    expect(animationController.setResetAnimationStart).toHaveBeenCalledWith(false);
    expect(animationController.setSkipFrameUpdate).toHaveBeenCalledWith(false);
    expect(animationController.clearManualJointChange).toHaveBeenCalledTimes(1);
  });
});
