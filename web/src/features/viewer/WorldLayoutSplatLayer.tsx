import { Html } from "@react-three/drei";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extend, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { WorldLayoutGlbElement } from "@/features/viewer/WorldLayoutGlbElement";
import {
  fitCameraToBounds,
  type CameraControlsLike,
} from "@/features/viewer/worldLayoutCamera";
import {
  readWorldLayoutElementConfigs,
  readWorldLayoutSplatConfig,
} from "@/features/viewer/worldLayoutEnvironmentConfig";
import { useWorldLayoutEnvironmentStore } from "@/features/world-share/worldLayoutEnvironmentStore";

extend({ SparkRenderer, SplatMesh });

type WorldLayoutSplatLayerProps = {
  autoFitElements?: boolean;
  interactiveElements?: boolean;
  renderElements?: boolean;
  renderSplat?: boolean;
};

export const WorldLayoutSplatLayer = ({
  autoFitElements = true,
  interactiveElements = true,
  renderElements = true,
  renderSplat = true,
}: WorldLayoutSplatLayerProps = {}) => {
  const environment = useWorldLayoutEnvironmentStore((state) => state.environment);
  const splatConfig = useMemo(() => readWorldLayoutSplatConfig(environment), [environment]);
  const config = renderSplat ? splatConfig : null;
  const shouldReadElements = renderElements || autoFitElements;
  const elements = useMemo(
    () => (shouldReadElements ? readWorldLayoutElementConfigs(environment) : []),
    [environment, shouldReadElements]
  );
  const renderer = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls as CameraControlsLike | undefined);
  const invalidate = useThree((state) => state.invalidate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [splatInstance, setSplatInstance] = useState<SplatMesh | null>(null);
  const [boundsVersion, setBoundsVersion] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const elementBoundsRef = useRef(new Map<string, THREE.Box3>());
  const autoFitKeyRef = useRef<string | null>(null);

  const handleSplatRef = useCallback((instance: SplatMesh | null) => {
    setSplatInstance(instance);
  }, []);

  const handleElementBoundsChange = useCallback(
    (id: string, bounds: THREE.Box3 | null) => {
      if (bounds?.isEmpty() === false) {
        elementBoundsRef.current.set(id, bounds.clone());
      } else {
        elementBoundsRef.current.delete(id);
      }
      setBoundsVersion((version) => version + 1);
    },
    []
  );

  const handleElementSelect = useCallback((id: string) => {
    if (!interactiveElements) return;
    setSelectedElementId((current) => (current === id ? null : id));
  }, [interactiveElements]);

  const handleElementHoverChange = useCallback(
    (id: string | null) => {
      if (!interactiveElements) return;
      setHoveredElementId(id);
    },
    [interactiveElements]
  );

  const sparkArgs = useMemo(
    () => ({
      renderer,
      enableLod: true,
      lodRenderScale: 2,
      encodeLinear: false,
    }),
    [renderer]
  );
  const splatArgs = useMemo(
    () => ({
      url: config?.uri ?? "",
      lod: true,
    }),
    [config?.uri]
  );

  useEffect(() => {
    setLoadError(null);
    if (!splatInstance) return;
    let cancelled = false;
    void splatInstance.initialized.catch((error) => {
      if (cancelled) return;
      setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [splatInstance]);

  useEffect(() => {
    if (!interactiveElements) return;
    const canvas = renderer.domElement;
    if (!canvas) return;
    if (hoveredElementId) {
      canvas.style.cursor = "pointer";
    }
    return () => {
      if (hoveredElementId) {
        canvas.style.cursor = "";
      }
    };
  }, [hoveredElementId, interactiveElements, renderer]);

  useEffect(() => {
    if (!selectedElementId) return;
    if (elements.some((element) => element.asset.id === selectedElementId)) return;
    setSelectedElementId(null);
  }, [elements, selectedElementId]);

  useEffect(() => {
    if (!autoFitElements) return;
    if (elements.length === 0) {
      elementBoundsRef.current.clear();
      autoFitKeyRef.current = null;
      return;
    }
    if (elementBoundsRef.current.size < elements.length) return;
    const fitKey = elements
      .map((element) => `${element.asset.id}:${element.asset.url}`)
      .sort()
      .join("|");
    if (autoFitKeyRef.current === fitKey) return;
    const bounds = new THREE.Box3();
    elementBoundsRef.current.forEach((elementBounds) => bounds.union(elementBounds));
    if (bounds.isEmpty()) return;
    fitCameraToBounds({ bounds, camera, controls, invalidate });
    autoFitKeyRef.current = fitKey;
  }, [autoFitElements, boundsVersion, camera, controls, elements, invalidate]);

  if (!config && elements.length === 0) return null;

  return (
    <>
      {config
        ? createElement(
            "sparkRenderer",
            {
              key: `spark-${config.uri}`,
              args: [sparkArgs],
              visible: true,
            },
            createElement(
              "group",
              {
                position: config.position,
                rotation: config.rotation,
                scale: config.scale,
              },
              createElement("splatMesh", {
                ref: handleSplatRef,
                args: [splatArgs],
              })
            )
          )
        : null}
      {elements.map((element) => (
        <WorldLayoutGlbElement
          key={`${element.asset.id}:${element.asset.url}`}
          config={element}
          isSelected={interactiveElements && selectedElementId === element.asset.id}
          onBoundsChange={handleElementBoundsChange}
          onHoverChange={handleElementHoverChange}
          onSelect={handleElementSelect}
        />
      ))}
      {loadError ? (
        <Html center position={[0, 1, 0]}>
          <div className="rounded-md border border-destructive/50 bg-background/95 px-2 py-1 text-[10px] text-destructive shadow">
            {`World splat failed: ${loadError}`}
          </div>
        </Html>
      ) : null}
    </>
  );
};
