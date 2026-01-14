import { useCallback, useEffect, useRef } from "react";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { resolveJointScalarValue } from "@/features/viewer/viewer-helpers";
import type { AnimationController } from "@/features/viewer/useAnimationController";

type UseRobotJointSyncParams = {
  robot: URDFRobot | null;
  jointValues: Record<string, number>;
  storeJointValues: Record<string, number>;
  setStoreJointValues: (values: Record<string, number>) => void;
  setAvailableJointsStore: (jointNames: string[]) => void;
  onRobotJointsLoaded?: (joints: string[], angles: Record<string, number>) => void;
  onJointChange?: (jointName: string, value: number) => void;
  isDraggingJoint: boolean;
  isIkHandleDragging: boolean;
  isPlaying: boolean;
  animationController: AnimationController;
};

export const useRobotJointSync = ({
  robot,
  jointValues,
  storeJointValues,
  setStoreJointValues,
  setAvailableJointsStore,
  onRobotJointsLoaded,
  onJointChange,
  isDraggingJoint,
  isIkHandleDragging,
  isPlaying,
  animationController,
}: UseRobotJointSyncParams) => {
  const initialPoseRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!robot) return;
    const allJoints = Object.keys(robot.joints ?? {});
    const joints = allJoints.filter((j) => {
      const jointObj = robot.joints?.[j];
      return (
        jointObj &&
        (typeof resolveJointScalarValue(jointObj) === "number" ||
          jointObj.jointType === "fixed") &&
        !j.toLowerCase().includes("imu") &&
        !j.toLowerCase().includes("site") &&
        !j.toLowerCase().includes("frame")
      );
    });
    const angles: Record<string, number> = {};
    joints.forEach((j) => {
      const jointObj = robot.joints?.[j];
      if (jointObj.jointType === "fixed") {
        angles[j] = 0;
      } else {
        const value = resolveJointScalarValue(jointObj);
        angles[j] = typeof value === "number" ? value : 0;
      }
    });
    initialPoseRef.current = { ...angles };
    onRobotJointsLoaded?.(joints, angles);
    setAvailableJointsStore(joints);
    setStoreJointValues(angles);
  }, [robot, onRobotJointsLoaded, setAvailableJointsStore, setStoreJointValues]);

  useEffect(() => {
    if (!robot || isDraggingJoint || isIkHandleDragging) return;
    if (jointValues === storeJointValues) return;
    applyJointValues(robot, jointValues);
  }, [robot, jointValues, storeJointValues, isDraggingJoint, isIkHandleDragging]);

  const resetPose = useCallback(() => {
    if (!robot) return;
    const resetValues = { ...initialPoseRef.current };
    if (Object.keys(resetValues).length === 0) return;
    applyJointValues(robot, resetValues, { filter: false });
    setStoreJointValues(resetValues);
    if (onJointChange) {
      for (const [name, value] of Object.entries(resetValues)) {
        onJointChange(name, value);
      }
    }
  }, [robot, onJointChange, setStoreJointValues]);

  useEffect(() => {
    if (!robot || isDraggingJoint || isIkHandleDragging) return;
    if (typeof robot.setJointValues !== "function" && typeof robot.setJointValue !== "function")
      return;
    let hasChanges = false;
    const nextValues: Record<string, number> = {};
    for (const [jointName, value] of Object.entries(storeJointValues)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        nextValues[jointName] = value;
        const currentValue = resolveJointScalarValue(robot.joints?.[jointName]);
        if (typeof currentValue === "number" && Math.abs(currentValue - value) > 0.001) {
          hasChanges = true;
        }
      }
    }
    applyJointValues(robot, nextValues, { filter: false });
    if (hasChanges && !isPlaying) {
      animationController.markManualJointChange();
    }
  }, [
    animationController,
    robot,
    storeJointValues,
    isDraggingJoint,
    isIkHandleDragging,
    isPlaying,
  ]);

  return { resetPose };
};
