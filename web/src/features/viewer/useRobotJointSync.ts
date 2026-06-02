import { useCallback, useEffect, useRef } from "react";
import type { URDFRobot } from "urdf-loader";
import { resolveApproachArmResetTargetValues } from "@/features/viewer/approachArmReset";
import { getJointLimits, type JointLimits } from "@/shared/lib/urdfBrowser";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { useJointStore } from "@/shared/store/useJointStore";
import type { JointTopology } from "@/shared/store/useJointStore";
import {
  hasJointMapChanged,
  resolveJointScalarValue,
} from "@/features/viewer/viewer-helpers";
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
  isIkTrajectoryApplying: boolean;
  isPlaying: boolean;
  liveTeleopJointSyncActive?: boolean;
  animationController: AnimationController;
  jointLimits?: JointLimits;
  initialPosePolicy?: "robot" | "limits-center";
};

const buildJointTopologySnapshot = (
  robot: URDFRobot,
  jointNames: readonly string[],
): Record<string, JointTopology> =>
  Object.fromEntries(
    jointNames.map((jointName) => {
      const jointObj = robot.joints?.[jointName];
      const parentLinkName =
        typeof jointObj?.parent?.name === "string" && jointObj.parent.name.trim()
          ? jointObj.parent.name
          : null;
      const childLinkNames =
        jointObj?.children
          ?.map((child) => child.name)
          .filter((name): name is string => Boolean(name?.trim())) ?? [];
      return [
        jointName,
        {
          name: jointName,
          type: jointObj?.jointType ?? "",
          parentLinkName,
          childLinkNames,
        },
      ];
    }),
  );

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
  isIkTrajectoryApplying,
  isPlaying,
  liveTeleopJointSyncActive = false,
  animationController,
  jointLimits,
  initialPosePolicy = "robot",
}: UseRobotJointSyncParams) => {
  const initialPoseRef = useRef<Record<string, number>>({});
  const targetJointValuesRef = useRef<Record<string, number>>({});
  const animatedJointValuesRef = useRef<Record<string, number>>({});
  const lastJointValuesPropRef = useRef<Record<string, number> | null>(null);
  const deferredJointValuesRef = useRef<Record<string, number> | null>(null);
  const wasAnyDraggingRef = useRef(false);
  const smoothingRate = 10;
  const dragSmoothingRate = 24;
  const smoothingEpsilon = 1e-4;

  useEffect(() => {
    if (!robot) {
      useJointStore.getState().setInitialJointValues({});
      useJointStore.getState().setDataZeroJointValues({});
      return;
    }
    const allJoints = Object.keys(robot.joints ?? {});
    const joints = allJoints.filter((j) => {
      const jointObj = robot.joints?.[j];
      return (
        jointObj &&
        (typeof resolveJointScalarValue(jointObj) === "number" ||
          jointObj.jointType === "fixed") &&
        !j.toLowerCase().includes("imu") &&
        !j.toLowerCase().includes("site")
      );
    });
    const angles: Record<string, number> = {};
    joints.forEach((j) => {
      const jointObj = robot.joints?.[j];
      if (jointObj.jointType === "fixed") {
        angles[j] = 0;
      } else if (initialPosePolicy === "limits-center") {
        const limits = getJointLimits(jointLimits, j);
        if (Number.isFinite(limits.lower) && Number.isFinite(limits.upper)) {
          angles[j] = (limits.lower + limits.upper) / 2;
        } else if (Number.isFinite(limits.lower)) {
          angles[j] = limits.lower;
        } else if (Number.isFinite(limits.upper)) {
          angles[j] = limits.upper;
        } else {
          angles[j] = 0;
        }
      } else {
        const value = resolveJointScalarValue(jointObj);
        angles[j] = typeof value === "number" ? value : 0;
      }
    });
    initialPoseRef.current = { ...angles };
    onRobotJointsLoaded?.(joints, angles);
    setAvailableJointsStore(joints);
    useJointStore.getState().setInitialJointValues(angles);
    useJointStore.getState().setDataZeroJointValues(angles);
    useJointStore.getState().setDataZeroJointSource("auto");
    useJointStore.getState().setJointTopology(
      buildJointTopologySnapshot(robot, joints),
    );
    setStoreJointValues(angles);
    targetJointValuesRef.current = { ...angles };
    animatedJointValuesRef.current = { ...angles };
  }, [
    robot,
    onRobotJointsLoaded,
    setAvailableJointsStore,
    setStoreJointValues,
    jointLimits,
    initialPosePolicy,
  ]);

  useEffect(() => {
    const propChanged = hasJointMapChanged(jointValues, lastJointValuesPropRef.current);
    lastJointValuesPropRef.current = { ...jointValues };
    const isAnyDragging = isDraggingJoint || isIkHandleDragging || isIkTrajectoryApplying;

    if (!robot) return;
    if (!propChanged) return;
    // Ignore stale prop snapshots (can happen around fast local updates like reset/IK drag).
    if (!hasJointMapChanged(jointValues, storeJointValues)) return;
    if (isAnyDragging) {
      // Parent updates can arrive while dragging; apply them once dragging ends.
      deferredJointValuesRef.current = { ...jointValues };
      return;
    }

    targetJointValuesRef.current = { ...jointValues };
    if (isPlaying) {
      animatedJointValuesRef.current = { ...jointValues };
      applyJointValues(robot, jointValues);
      robot.updateMatrixWorld?.(true);
    }
  }, [
    robot,
    jointValues,
    storeJointValues,
    isDraggingJoint,
    isIkHandleDragging,
    isIkTrajectoryApplying,
    isPlaying,
  ]);

  useEffect(() => {
    targetJointValuesRef.current = { ...storeJointValues };
    if (Object.keys(animatedJointValuesRef.current).length === 0) {
      animatedJointValuesRef.current = { ...storeJointValues };
    }
  }, [storeJointValues]);

  useEffect(() => {
    if (!robot) return;
    if (isPlaying) {
      const snapshot = { ...storeJointValues };
      targetJointValuesRef.current = snapshot;
      animatedJointValuesRef.current = snapshot;
    }
  }, [robot, isPlaying, storeJointValues]);

  useEffect(() => {
    if (!robot) return;
    const isAnyDragging = isDraggingJoint || isIkHandleDragging || isIkTrajectoryApplying;
    if (wasAnyDraggingRef.current && !isAnyDragging) {
      const deferred = deferredJointValuesRef.current;
      if (deferred && hasJointMapChanged(deferred, storeJointValues)) {
        targetJointValuesRef.current = { ...deferred };
        if (isPlaying) {
          animatedJointValuesRef.current = { ...deferred };
          applyJointValues(robot, deferred);
          robot.updateMatrixWorld?.(true);
        }
      } else {
        const snapshot = { ...storeJointValues };
        targetJointValuesRef.current = snapshot;
        animatedJointValuesRef.current = snapshot;
      }
      deferredJointValuesRef.current = null;
    }
    wasAnyDraggingRef.current = isAnyDragging;
  }, [
    robot,
    isDraggingJoint,
    isIkHandleDragging,
    isIkTrajectoryApplying,
    isPlaying,
    storeJointValues,
  ]);

  useEffect(() => {
    if (!robot || typeof requestAnimationFrame === "undefined") return;
    let frameId = 0;
    let lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();

    const tick = (time: number) => {
      const now = Number.isFinite(time) ? time : Date.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // IK drag and live teleop telemetry both own the visual pose directly.
      // Skipping the smoother avoids competing writes and hidden telemetry lag.
      const shouldDirectApplyLiveTeleop =
        liveTeleopJointSyncActive && !isPlaying && !isDraggingJoint;
      if (
        !isPlaying &&
        (shouldDirectApplyLiveTeleop || (!isIkHandleDragging && !isIkTrajectoryApplying))
      ) {
        const targets = targetJointValuesRef.current;
        if (Object.keys(targets).length > 0) {
          if (shouldDirectApplyLiveTeleop) {
            applyJointValues(robot, targets, { filter: false });
            robot.updateMatrixWorld?.(true);
            animatedJointValuesRef.current = { ...targets };
            frameId = requestAnimationFrame(tick);
            return;
          }

          if (isDraggingJoint) {
            applyJointValues(robot, targets, { filter: false });
            robot.updateMatrixWorld?.(true);
            animatedJointValuesRef.current = { ...targets };
            frameId = requestAnimationFrame(tick);
            return;
          }

          const rate = isDraggingJoint || isIkHandleDragging ? dragSmoothingRate : smoothingRate;
          const blend = 1 - Math.exp(-rate * delta);
          let shouldApply = false;
          const nextValues: Record<string, number> = {};

          for (const [jointName, target] of Object.entries(targets)) {
            if (!Number.isFinite(target)) continue;
            const current =
              animatedJointValuesRef.current[jointName] ??
              resolveJointScalarValue(robot.joints?.[jointName]) ??
              target;
            const deltaValue = target - current;
            const next =
              Math.abs(deltaValue) <= smoothingEpsilon ? target : current + deltaValue * blend;
            animatedJointValuesRef.current[jointName] = next;
            nextValues[jointName] = next;
            if (Math.abs(next - current) > smoothingEpsilon) {
              shouldApply = true;
            }
          }

          if (shouldApply) {
            applyJointValues(robot, nextValues, { filter: false });
            robot.updateMatrixWorld?.(true);
          }
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [
    robot,
    isDraggingJoint,
    isIkHandleDragging,
    isIkTrajectoryApplying,
    isPlaying,
    liveTeleopJointSyncActive,
  ]);

  const resetPose = useCallback(() => {
    if (!robot) return;
    const resetValues = { ...initialPoseRef.current };
    if (Object.keys(resetValues).length === 0) return;
    // Reset is a manual override and must not be overwritten by paused frame-lock playback.
    animationController.markManualJointChange();
    applyJointValues(robot, resetValues, { filter: false });
    robot.updateMatrixWorld?.(true);
    targetJointValuesRef.current = { ...resetValues };
    animatedJointValuesRef.current = { ...resetValues };
    setStoreJointValues(resetValues);
    if (onJointChange) {
      for (const [name, value] of Object.entries(resetValues)) {
        onJointChange(name, value);
      }
    }
  }, [animationController, robot, onJointChange, setStoreJointValues]);

  const setJointTargetsToInitialPose = useCallback(
    (jointNames: Iterable<string>) => {
      if (!robot) return false;
      const resetValues = resolveApproachArmResetTargetValues({
        jointNames,
        initialJointTargets: initialPoseRef.current,
      });
      if (Object.keys(resetValues).length === 0) return false;

      const currentValues = useJointStore.getState().jointValues;
      const nextValues = { ...currentValues };
      let hasChanges = false;

      for (const [jointName, target] of Object.entries(resetValues)) {
        if (
          !Number.isFinite(nextValues[jointName]) ||
          Math.abs((nextValues[jointName] as number) - target) > smoothingEpsilon
        ) {
          nextValues[jointName] = target;
          hasChanges = true;
        }
      }

      if (!hasChanges) return resetValues;
      animationController.markManualJointChange();
      setStoreJointValues(nextValues);
      return resetValues;
    },
    [animationController, robot, setStoreJointValues]
  );

  useEffect(() => {
    if (!robot || isDraggingJoint || isIkHandleDragging || isIkTrajectoryApplying) return;
    if (typeof robot.setJointValues !== "function" && typeof robot.setJointValue !== "function")
      return;
    let hasChanges = false;
    for (const [jointName, value] of Object.entries(storeJointValues)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        const currentValue = resolveJointScalarValue(robot.joints?.[jointName]);
        if (typeof currentValue === "number" && Math.abs(currentValue - value) > 0.001) {
          hasChanges = true;
        }
      }
    }
    if (hasChanges && !isPlaying && !liveTeleopJointSyncActive) {
      animationController.markManualJointChange();
    }
  }, [
    animationController,
    robot,
    storeJointValues,
    isDraggingJoint,
    isIkHandleDragging,
    isIkTrajectoryApplying,
    isPlaying,
    liveTeleopJointSyncActive,
  ]);

  return { resetPose, setJointTargetsToInitialPose };
};
