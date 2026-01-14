import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";

type UseRobotCameraCenteringParams = {
  robot: URDFRobot | null;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
};

export const useRobotCameraCentering = ({
  robot,
  controlsRef,
}: UseRobotCameraCenteringParams) => {
  useEffect(() => {
    if (!robot || !controlsRef.current) return;

    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const robotAny = robot;

    const robotCenter =
      robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);

    const cameraOffset = new THREE.Vector3(1.5, 1.5, 0.8);
    camera.position.copy(robotCenter).add(cameraOffset);

    controls.target.copy(robotCenter);
    controls.update();
  }, [robot, controlsRef]);
};
