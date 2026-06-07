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
import { useGenesisWorldLiveStateStore } from "@/features/world-share/genesisWorldLiveStateStore";

type WorldLayoutGlbElementProps = {
  config: WorldLayoutElementConfig;
  isSelected: boolean;
  onBoundsChange: (id: string, bounds: THREE.Box3 | null) => void;
  onHoverChange: (id: string | null) => void;
  onSelect: (id: string) => void;
};

export const WorldLayoutGlbElement = ({
  config,
  isSelected,
  onBoundsChange,
  onHoverChange,
  onSelect,
}: WorldLayoutGlbElementProps) => {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const livePose = useGenesisWorldLiveStateStore(
    (state) => state.posesByElementId[config.asset.id] ?? null
  );
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
        wrapper.scale.set(
          metricScale * config.scale[0],
          metricScale * config.scale[1],
          metricScale * config.scale[2]
        );
        wrapper.add(visual.scene);
        wrapper.userData.worldLayoutElementId = config.asset.id;
        wrapper.userData.worldLayoutElementMetadata = config.asset.metadataUrl ?? null;
        wrapper.userData.worldLayoutElementMetricScale = metricScale;
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
      instanceMaterials.forEach((material) => material.dispose());
    };
  }, [
    config.asset.id,
    config.asset.metadataUrl,
    config.asset.name,
    config.asset.realWorldHeightM,
    config.asset.url,
    config.materialColor,
    onBoundsChange,
  ]);

  useEffect(() => {
    if (!scene) return;
    const metricScale =
      typeof scene.userData.worldLayoutElementMetricScale === "number"
        ? scene.userData.worldLayoutElementMetricScale
        : 1;
    scene.scale.set(
      metricScale * config.scale[0],
      metricScale * config.scale[1],
      metricScale * config.scale[2]
    );
    if (livePose) {
      scene.position.set(...livePose.position);
      scene.quaternion.set(
        livePose.orientationWxyz[1],
        livePose.orientationWxyz[2],
        livePose.orientationWxyz[3],
        livePose.orientationWxyz[0]
      );
    } else {
      scene.position.set(...config.position);
      scene.rotation.set(...config.rotation);
    }
    scene.updateMatrixWorld(true);
    onBoundsChange(config.asset.id, new THREE.Box3().setFromObject(scene));
  }, [
    config.asset.id,
    config.position,
    config.rotation,
    config.scale,
    livePose,
    onBoundsChange,
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
