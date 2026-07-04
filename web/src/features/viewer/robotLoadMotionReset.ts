import type { AnimationController } from "@/features/viewer/useAnimationController";

export type RobotLoadMotionResetOptions = {
  animationController: AnimationController;
  clearPlayback: () => void;
  clearPlaybackWheelSynthesis: () => void;
  disarmWheelLocomotion: () => void;
  setDraggingJoint: (dragging: boolean) => void;
};

export const resetRobotLoadMotionState = ({
  animationController,
  clearPlayback,
  clearPlaybackWheelSynthesis,
  disarmWheelLocomotion,
  setDraggingJoint,
}: RobotLoadMotionResetOptions): void => {
  clearPlayback();
  disarmWheelLocomotion();
  clearPlaybackWheelSynthesis();
  setDraggingJoint(false);
  animationController.setManualDragActive(false);
  animationController.setPaused(true);
  animationController.setManualFrameTime(null);
  animationController.setPreserveFrameTime(null);
  animationController.setCurrentFrameIndex(0);
  animationController.setResetAnimationStart(false);
  animationController.setSkipFrameUpdate(false);
  animationController.clearManualJointChange();
};
