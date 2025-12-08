import { useCallback, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '@/store/useCameraStore';
import type { GPUMode } from '@/hooks/use-gpu-mode';

interface URDFRobot {
  joints: Record<string, any>;
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

interface CameraIconsProps {
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}

export const CameraIcons = ({ robot, gpuMode = "high" }: CameraIconsProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);

  const handlePointerDown = useCallback((e: any, cameraId: string) => {
    e.stopPropagation();
    selectCamera(cameraId);
  }, [selectCamera]);

  return (
    <group>
      {cameras.map((camera) => (
        <CameraIcon
          key={camera.id}
          camera={camera}
          robot={robot}
          isSelected={camera.id === selectedCameraId}
          onPointerDown={(e) => handlePointerDown(e, camera.id)}
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
  onPointerDown: (e: any) => void;
  gpuMode?: GPUMode;
}

const CameraIcon = ({ camera, robot, isSelected, onPointerDown, gpuMode = "high" }: CameraIconProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const frustumRef = useRef<THREE.LineSegments>(null);

  // Update camera position and rotation based on parent link
  useFrame(() => {
    if (!groupRef.current || !robot) return;

    // Find the parent link in the robot (cameras are attached to links, not joints)
    const parentLink = (robot as any).links?.[camera.parent_link];
    if (!parentLink) {
      // If no parent link found, use world coordinates
      groupRef.current.position.set(
        camera.pose.xyz[0],
        camera.pose.xyz[1],
        camera.pose.xyz[2]
      );
      groupRef.current.rotation.set(
        camera.pose.rpy[0],
        camera.pose.rpy[1],
        camera.pose.rpy[2]
      );
      return;
    }

    // Update parent link's world matrix to ensure it's current
    parentLink.updateMatrixWorld(true);
    
    // Get world transform of parent link
    const parentWorldTransform = new THREE.Matrix4();
    parentWorldTransform.copy(parentLink.matrixWorld);

    // Apply camera's local pose (relative to parent link)
    const localTransform = new THREE.Matrix4();
    const position = new THREE.Vector3(
      camera.pose.xyz[0],
      camera.pose.xyz[1],
      camera.pose.xyz[2]
    );
    const rotation = new THREE.Euler(
      camera.pose.rpy[0],
      camera.pose.rpy[1],
      camera.pose.rpy[2]
    );
    localTransform.makeRotationFromEuler(rotation);
    localTransform.setPosition(position);

    // Combine transforms: world = parentWorld * local
    const finalTransform = new THREE.Matrix4();
    finalTransform.copy(parentWorldTransform).multiply(localTransform);

    // Extract position and rotation
    const finalPosition = new THREE.Vector3();
    const finalRotation = new THREE.Quaternion();
    const finalScale = new THREE.Vector3();
    finalTransform.decompose(finalPosition, finalRotation, finalScale);

    groupRef.current.position.copy(finalPosition);
    groupRef.current.quaternion.copy(finalRotation);
  });

  // Create camera frustum geometry
  const createFrustumGeometry = () => {
    const fov = camera.intrinsics.fov_deg;
    const aspect = camera.intrinsics.width / camera.intrinsics.height;
    const near = 0.05;
    const far = 0.3;

    // Calculate frustum dimensions at near and far planes
    const nearHeight = 2 * Math.tan((fov * Math.PI) / 360) * near;
    const nearWidth = nearHeight * aspect;
    const farHeight = 2 * Math.tan((fov * Math.PI) / 360) * far;
    const farWidth = farHeight * aspect;

    // Define frustum vertices
    const vertices = new Float32Array([
      // Camera origin
      0, 0, 0,
      // Near plane corners
      -nearWidth / 2, nearHeight / 2, -near,
      nearWidth / 2, nearHeight / 2, -near,
      nearWidth / 2, -nearHeight / 2, -near,
      -nearWidth / 2, -nearHeight / 2, -near,
      // Far plane corners
      -farWidth / 2, farHeight / 2, -far,
      farWidth / 2, farHeight / 2, -far,
      farWidth / 2, -farHeight / 2, -far,
      -farWidth / 2, -farHeight / 2, -far,
    ]);

    // Define edges
    const indices = new Uint16Array([
      // Lines from camera origin to near plane
      0, 1, 0, 2, 0, 3, 0, 4,
      // Near plane rectangle
      1, 2, 2, 3, 3, 4, 4, 1,
      // Lines from near to far plane
      1, 5, 2, 6, 3, 7, 4, 8,
      // Far plane rectangle
      5, 6, 6, 7, 7, 8, 8, 5,
    ]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return geometry;
  };

  const frustumGeometry = createFrustumGeometry();

  return (
    <group ref={groupRef}>
      {/* Camera frustum */}
      <lineSegments
        ref={frustumRef}
        geometry={frustumGeometry}
        onPointerDown={onPointerDown}
      >
        <lineBasicMaterial
          color={isSelected ? "#00ff00" : "#ffaa00"}
          linewidth={2}
          transparent
          opacity={isSelected ? 1.0 : 0.7}
        />
      </lineSegments>

      {/* Camera body (small box) */}
      <mesh onPointerDown={onPointerDown}>
        <boxGeometry args={[0.04, 0.03, 0.03]} />
        <meshStandardMaterial
          color={isSelected ? "#00ff00" : "#ffaa00"}
          transparent
          opacity={isSelected ? 0.9 : 0.6}
          emissive={isSelected ? "#00ff00" : "#000000"}
          emissiveIntensity={isSelected ? 0.5 : 0}
        />
      </mesh>

      {/* Camera lens (small cylinder) */}
      <mesh position={[0, 0, -0.02]} rotation={[Math.PI / 2, 0, 0]} onPointerDown={onPointerDown}>
        <cylinderGeometry args={[0.01, 0.01, 0.02, 16]} />
        <meshStandardMaterial
          color="#333333"
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
};
