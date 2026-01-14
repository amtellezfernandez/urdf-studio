import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import { safeDecode } from "@/features/viewer3d/viewer3d-helpers";

export const TrackingLine = ({
  cubePos,
  robot,
  trackedJointName,
  endEffectorLink,
  gpuMode = "high",
}: {
  cubePos: THREE.Vector3;
  robot: URDFRobot | null;
  trackedJointName: string | null;
  endEffectorLink?: string | null;
  gpuMode?: GPUMode;
}) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const targetPosRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!robot || !lineRef.current) return;

    let targetPos: THREE.Vector3 | null = null;

    // If there's a tracked joint, use its center position
    if (trackedJointName) {
      try {
        const joint = robot?.joints?.[trackedJointName];
        if (joint) {
          // Update joint's world matrix to get current position
          joint.updateWorldMatrix(true, true);

          // Get the world position of the joint
          joint.getWorldPosition(targetPosRef.current);
          targetPos = targetPosRef.current;
        }
      } catch (error) {
        console.error("Error getting joint world position:", error);
      }
    } else if (endEffectorLink) {
      // Otherwise use end-effector link center
      try {
        const robotAny = robot;
        const link =
          robotAny?.links?.[endEffectorLink] ??
          robotAny?.getObjectByName?.(endEffectorLink) ??
          robotAny?.getObjectByName?.(safeDecode(endEffectorLink));
        if (link) {
          link.updateMatrixWorld(true);
          link.getWorldPosition(targetPosRef.current);
          targetPos = targetPosRef.current;
        }
      } catch (error) {
        console.error("Error getting link world position:", error);
      }
    }

    // If still no target position, skip drawing
    if (!targetPos) return;

    // Update line geometry
    const geometry = lineRef.current.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (positions) {
      positions.array[0] = cubePos.x;
      positions.array[1] = cubePos.y;
      positions.array[2] = cubePos.z;
      positions.array[3] = targetPos.x;
      positions.array[4] = targetPos.y;
      positions.array[5] = targetPos.z;
      positions.needsUpdate = true;
    }
  });

  return (
    <lineSegments ref={lineRef} renderOrder={1000}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([
            cubePos.x,
            cubePos.y,
            cubePos.z,
            cubePos.x,
            cubePos.y,
            cubePos.z,
          ])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color="#ff00ff"
        linewidth={2}
        opacity={0.7}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
};
