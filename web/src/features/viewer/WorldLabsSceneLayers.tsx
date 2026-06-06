import { Html } from "@react-three/drei";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { extend, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  findWorldColliderArtifact,
  findWorldSplatArtifact,
  useWorldSceneRuntimeStore,
} from "@/features/world-share/worldSceneRuntimeStore";

extend({ SparkRenderer, SplatMesh });

const ignoreRaycast: THREE.Object3D["raycast"] = () => undefined;

const readFiniteMetadataNumber = (
  metadata: Record<string, unknown>,
  key: string,
  fallback: number
): number => {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const fitPerspectiveCameraToWorldBounds = ({
  bounds,
  camera,
  controls,
  invalidate,
  focusCenter = null,
}: {
  bounds: THREE.Box3;
  camera: THREE.Camera;
  controls?: OrbitControlsImpl;
  invalidate: () => void;
  focusCenter?: THREE.Vector3 | null;
}) => {
  if (bounds.isEmpty() || !(camera instanceof THREE.PerspectiveCamera)) {
    return;
  }
  const center = focusCenter ?? bounds.getCenter(new THREE.Vector3());
  const sizeVector = bounds.getSize(new THREE.Vector3());
  const size = Math.max(sizeVector.length(), 1);
  const offset = new THREE.Vector3(
    THREE.MathUtils.clamp(size * 0.008, 0.8, 1.6),
    THREE.MathUtils.clamp(size * 0.012, 1.2, 2.1),
    THREE.MathUtils.clamp(size * 0.006, 0.7, 1.2)
  );
  camera.near = Math.max(0.01, size / 5000);
  camera.far = Math.max(1000, size * 25);
  camera.up.set(0, 0, 1);
  camera.position.copy(center).add(offset);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls?.target.copy(center);
  controls?.update();
  invalidate();
};

export const useWorldLabsPrimarySceneActive = () =>
  useWorldSceneRuntimeStore((state) => {
    const activePackage = state.activePackage;
    if (!activePackage) {
      return false;
    }
    return findWorldSplatArtifact(activePackage.artifacts) !== null;
  });

export const WorldLabsSplatLayer = () => {
  const activeWorldPackage = useWorldSceneRuntimeStore((state) => state.activePackage);
  const splatArtifact = useMemo(
    () => (activeWorldPackage ? findWorldSplatArtifact(activeWorldPackage.artifacts) : null),
    [activeWorldPackage]
  );
  const renderer = useThree((state) => state.gl);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sparkRef = useRef<SparkRenderer | null>(null);
  const splatRef = useRef<SplatMesh | null>(null);

  const splatScale = readFiniteMetadataNumber(
    activeWorldPackage?.provenance ?? {},
    "splat_uniform_scale",
    5
  );
  const groundPlaneOffset = readFiniteMetadataNumber(
    activeWorldPackage?.provenance ?? {},
    "ground_plane_offset",
    0
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
      url: splatArtifact?.uri ?? "",
      lod: true,
    }),
    [splatArtifact?.uri]
  );

  useEffect(() => {
    setLoadError(null);
    if (!activeWorldPackage || !splatArtifact || !splatRef.current || !sparkRef.current) return;

    let cancelled = false;
    sparkRef.current.raycast = ignoreRaycast;
    splatRef.current.raycast = ignoreRaycast;

    void splatRef.current.initialized.catch((error) => {
      if (cancelled) {
        return;
      }
      setLoadError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorldPackage, splatArtifact]);

  if (!splatArtifact) return null;

  return (
    <>
      {createElement(
        "sparkRenderer",
        {
          ref: sparkRef,
          args: [sparkArgs],
          visible: true,
        },
        createElement(
          "group",
          {
            position: [0, groundPlaneOffset, 0],
            rotation: [0, 0, 0],
            scale: splatScale,
          },
          createElement("splatMesh", {
            ref: splatRef,
            args: [splatArgs],
          })
        )
      )}
      {loadError ? (
        <Html center position={[0, 0.8, 0]}>
          <div className="rounded-md border border-destructive/50 bg-background/95 px-2 py-1 text-[10px] text-destructive shadow">
            {`World Labs splat failed: ${loadError}`}
          </div>
        </Html>
      ) : null}
    </>
  );
};

export const WorldLabsEnvironmentLayer = () => {
  const activeWorldPackage = useWorldSceneRuntimeStore((state) => state.activePackage);
  const panoArtifact = useMemo(
    () =>
      activeWorldPackage?.artifacts.find(
        (artifact) => artifact.kind.includes("panorama") && artifact.uri.endsWith(".jpg")
      ) ?? null,
    [activeWorldPackage]
  );
  const { scene } = useThree();

  useEffect(() => {
    if (!panoArtifact) {
      return;
    }
    const loader = new THREE.TextureLoader();
    let disposed = false;
    let texture: THREE.Texture | null = null;
    loader.load(
      panoArtifact.uri,
      (loadedTexture) => {
        if (disposed) {
          loadedTexture.dispose();
          return;
        }
        texture = loadedTexture;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.environment = texture;
        scene.background = texture;
        scene.backgroundBlurriness = 0;
        scene.environmentRotation = new THREE.Euler(0, Math.PI / 2, 0);
        scene.backgroundRotation = new THREE.Euler(0, Math.PI / 2, 0);
        scene.environmentIntensity = 1;
        scene.backgroundIntensity = 1;
      },
      undefined,
      () => {
        // Keep the scene usable even if the panorama is absent.
      }
    );
    return () => {
      disposed = true;
      if (scene.environment === texture) {
        scene.environment = null;
      }
      if (scene.background === texture) {
        scene.background = null;
      }
      texture?.dispose();
    };
  }, [panoArtifact, scene]);

  return null;
};

export const WorldLabsColliderLayer = ({
  autoFit = true,
  visible = true,
}: {
  autoFit?: boolean;
  visible?: boolean;
}) => {
  const activeWorldPackage = useWorldSceneRuntimeStore((state) => state.activePackage);
  const colliderArtifact = useMemo(
    () => (activeWorldPackage ? findWorldColliderArtifact(activeWorldPackage.artifacts) : null),
    [activeWorldPackage]
  );
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls as OrbitControlsImpl | undefined);
  const invalidate = useThree((state) => state.invalidate);
  const [colliderScene, setColliderScene] = useState<THREE.Group | null>(null);
  const colliderScale = readFiniteMetadataNumber(
    activeWorldPackage?.provenance ?? {},
    "collider_glb_uniform_scale",
    5
  );
  const groundPlaneOffset = readFiniteMetadataNumber(
    activeWorldPackage?.provenance ?? {},
    "ground_plane_offset",
    0
  );

  useEffect(() => {
    if (!colliderArtifact) {
      setColliderScene(null);
      return;
    }
    const loader = new GLTFLoader();
    let disposed = false;
    loader.load(
      colliderArtifact.uri,
      (gltf) => {
        if (disposed) {
          return;
        }
        const clone = gltf.scene.clone(true);
        clone.position.set(0, groundPlaneOffset, 0);
        clone.scale.setScalar(colliderScale);
        clone.visible = visible;
        clone.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) {
            return;
          }
          child.castShadow = false;
          child.receiveShadow = false;
          child.renderOrder = 20;
          child.material = new THREE.MeshBasicMaterial({
            color: "#67e8f9",
            transparent: true,
            opacity: visible ? 0.08 : 0,
            wireframe: true,
            depthWrite: false,
          });
        });
        clone.updateMatrixWorld(true);
        setColliderScene(clone);
      },
      undefined,
      () => {
        setColliderScene(null);
      }
    );

    return () => {
      disposed = true;
      setColliderScene(null);
    };
  }, [colliderArtifact, colliderScale, groundPlaneOffset, visible]);

  useEffect(() => {
    if (!autoFit || !colliderScene) {
      return;
    }
    colliderScene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(colliderScene);
    fitPerspectiveCameraToWorldBounds({
      bounds,
      camera,
      controls,
      invalidate,
      focusCenter: new THREE.Vector3(0, 0, 0.7),
    });
    return undefined;
  }, [autoFit, camera, colliderScene, controls, invalidate]);

  if (!colliderArtifact || !colliderScene || !visible) {
    return null;
  }

  return <primitive object={colliderScene} />;
};
