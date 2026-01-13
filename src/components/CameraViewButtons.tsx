import React, { useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useCameraStore } from "@/store/useCameraStore";
import type { Camera } from "@/types/camera";
import type { URDFRobot } from "urdf-loader";

interface CameraViewButtonsProps {
  robot: URDFRobot | null;
  onCameraViewChange?: (cameraId: string) => void;
}

/**
 * Blender-style camera view buttons positioned near the axis gizmo
 * Shows buttons for each camera to switch to that camera's POV
 */
export const CameraViewButtons = ({ robot, onCameraViewChange }: CameraViewButtonsProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const cameras = useCameraStore((state) => state.cameras);

  // Position buttons relative to camera in a fixed position (below axis gizmo)
  useFrame(() => {
    if (!groupRef.current) return;

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    const cameraRight = new THREE.Vector3();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const cameraUp = new THREE.Vector3();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);

    // Position below axis gizmo
    const viewDistance = 1.2;
    const screenOffsetX = 0.65;
    const screenOffsetY = 0.1; // Lower than gizmo

    const buttonsPosition = camera.position.clone()
      .add(cameraDirection.clone().multiplyScalar(viewDistance))
      .add(cameraRight.clone().multiplyScalar(screenOffsetX))
      .add(cameraUp.clone().multiplyScalar(screenOffsetY));

    groupRef.current.position.copy(buttonsPosition);
    groupRef.current.rotation.set(0, 0, 0);

    // Scale based on distance
    const distanceToCamera = camera.position.distanceTo(buttonsPosition);
    const screenHeight = camera instanceof THREE.PerspectiveCamera
      ? 2 * Math.tan((camera.fov * Math.PI) / 360) * distanceToCamera
      : camera instanceof THREE.OrthographicCamera
        ? Math.abs(camera.top - camera.bottom) / camera.zoom
        : 1;
    const scaleFactor = (100 / 600) * (screenHeight / 2);
    const scale = Math.max(0.12, Math.min(0.30, scaleFactor));
    groupRef.current.scale.setScalar(scale);
  });

  const buttonRadius = 0.08;
  const buttonSpacing = 0.20;
  const cameraColor = "#ffaa00";

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: cameraColor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });
  }, []);

  const hoverMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: "#ffcc00",
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1.0,
    });
  }, []);

  if (cameras.length === 0) return null;

  return (
    <group ref={groupRef} renderOrder={9999}>
      {cameras.map((cam, index) => {
        const yOffset = -(index * buttonSpacing);
        return <CameraButton
          key={cam.id}
          camera={cam}
          yOffset={yOffset}
          buttonRadius={buttonRadius}
          material={material}
          hoverMaterial={hoverMaterial}
          onCameraViewChange={onCameraViewChange}
        />;
      })}
    </group>
  );
};

const CameraButton = ({ 
  camera, 
  yOffset, 
  buttonRadius, 
  material, 
  hoverMaterial, 
  onCameraViewChange 
}: {
  camera: Camera;
  yOffset: number;
  buttonRadius: number;
  material: THREE.Material;
  hoverMaterial: THREE.Material;
  onCameraViewChange?: (cameraId: string) => void;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <group position={[0, yOffset, 0]}>
      <mesh
        material={hovered ? hoverMaterial : material}
        onPointerDown={(e) => {
          e.stopPropagation();
          onCameraViewChange?.(camera.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = 'default';
        }}
      >
        <sphereGeometry args={[buttonRadius, 16, 16]} />
      </mesh>
      <group renderOrder={10000} position={[buttonRadius + 0.05, 0, 0]}>
        <Text
          position={[0, 0, 0]}
          fontSize={0.08}
          color="#ffffff"
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
          renderOrder={10001}
        >
          {camera.name}
        </Text>
      </group>
    </group>
  );
};
