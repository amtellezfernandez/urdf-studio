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

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const lastBox = new THREE.Box3();
    let hasBox = false;
    let wasEmpty = false;
    const updateBox = () => {
      if (cancelled) return;

      if (!isDragging) {
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
      }

      if (!cancelled) {
        timeoutId = setTimeout(updateBox, updateIntervalMs);
      }
    };

    onRobotLoaded?.(robot);
    updateBox();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [robot, onRobotBoundingBoxChange, onRobotLoaded, isDragging, updateIntervalMs]);
};
