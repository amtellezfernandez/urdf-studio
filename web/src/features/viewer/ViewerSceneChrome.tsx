import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import {
  VIEWER_SCENE_FLOOR_PARAMS,
  VIEWER_SCENE_GRID_PARAMS,
} from "@/features/viewer/viewerSceneChromeParams";

type ViewerSceneChromeProps = {
  gpuMode?: GPUMode;
};

export const ViewerWorldGrid = ({ gpuMode = "high" }: ViewerSceneChromeProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const gridRef = useRef<THREE.GridHelper>(null);
  const camera = useThree((state) => state.camera);
  const span =
    gpuMode === "low"
      ? VIEWER_SCENE_GRID_PARAMS.lowSpanMeters
      : VIEWER_SCENE_GRID_PARAMS.highSpanMeters;
  const divisions =
    gpuMode === "low"
      ? VIEWER_SCENE_GRID_PARAMS.lowDivisions
      : VIEWER_SCENE_GRID_PARAMS.highDivisions;
  const opacity =
    gpuMode === "low"
      ? VIEWER_SCENE_GRID_PARAMS.lowOpacity
      : VIEWER_SCENE_GRID_PARAMS.highOpacity;

  useEffect(() => {
    const helper = gridRef.current;
    if (!helper) return;
    const material = helper.material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((mat) => {
      mat.transparent = true;
      mat.opacity = opacity;
      mat.depthWrite = false;
    });
  }, [opacity]);

  useFrame(() => {
    if (!groupRef.current) return;
    const x =
      Math.round(camera.position.x / VIEWER_SCENE_GRID_PARAMS.snapStepMeters) *
      VIEWER_SCENE_GRID_PARAMS.snapStepMeters;
    const y =
      Math.round(camera.position.y / VIEWER_SCENE_GRID_PARAMS.snapStepMeters) *
      VIEWER_SCENE_GRID_PARAMS.snapStepMeters;
    groupRef.current.position.set(x, y, VIEWER_SCENE_GRID_PARAMS.planeZMeters);
  });

  return (
    <group ref={groupRef} renderOrder={VIEWER_SCENE_GRID_PARAMS.renderOrder}>
      <gridHelper
        ref={gridRef}
        args={[
          span,
          divisions,
          VIEWER_SCENE_GRID_PARAMS.majorLineColor,
          VIEWER_SCENE_GRID_PARAMS.minorLineColor,
        ]}
        rotation={[...VIEWER_SCENE_GRID_PARAMS.rotationRad]}
      />
    </group>
  );
};

export const ViewerFloorPlane = ({ gpuMode = "high" }: ViewerSceneChromeProps) => {
  const materialProps = {
    color: VIEWER_SCENE_FLOOR_PARAMS.color,
    opacity: VIEWER_SCENE_FLOOR_PARAMS.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  } as const;

  return (
    <mesh
      rotation={[...VIEWER_SCENE_FLOOR_PARAMS.rotationRad]}
      position={[...VIEWER_SCENE_FLOOR_PARAMS.position]}
      renderOrder={VIEWER_SCENE_FLOOR_PARAMS.renderOrder}
      receiveShadow={gpuMode === "high"}
    >
      <planeGeometry
        args={[
          VIEWER_SCENE_FLOOR_PARAMS.sizeMeters,
          VIEWER_SCENE_FLOOR_PARAMS.sizeMeters,
        ]}
      />
      {gpuMode === "low" ? (
        <meshBasicMaterial {...materialProps} />
      ) : (
        <meshStandardMaterial {...materialProps} />
      )}
    </mesh>
  );
};
