import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '@/shared/store/useCameraStore';
import type { GPUMode } from '@/shared/hooks/use-gpu-mode';
import type { URDFRobot } from 'urdf-loader';

interface CameraIconsProps {
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}

export const CameraIcons = ({ robot, gpuMode = "high" }: CameraIconsProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);

  return (
    <group>
      {cameras.map((camera) => (
        <CameraIcon
          key={camera.id}
          camera={camera}
          robot={robot}
          isSelected={camera.id === selectedCameraId}
          gpuMode={gpuMode}
        />
      ))}
    </group>
  );
};

interface CameraIconProps {
  camera: {
    id: string;
    name: string;
    parent_link: string;
    pose: {
      xyz: [number, number, number];
      rpy: [number, number, number];
    };
    intrinsics: {
      width: number;
      height: number;
      fov_deg: number;
    };
  };
  robot: URDFRobot | null;
  isSelected: boolean;
  gpuMode?: GPUMode;
}

const RPY_ORDER = 'ZYX' as const;
const CAMERA_ROTATION: [number, number, number] = [0, Math.PI / 2, 0];

const CameraIcon = ({ camera, robot, isSelected, gpuMode = "high" }: CameraIconProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const frustumRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    if (!groupRef.current || !robot) return;

    const parentLink = robot.links?.[camera.parent_link];
    
    if (!parentLink) {
      // Fallback: use world coordinates
      groupRef.current.position.set(...camera.pose.xyz);
      groupRef.current.rotation.set(
        camera.pose.rpy[0],
        camera.pose.rpy[1],
        camera.pose.rpy[2],
        RPY_ORDER
      );
      return;
    }

    // Update parent link transform
    parentLink.updateMatrixWorld(true);
    const parentWorldTransform = new THREE.Matrix4().copy(parentLink.matrixWorld);

    // Create local transform from camera pose
    const localTransform = new THREE.Matrix4();
    localTransform.makeRotationFromEuler(
      new THREE.Euler(...camera.pose.rpy, RPY_ORDER)
    );
    localTransform.setPosition(new THREE.Vector3(...camera.pose.xyz));

    // Combine: world = parentWorld * local
    const finalTransform = parentWorldTransform.clone().multiply(localTransform);
    
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalTransform.decompose(position, quaternion, scale);

    groupRef.current.position.copy(position);
    groupRef.current.quaternion.copy(quaternion);
  });

  // Create frustum geometry
  const frustumGeometry = (() => {
    const { fov_deg: fov, width, height } = camera.intrinsics;
    const aspect = width / height;
    const near = 0.05;
    const far = 0.3;
    const fovRad = (fov * Math.PI) / 360;

    const nearHeight = 2 * Math.tan(fovRad) * near;
    const nearWidth = nearHeight * aspect;
    const farHeight = 2 * Math.tan(fovRad) * far;
    const farWidth = farHeight * aspect;

    const vertices = new Float32Array([
      0, 0, 0, // origin
      -nearWidth / 2, nearHeight / 2, -near,
      nearWidth / 2, nearHeight / 2, -near,
      nearWidth / 2, -nearHeight / 2, -near,
      -nearWidth / 2, -nearHeight / 2, -near,
      -farWidth / 2, farHeight / 2, -far,
      farWidth / 2, farHeight / 2, -far,
      farWidth / 2, -farHeight / 2, -far,
      -farWidth / 2, -farHeight / 2, -far,
    ]);

    const indices = new Uint16Array([
      0, 1, 0, 2, 0, 3, 0, 4, // origin to near
      1, 2, 2, 3, 3, 4, 4, 1, // near rectangle
      1, 5, 2, 6, 3, 7, 4, 8, // near to far
      5, 6, 6, 7, 7, 8, 8, 5, // far rectangle
    ]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  })();

  const cameraColor = isSelected ? "#00ff00" : "#ffaa00";

  return (
    <group ref={groupRef} renderOrder={10000}>
      {/* Frustum: rotate from -Z (Three.js) to +X (robotics forward) */}
      <lineSegments
        ref={frustumRef}
        geometry={frustumGeometry}
        rotation={CAMERA_ROTATION}
        raycast={() => null}
      >
        <lineBasicMaterial
          color={cameraColor}
          linewidth={2}
          transparent
          opacity={isSelected ? 1.0 : 0.7}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>

      {/* Camera body */}
      <mesh rotation={CAMERA_ROTATION} raycast={() => null}>
        <boxGeometry args={[0.04, 0.03, 0.03]} />
        <meshStandardMaterial
          color={cameraColor}
          transparent
          opacity={isSelected ? 0.9 : 0.6}
          emissive={isSelected ? cameraColor : "#000000"}
          emissiveIntensity={isSelected ? 0.5 : 0}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      {/* Camera lens */}
      <mesh position={[0.02, 0, 0]} rotation={[0, Math.PI / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.01, 0.01, 0.02, 16]} />
        <meshStandardMaterial 
          color="#333333" 
          transparent 
          opacity={0.8}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
