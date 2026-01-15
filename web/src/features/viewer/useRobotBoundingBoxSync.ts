import { useEffect } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

type UseRobotBoundingBoxSyncParams = {
  robot: URDFRobot | null;
  onRobotBoundingBoxChange?: (boundingBox: THREE.Box3 | null) => void;
  onRobotLoaded?: (robot: URDFRobot | null) => void;
  isDragging?: boolean;
  updateIntervalMs?: number;
};

export const useRobotBoundingBoxSync = ({
  robot,
  onRobotBoundingBoxChange,
  onRobotLoaded,
  isDragging = false,
  updateIntervalMs = 120,
}: UseRobotBoundingBoxSyncParams) => {
  useEffect(() => {
    if (!robot) {
      onRobotBoundingBoxChange?.(null);
      onRobotLoaded?.(null);
      return;
    }

    let rafId = 0;
    let cancelled = false;
    const lastBox = new THREE.Box3();
    let hasBox = false;
    let wasEmpty = false;
    let lastUpdate = 0;

    const updateBox = (timestamp: number) => {
      if (cancelled) return;
      if (isDragging) {
        rafId = requestAnimationFrame(updateBox);
        return;
      }
      if (timestamp - lastUpdate < updateIntervalMs) {
        rafId = requestAnimationFrame(updateBox);
        return;
      }
      lastUpdate = timestamp;
      robot.updateMatrixWorld(true);
      const nextBox = new THREE.Box3().setFromObject(robot);
      if (nextBox.isEmpty()) {
        if (!wasEmpty) {
          wasEmpty = true;
          hasBox = false;
          onRobotBoundingBoxChange?.(null);
        }
      } else if (!hasBox || !nextBox.equals(lastBox)) {
        wasEmpty = false;
        hasBox = true;
        lastBox.copy(nextBox);
        onRobotBoundingBoxChange?.(nextBox);
      }
      rafId = requestAnimationFrame(updateBox);
    };

    onRobotLoaded?.(robot);
    rafId = requestAnimationFrame(updateBox);

    return () => {
      cancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [robot, onRobotBoundingBoxChange, onRobotLoaded, isDragging, updateIntervalMs]);
};
