import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { Camera } from "@/shared/types/camera";
import type { URDFRobot } from "urdf-loader";
import { getCameraWorldPose } from "./cameraWorldPose";
import {
  CAMERA_ICON_ANCHOR_RADIUS_M,
  CAMERA_ICON_BODY_OFFSET_M,
  CAMERA_ICON_BODY_SIZE_M,
  CAMERA_ICON_ENVELOPE_COLOR,
  CAMERA_ICON_ENVELOPE_OPACITY,
  CAMERA_ICON_LENS_LENGTH_M,
  CAMERA_ICON_LENS_OFFSET_M,
  CAMERA_ICON_LENS_RADIUS_M,
  CAMERA_ICON_LENS_ROTATION_RAD,
} from "@/features/camera/cameraIconParams";
import {
  createCameraIconFrustumGeometry,
  toCameraIconDisplayQuaternion,
} from "@/features/camera/cameraIconMath";
import { resolveCameraLinkEnvelope } from "@/features/camera/cameraEnvelopeFit";
import {
  copyWorldMatrixToObjectLocal,
  createOverlayTransformScratch,
} from "@/features/camera/cameraOverlayTransform";

interface CameraIconsProps {
  camerasOverride?: readonly Camera[];
  robot: URDFRobot | null;
  gpuMode?: GPUMode;
}

export const CameraIcons = ({
  camerasOverride,
  robot,
  gpuMode = "high",
}: CameraIconsProps) => {
  const storeCameras = useCameraStore((state) => state.cameras);
  const cameras = camerasOverride ?? storeCameras;
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
  camera: Camera;
  robot: URDFRobot | null;
  isSelected: boolean;
  gpuMode?: GPUMode;
}

const CameraIcon = ({
  camera,
  robot,
  isSelected,
  gpuMode = "high",
}: CameraIconProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const envelopeRef = useRef<THREE.Group>(null);
  const envelopeMeshRef = useRef<THREE.Mesh>(null);
  const frustumRef = useRef<THREE.LineSegments>(null);
  const overlayTransformScratchRef = useRef(createOverlayTransformScratch());
  const cameraEnvelope = useMemo(
    () => resolveCameraLinkEnvelope(robot, camera.parent_joint),
    [robot, camera.parent_joint]
  );

  useFrame(() => {
    if (!groupRef.current) return;
    if (!robot) {
      if (envelopeRef.current) {
        envelopeRef.current.visible = false;
      }
      return;
    }
    const { position, quaternion } = getCameraWorldPose(robot, camera, {
      updateRobotWorld: true,
    });
    groupRef.current.position.copy(position);
    groupRef.current.quaternion.copy(
      toCameraIconDisplayQuaternion(quaternion),
    );

    if (!envelopeRef.current || !envelopeMeshRef.current) return;
    if (!cameraEnvelope) {
      envelopeRef.current.visible = false;
      return;
    }

    cameraEnvelope.linkObject.updateMatrixWorld(true);
    envelopeRef.current.visible = true;
    copyWorldMatrixToObjectLocal(
      envelopeRef.current,
      cameraEnvelope.linkObject.matrixWorld,
      overlayTransformScratchRef.current
    );
    envelopeMeshRef.current.position.copy(cameraEnvelope.localCenter);
    envelopeMeshRef.current.quaternion.copy(cameraEnvelope.localQuaternion);
    envelopeMeshRef.current.scale.copy(cameraEnvelope.localSize);
  });

  // Create frustum geometry
  const frustumGeometry = useMemo(
    () => createCameraIconFrustumGeometry(camera.intrinsics),
    [camera.intrinsics]
  );

  useEffect(() => () => frustumGeometry.dispose(), [frustumGeometry]);

  const cameraColor = isSelected ? "#00ff00" : "#ffaa00";

  return (
    <>
      <group ref={groupRef}>
        {/* Frustum in Three camera frame (-Z forward); group quaternion handles URDF->view conversion. */}
        <lineSegments
          ref={frustumRef}
          geometry={frustumGeometry}
          raycast={() => null}
        >
          <lineBasicMaterial
            color={cameraColor}
            linewidth={2}
            transparent
            opacity={isSelected ? 0.68 : 0.36}
            depthTest
            depthWrite={false}
          />
        </lineSegments>

        {/* Exact camera pose origin anchor */}
        <mesh position={[0, 0, 0]} raycast={() => null}>
          <sphereGeometry args={[CAMERA_ICON_ANCHOR_RADIUS_M, 8, 8]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.85}
            depthTest
            depthWrite={false}
          />
        </mesh>

        {/* Camera body */}
        <mesh position={CAMERA_ICON_BODY_OFFSET_M} raycast={() => null}>
          <boxGeometry args={CAMERA_ICON_BODY_SIZE_M} />
          <meshStandardMaterial
            color={cameraColor}
            transparent
            opacity={isSelected ? 0.9 : 0.6}
            emissive={isSelected ? cameraColor : "#000000"}
            emissiveIntensity={isSelected ? 0.5 : 0}
            depthTest
            depthWrite
          />
        </mesh>

        {/* Camera lens */}
        <mesh
          position={CAMERA_ICON_LENS_OFFSET_M}
          rotation={CAMERA_ICON_LENS_ROTATION_RAD}
          raycast={() => null}
        >
          <cylinderGeometry
            args={[
              CAMERA_ICON_LENS_RADIUS_M,
              CAMERA_ICON_LENS_RADIUS_M,
              CAMERA_ICON_LENS_LENGTH_M,
              16,
            ]}
          />
          <meshStandardMaterial
            color="#333333"
            transparent
            opacity={0.8}
            depthTest
            depthWrite
          />
        </mesh>
      </group>

      {cameraEnvelope ? (
        <group ref={envelopeRef} matrixAutoUpdate={false}>
          <mesh ref={envelopeMeshRef} raycast={() => null}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial
              color={CAMERA_ICON_ENVELOPE_COLOR}
              transparent
              opacity={CAMERA_ICON_ENVELOPE_OPACITY}
              wireframe
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      ) : null}
    </>
  );
};
