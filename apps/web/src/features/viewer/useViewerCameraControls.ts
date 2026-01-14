import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { URDFRobot } from "urdf-loader";
import { useCameraStore } from "@/shared/store/useCameraStore";

type UseViewerCameraControlsParams = {
  robot: URDFRobot | null;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  sceneRef: MutableRefObject<THREE.Scene | null>;
};

export const useViewerCameraControls = ({
  robot,
  controlsRef,
  cameraRef,
  sceneRef,
}: UseViewerCameraControlsParams) => {
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const cameras = useCameraStore((state) => state.cameras);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);

  const setView = useCallback(
    (
      direction: "front" | "back" | "top" | "bottom" | "left" | "right"
    ) => {
      if (!controlsRef.current || !cameraRef.current || !robot || !sceneRef.current) return;

      const controls = controlsRef.current;
      const camera = cameraRef.current;
      const robotAny = robot;
      const scene = sceneRef.current;

      let center: THREE.Vector3;
      let distance: number;

      let robotGroup: THREE.Object3D | null = null;
      scene.traverse((obj) => {
        if (obj === robotAny || (obj.userData && obj.userData.isURDFRobot)) {
          robotGroup = obj;
        }
      });

      const targetObj = robotGroup || robotAny;

      const box = new THREE.Box3();
      try {
        box.setFromObject(targetObj);
      } catch {
        // Fallback to stored center when bounds cannot be computed.
      }

      if (!box.isEmpty()) {
        center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        distance = Math.max(maxDim * 1.5, 2);
      } else {
        center = robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
        distance = 3;
      }

      let cameraPosition: THREE.Vector3;

      switch (direction) {
        case "front":
          cameraPosition = new THREE.Vector3(center.x + distance, center.y, center.z);
          break;
        case "back":
          cameraPosition = new THREE.Vector3(center.x - distance, center.y, center.z);
          break;
        case "left":
          cameraPosition = new THREE.Vector3(center.x, center.y - distance, center.z);
          break;
        case "right":
          cameraPosition = new THREE.Vector3(center.x, center.y + distance, center.z);
          break;
        case "top":
          cameraPosition = new THREE.Vector3(center.x, center.y, center.z + distance);
          break;
        case "bottom":
          cameraPosition = new THREE.Vector3(center.x, center.y, center.z - distance);
          break;
        default:
          return;
      }

      camera.position.copy(cameraPosition);
      controls.target.copy(center);
      controls.update();
    },
    [cameraRef, controlsRef, robot, sceneRef]
  );

  const handleCameraViewChange = useCallback(
    (cameraId: string) => {
      if (!controlsRef.current || !cameraRef.current || !robot) return;

      const camera = cameras.find((item) => item.id === cameraId);
      if (!camera) return;

      const controls = controlsRef.current;
      const viewCamera = cameraRef.current;
      const robotAny = robot;

      const parentLink = robotAny.links?.[camera.parent_link];
      if (!parentLink) return;

      parentLink.updateMatrixWorld(true);
      const parentWorldTransform = new THREE.Matrix4().copy(parentLink.matrixWorld);

      const localTransform = new THREE.Matrix4();
      const rpyOrder = "ZYX" as const;
      localTransform.makeRotationFromEuler(
        new THREE.Euler(...camera.pose.rpy, rpyOrder)
      );
      localTransform.setPosition(new THREE.Vector3(...camera.pose.xyz));

      const finalTransform = parentWorldTransform.clone().multiply(localTransform);

      const cameraPosition = new THREE.Vector3();
      const cameraQuaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      finalTransform.decompose(cameraPosition, cameraQuaternion, scale);

      const cameraRotation = new THREE.Quaternion();
      cameraRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const finalQuaternion = cameraQuaternion.clone().multiply(cameraRotation);

      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(finalQuaternion);
      const lookAtDistance = 1.0;
      const lookAtPoint = cameraPosition
        .clone()
        .add(forward.multiplyScalar(lookAtDistance));

      viewCamera.position.copy(cameraPosition);
      viewCamera.quaternion.copy(finalQuaternion);
      controls.target.copy(lookAtPoint);
      controls.update();
    },
    [cameraRef, cameras, controlsRef, robot]
  );

  const fitToView = useCallback(() => {
    if (!controlsRef.current || !cameraRef.current || !robot || !sceneRef.current) return;

    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const robotAny = robot;
    const scene = sceneRef.current;

    let center: THREE.Vector3;
    let size: THREE.Vector3;

    let robotGroup: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      if (obj === robotAny || (obj.userData && obj.userData.isURDFRobot)) {
        robotGroup = obj;
      }
    });

    const targetObj = robotGroup || robotAny;
    const box = new THREE.Box3();
    try {
      box.setFromObject(targetObj);
    } catch {
      // Fallback to stored center when bounds cannot be computed.
    }

    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      size = box.getSize(new THREE.Vector3());
    } else {
      center = robotAny.userData?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
      size = new THREE.Vector3(2, 2, 2);
    }

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.max((maxDim * 1.5) / Math.tan(fov / 2), 2);

    const direction = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();

    if (direction.length() < 0.001) {
      direction.set(1, 1, 0.5).normalize();
    }

    const newPosition = center.clone().add(direction.multiplyScalar(distance));
    camera.position.copy(newPosition);
    controls.target.copy(center);
    controls.update();
  }, [cameraRef, controlsRef, robot, sceneRef]);

  useEffect(() => {
    if (!isCameraMenuOpen) return;
    const handleClick = () => setIsCameraMenuOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isCameraMenuOpen]);

  useEffect(() => {
    if (!selectedCameraId) return;
    handleCameraViewChange(selectedCameraId);
  }, [handleCameraViewChange, selectedCameraId]);

  return {
    cameras,
    selectedCameraId,
    selectCamera,
    isCameraMenuOpen,
    setIsCameraMenuOpen,
    setView,
    fitToView,
    handleCameraViewChange,
  };
};
