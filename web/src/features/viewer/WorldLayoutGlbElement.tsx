import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createWorldLayoutElementVisual,
  resolveWorldLayoutElementScale,
  setWorldLayoutElementHighlighted,
} from "@/features/viewer/worldLayoutElementRuntime";
import type { WorldLayoutElementConfig } from "@/features/viewer/worldLayoutEnvironmentConfig";

export type WorldLayoutElementPoseOverride = {
  position: [number, number, number];
  rotation?: [number, number, number];
};

export type WorldLayoutElementBoundsSnapshot = {
  bounds: THREE.Box3;
  physicsCenterXyz: [number, number, number];
  physicsRotationRpyRad: [number, number, number];
  physicsSizeXyz: [number, number, number];
  visualOriginXyz: [number, number, number];
};

type WorldLayoutGlbElementProps = {
  config: WorldLayoutElementConfig;
  isSelected: boolean;
  poseOverride?: WorldLayoutElementPoseOverride;
  onBoundsChange: (
    id: string,
    snapshot: WorldLayoutElementBoundsSnapshot | null
  ) => void;
  onHoverChange: (id: string | null) => void;
  onSelect: (id: string) => void;
};

const toTuple = (value: THREE.Vector3): [number, number, number] => [
  value.x,
  value.y,
  value.z,
];

const buildBoundsSnapshot = (
  wrapper: THREE.Group,
  physicsSizeXyz: [number, number, number]
): WorldLayoutElementBoundsSnapshot | null => {
  wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper);
  if (bounds.isEmpty()) return null;
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return {
    bounds,
    physicsCenterXyz: toTuple(center),
    physicsRotationRpyRad: [
      wrapper.rotation.x,
      wrapper.rotation.y,
      wrapper.rotation.z,
    ],
    physicsSizeXyz,
    visualOriginXyz: [
      wrapper.position.x,
      wrapper.position.y,
      wrapper.position.z,
    ],
  };
};

export const WorldLayoutGlbElement = ({
  config,
  isSelected,
  poseOverride,
  onBoundsChange,
  onHoverChange,
  onSelect,
}: WorldLayoutGlbElementProps) => {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [physicsSizeXyz, setPhysicsSizeXyz] = useState<
    [number, number, number] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#ffffff",
        emissiveIntensity: 0.22,
        metalness: 0.05,
        roughness: 0.42,
      }),
    []
  );

  useEffect(() => () => selectedMaterial.dispose(), [selectedMaterial]);

  useEffect(() => {
    if (!scene) return;
    setWorldLayoutElementHighlighted(scene, isSelected, selectedMaterial);
    return () => {
      setWorldLayoutElementHighlighted(scene, false, selectedMaterial);
    };
  }, [isSelected, scene, selectedMaterial]);

  useEffect(() => {
    const loader = new GLTFLoader();
    let disposed = false;
    const instanceMaterials: THREE.Material[] = [];
    setScene(null);
    setLoadError(null);
    onBoundsChange(config.asset.id, null);

    loader.load(
      config.asset.url,
      (gltf) => {
        if (disposed) return;
        const visual = createWorldLayoutElementVisual(gltf.scene, config.asset);
        if (config.materialColor) {
          visual.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const material = new THREE.MeshStandardMaterial({
              color: config.materialColor,
              emissive: config.materialColor,
              emissiveIntensity: 0.24,
              metalness: 0.05,
              roughness: 0.38,
            });
            child.material = material;
            instanceMaterials.push(material);
          });
        }
        const metricScale = resolveWorldLayoutElementScale(
          config.asset.realWorldHeightM,
          visual.size.y
        );
        const wrapper = new THREE.Group();
        wrapper.name = config.asset.name;
        wrapper.position.set(...config.position);
        wrapper.rotation.set(...config.rotation);
        const wrapperScale: [number, number, number] = [
          metricScale * config.scale[0],
          metricScale * config.scale[1],
          metricScale * config.scale[2],
        ];
        wrapper.scale.set(...wrapperScale);
        wrapper.add(visual.scene);
        wrapper.userData.worldLayoutElementId = config.asset.id;
        wrapper.userData.worldLayoutElementMetadata = config.asset.metadataUrl ?? null;
        const nextPhysicsSizeXyz: [number, number, number] = [
          visual.size.x * wrapperScale[0],
          visual.size.y * wrapperScale[1],
          visual.size.z * wrapperScale[2],
        ];
        const snapshot = buildBoundsSnapshot(wrapper, nextPhysicsSizeXyz);
        onBoundsChange(config.asset.id, snapshot);
        setPhysicsSizeXyz(nextPhysicsSizeXyz);
        setScene(wrapper);
      },
      undefined,
      (error) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        onBoundsChange(config.asset.id, null);
      }
    );

    return () => {
      disposed = true;
      onBoundsChange(config.asset.id, null);
      setScene(null);
      setPhysicsSizeXyz(null);
      instanceMaterials.forEach((material) => material.dispose());
    };
  }, [config, onBoundsChange]);

  useEffect(() => {
    if (!scene || !physicsSizeXyz) return;
    scene.position.set(...(poseOverride?.position ?? config.position));
    scene.rotation.set(...(poseOverride?.rotation ?? config.rotation));
    const snapshot = buildBoundsSnapshot(scene, physicsSizeXyz);
    onBoundsChange(config.asset.id, snapshot);
  }, [
    config.asset.id,
    config.position,
    config.rotation,
    onBoundsChange,
    physicsSizeXyz,
    poseOverride,
    scene,
  ]);

  if (scene) {
    return (
      <primitive
        object={scene}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelect(config.asset.id);
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHoverChange(config.asset.id);
        }}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHoverChange(config.asset.id);
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHoverChange(null);
        }}
      />
    );
  }
  if (!loadError) return null;

  return (
    <Html center position={config.position}>
      <div className="rounded-md border border-destructive/50 bg-background/95 px-2 py-1 text-[10px] text-destructive shadow">
        {`${config.asset.name} failed: ${loadError}`}
      </div>
    </Html>
  );
};
