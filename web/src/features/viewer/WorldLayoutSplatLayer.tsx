import { Html } from "@react-three/drei";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extend, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  createWorldLayoutElementVisual,
  getInitialWorldLayoutElementPlacements,
  mapSimuGenYUpPositionToStudioXyFloor,
  resolveWorldLayoutElementScale,
  type WorldLayoutElementAsset,
  type WorldLayoutElementPlacement,
} from "@/features/viewer/worldLayoutElementRuntime";
import { useWorldLayoutEnvironmentStore } from "@/features/world-share/worldLayoutEnvironmentStore";

extend({ SparkRenderer, SplatMesh });

type WorldLayoutSplatConfig = {
  uri: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

type WorldLayoutElementConfig = {
  asset: WorldLayoutElementAsset;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

type CameraControlsLike = {
  target?: THREE.Vector3;
  update?: () => void;
};

const SIMU_GEN_Y_UP_TO_STUDIO_XY_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readVector3 = (
  value: unknown,
  fallback: [number, number, number]
): [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((component) => typeof component === "number" && Number.isFinite(component))
    ? [value[0], value[1], value[2]]
    : fallback;

const readFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const readPositiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const readNonEmptyString = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const readScaleVector = (value: unknown, scalarValue: unknown): [number, number, number] => {
  const vector = readVector3(value, [Number.NaN, Number.NaN, Number.NaN]);
  if (vector.every((component) => Number.isFinite(component) && component > 0)) {
    return vector;
  }
  const scalar = readFiniteNumber(scalarValue, 1);
  return scalar > 0 ? [scalar, scalar, scalar] : [1, 1, 1];
};

const readWorldLayoutSplatConfig = (
  environment: Record<string, unknown> | null
): WorldLayoutSplatConfig | null => {
  if (!environment) return null;
  const visual = isRecord(environment.visual) ? environment.visual : null;
  if (!visual || visual.kind !== "splat" || typeof visual.uri !== "string") return null;
  const uri = visual.uri.trim();
  if (!uri) return null;
  return {
    uri,
    position: readVector3(visual.position_xyz, [0, 0, 0]),
    rotation: readVector3(visual.rotation_rpy_rad, [0, 0, 0]),
    scale: readFiniteNumber(visual.scale, 1),
  };
};

const readWorldLayoutElementConfigs = (
  environment: Record<string, unknown> | null
): WorldLayoutElementConfig[] => {
  if (!environment || !Array.isArray(environment.elements)) return [];
  const rawEntries = environment.elements.filter(isRecord);
  const assets: WorldLayoutElementAsset[] = rawEntries.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const uri = readNonEmptyString(entry.uri);
    if (!uri) return [];
    const id = readNonEmptyString(entry.id, `world-layout-element-${index}`);
    const realWorldHeightM = readPositiveNumber(entry.real_world_height_m);
    const realWorldFootprintM = readPositiveNumber(entry.real_world_footprint_m);
    const realWorldMassKg = readPositiveNumber(entry.real_world_mass_kg);
    return [{
      id,
      assetId: id,
      sourceWorldSlug: readNonEmptyString(environment.preset, "world-layout"),
      baseObjectId: id,
      name: readNonEmptyString(entry.name, id),
      url: uri,
      ...(readNonEmptyString(entry.metadata) ? { metadataUrl: readNonEmptyString(entry.metadata) } : {}),
      ...(realWorldHeightM !== null ? { realWorldHeightM } : {}),
      ...(realWorldFootprintM !== null ? { realWorldFootprintM } : {}),
      ...(realWorldMassKg !== null ? { realWorldMassKg } : {}),
    }];
  });
  const placements = getInitialWorldLayoutElementPlacements(assets);
  const placementByObjectId = new Map<string, WorldLayoutElementPlacement>(
    placements.map((placement) => [placement.objectId, placement])
  );

  return rawEntries.flatMap((entry, index) => {
    const asset = assets[index];
    if (!asset) return [];
    const placement = placementByObjectId.get(asset.id);
    if (!placement) return [];
    const explicitPosition = Array.isArray(entry.position_xyz)
      ? readVector3(entry.position_xyz, [0, 0, 0])
      : null;
    const explicitRotation = Array.isArray(entry.rotation_rpy_rad)
      ? readVector3(entry.rotation_rpy_rad, [0, 0, 0])
      : null;
    return [{
      asset,
      position: explicitPosition ?? mapSimuGenYUpPositionToStudioXyFloor(placement.position),
      rotation: explicitRotation ?? SIMU_GEN_Y_UP_TO_STUDIO_XY_ROTATION,
      scale:
        entry.scale_xyz !== undefined || entry.scale !== undefined
          ? readScaleVector(entry.scale_xyz, entry.scale)
          : placement.scale,
    }];
  });
};

const fitCameraToBounds = ({
  bounds,
  camera,
  controls,
  invalidate,
}: {
  bounds: THREE.Box3;
  camera: THREE.Camera;
  controls?: CameraControlsLike;
  invalidate: () => void;
}) => {
  if (bounds.isEmpty() || !(camera instanceof THREE.PerspectiveCamera)) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const distance = Math.max(radius * 2.2, 4);
  const direction = new THREE.Vector3(0.75, -0.9, 0.45).normalize();

  camera.near = Math.max(0.01, radius / 1000);
  camera.far = Math.max(1000, radius * 20);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls?.target?.copy(center);
  controls?.update?.();
  invalidate();
};

const WorldLayoutGlbElement = ({
  config,
  onBoundsChange,
}: {
  config: WorldLayoutElementConfig;
  onBoundsChange: (id: string, bounds: THREE.Box3 | null) => void;
}) => {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (scene) return <primitive object={scene} />;
  if (!loadError) return null;

  return (
    <Html center position={config.position}>
      <div className="rounded-md border border-destructive/50 bg-background/95 px-2 py-1 text-[10px] text-destructive shadow">
        {`${config.asset.name} failed: ${loadError}`}
      </div>
    </Html>
  );
};

export const WorldLayoutSplatLayer = () => {
  const environment = useWorldLayoutEnvironmentStore((state) => state.environment);
  const config = useMemo(() => readWorldLayoutSplatConfig(environment), [environment]);
  const elements = useMemo(() => readWorldLayoutElementConfigs(environment), [environment]);
  const renderer = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls as CameraControlsLike | undefined);
  const invalidate = useThree((state) => state.invalidate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [splatInstance, setSplatInstance] = useState<SplatMesh | null>(null);
  const elementBoundsRef = useRef(new Map<string, THREE.Box3>());
  const autoFitKeyRef = useRef<string | null>(null);
  const [boundsVersion, setBoundsVersion] = useState(0);
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
  }, [boundsVersion, camera, controls, elements, invalidate]);

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
          onBoundsChange={handleElementBoundsChange}
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
