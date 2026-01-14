import { useEffect } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

type UseRobotBoundingBoxSyncParams = {
  robot: URDFRobot | null;
  onRobotBoundingBoxChange?: (boundingBox: THREE.Box3 | null) => void;
  onRobotLoaded?: (robot: URDFRobot | null) => void;
};

export const useRobotBoundingBoxSync = ({
  robot,
  onRobotBoundingBoxChange,
  onRobotLoaded,
}: UseRobotBoundingBoxSyncParams) => {
  useEffect(() => {
    if (!robot) {
      onRobotBoundingBoxChange?.(null);
      onRobotLoaded?.(null);
      return;
    }

    const box = new THREE.Box3().setFromObject(robot);
    onRobotBoundingBoxChange?.(box);
    onRobotLoaded?.(robot);
  }, [robot, onRobotBoundingBoxChange, onRobotLoaded]);
};
