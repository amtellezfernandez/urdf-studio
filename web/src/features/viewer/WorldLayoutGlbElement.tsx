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
    setScene(null);
    setLoadError(null);
    onBoundsChange(config.asset.id, null);

    loader.load(
      config.asset.url,
      (gltf) => {
        if (disposed) return;
        const visual = createWorldLayoutElementVisual(gltf.scene, config.asset);
        const metricScale = resolveWorldLayoutElementScale(
          config.asset.realWorldHeightM,
          visual.size.y
        );
        const wrapper = new THREE.Group();
        wrapper.name = config.asset.name;
        wrapper.position.set(...config.position);
        wrapper.rotation.set(...config.rotation);
        wrapper.scale.set(
          metricScale * config.scale[0],
          metricScale * config.scale[1],
          metricScale * config.scale[2]
        );
        wrapper.add(visual.scene);
        wrapper.userData.worldLayoutElementId = config.asset.id;
        wrapper.userData.worldLayoutElementMetadata = config.asset.metadataUrl ?? null;
        wrapper.updateMatrixWorld(true);
        onBoundsChange(config.asset.id, new THREE.Box3().setFromObject(wrapper));
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
    };
  }, [config, onBoundsChange]);

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
