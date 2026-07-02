import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { toThreeViewQuaternionFromStudioCamera } from "@/features/camera/cameraOrientationContract";
import { getCameraWorldPose } from "@/features/camera/cameraWorldPose";
import { createUrdfMeshLoadCallback } from "@/features/urdf/runtime/urdfMeshLoader";
import { createUrdfVisualMaterialApplyScheduler } from "@/features/urdf/runtime/materialApplyScheduler";
import { URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS } from "@/features/urdf/runtime/materialApplySchedulerParams";
import { useJointStore } from "@/shared/store/useJointStore";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { applyIntrinsicsToPerspectiveCamera, normalizeCameraIntrinsics } from "@/shared/lib/cameraIntrinsics";
import { ViewerFloorPlane, ViewerWorldGrid } from "@/features/viewer/ViewerSceneChrome";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";

type PreviewRobot = URDFRobot;

type CameraViewportPreviewProps = {
  cameraId: string | null;
  emptyStateMessage?: string;
  gpuMode?: GPUMode;
  meshFiles: MeshFiles;
  packageRoots?: PackageRootMap;
  urdfBasePath?: string;
  urdfContent: string | null;
};

const FLOAT_EPSILON = 1e-4;

const approxEqual = (a: number, b: number, eps = FLOAT_EPSILON) => Math.abs(a - b) <= eps;

const createDefaultPreviewMaterial = (gpuMode: GPUMode): THREE.Material =>
  gpuMode === "low"
    ? new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        transparent: false,
        opacity: 1,
      })
    : new THREE.MeshStandardMaterial({
        metalness: 0.3,
        roughness: 0.7,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        transparent: false,
        opacity: 1,
      });

const applyPreviewMaterial = (material: THREE.Material) => {
  material.side = THREE.DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.transparent = false;
  material.opacity = 1;
  material.needsUpdate = true;
};

const configurePreviewObject = (object: THREE.Object3D, gpuMode: GPUMode) => {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh;
    if (!maybeMesh.isMesh) return;
    const mesh = maybeMesh;
    if (!mesh.material) {
      mesh.material = createDefaultPreviewMaterial(gpuMode);
    } else if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => applyPreviewMaterial(material));
    } else {
      applyPreviewMaterial(mesh.material);
    }
    mesh.castShadow = gpuMode === "high";
    mesh.receiveShadow = gpuMode === "high";
  });
};

const createMeshFallback = (meshRef: string, reason: "missing" | "failed") => {
  const color = reason === "missing" ? 0xff6b6b : 0xff00ff;
  const group = new THREE.Group();
  group.name = `mesh-fallback:${meshRef}`;
  group.userData.meshRef = meshRef;
  group.userData.meshLoadIssue = reason;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.06, 0.06, 0.06)),
    new THREE.LineBasicMaterial({ color: 0x111111 })
  );
  group.add(body);
  group.add(edges);
  return group;
};

const computeSceneRadius = (robot: PreviewRobot | null, objects: CreatedObject[]) => {
  const combinedBox = new THREE.Box3().makeEmpty();
  if (robot) {
    const robotBox = new THREE.Box3().setFromObject(robot);
    if (!robotBox.isEmpty()) combinedBox.copy(robotBox);
  }
  objects.forEach((obj) => {
    const halfSize = obj.size.clone().multiplyScalar(0.5);
    const objBox = new THREE.Box3(
      obj.position.clone().sub(halfSize),
      obj.position.clone().add(halfSize)
    );
    if (combinedBox.isEmpty()) {
      combinedBox.copy(objBox);
    } else {
      combinedBox.union(objBox);
    }
  });
  if (combinedBox.isEmpty()) return null;
  const sphere = new THREE.Sphere();
  combinedBox.getBoundingSphere(sphere);
  return Number.isFinite(sphere.radius) ? sphere.radius : null;
};

const JointValueSync = ({ robot }: { robot: PreviewRobot | null }) => {
  const lastValuesRef = useRef<Record<string, number> | null>(null);
  useFrame(() => {
    if (!robot) return;
    const values = useJointStore.getState().jointValues;
    if (lastValuesRef.current === values) return;
    lastValuesRef.current = values;
    applyJointValues(robot, values);
    robot.updateMatrixWorld?.(true);
  });
  return null;
};

const RobotMountKeeper = ({
  groupRef,
  robot,
}: {
  groupRef: RefObject<THREE.Group | null>;
  robot: PreviewRobot | null;
}) => {
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    if (!robot) {
      if (group.children.length > 0) group.clear();
      return;
    }
    if (robot.parent !== group) {
      group.clear();
      group.add(robot);
    }
  });
  return null;
};

const PreviewObjects = ({ objects, gpuMode }: { objects: CreatedObject[]; gpuMode: GPUMode }) => (
  <group>
    {objects.map((obj) => {
      const fillColor = obj.isIkTarget ? "#facc15" : obj.color || "#3b82f6";
      const outlineColor = obj.isIkTarget ? "#facc15" : "#bfbfbf";
      const radius =
        obj.type === "point" ? 0.035 : Math.max(obj.size.x, obj.size.y, obj.size.z) * 0.5;
      return (
        <group key={obj.id} position={[obj.position.x, obj.position.y, obj.position.z]}>
          {obj.type === "point" ? (
            <>
              <mesh>
                <sphereGeometry args={[radius, 14, 10]} />
                {gpuMode === "low" ? (
                  <meshBasicMaterial color={fillColor} opacity={0.85} transparent depthTest depthWrite />
                ) : (
                  <meshStandardMaterial color={fillColor} opacity={0.85} transparent depthTest depthWrite />
                )}
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.SphereGeometry(radius, 12, 8)]} />
                <lineBasicMaterial color={outlineColor} depthTest depthWrite={false} />
              </lineSegments>
            </>
          ) : (
            <>
              <mesh>
                <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                {gpuMode === "low" ? (
                  <meshBasicMaterial color={fillColor} opacity={0.65} transparent depthTest depthWrite />
                ) : (
                  <meshStandardMaterial color={fillColor} opacity={0.65} transparent depthTest depthWrite />
                )}
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(obj.size.x, obj.size.y, obj.size.z)]} />
                <lineBasicMaterial color={outlineColor} depthTest depthWrite={false} />
              </lineSegments>
            </>
          )}
        </group>
      );
    })}
  </group>
);

const CameraPoseController = ({
  cameraId,
  robot,
  sceneRadius,
}: {
  cameraId: string | null;
  robot: PreviewRobot | null;
  sceneRadius: number | null;
}) => {
  const cameras = useCameraStore((state) => state.cameras);
  const cameraConfig = useMemo(() => {
    if (!cameraId) return cameras[0] ?? null;
    return cameras.find((camera) => camera.id === cameraId) ?? null;
  }, [cameraId, cameras]);
  const previewCamera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const viewportSize = useThree((state) => state.size);

  useEffect(() => {
    if (!previewCamera || !cameraConfig) return;
    const normalizedIntrinsics = normalizeCameraIntrinsics(cameraConfig.intrinsics);
    const near = sceneRadius ? Math.max(0.01, sceneRadius * 0.02) : 0.05;
    const far = sceneRadius ? Math.max(near * 10, sceneRadius * 6) : 50;
    applyIntrinsicsToPerspectiveCamera(previewCamera, normalizedIntrinsics, near, far);
  }, [cameraConfig, previewCamera, sceneRadius, viewportSize.height, viewportSize.width]);

  useFrame(() => {
    if (!cameraConfig) return;
    const { position, quaternion } = getCameraWorldPose(robot, cameraConfig, {
      updateRobotWorld: true,
    });
    previewCamera.position.copy(position);
    previewCamera.quaternion.copy(toThreeViewQuaternionFromStudioCamera(quaternion));
    previewCamera.updateMatrixWorld();
  });

  return null;
};

export const CameraViewportPreview = ({
  cameraId,
  emptyStateMessage = "No cameras available.",
  gpuMode = "low",
  meshFiles,
  packageRoots,
  urdfBasePath,
  urdfContent,
}: CameraViewportPreviewProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const objects = useObjectStore((state) => state.objects);
  const cameraConfig = useMemo(() => {
    if (!cameraId) return cameras[0] ?? null;
    return cameras.find((camera) => camera.id === cameraId) ?? null;
  }, [cameraId, cameras]);
  const normalizedIntrinsics = useMemo(
    () => (cameraConfig ? normalizeCameraIntrinsics(cameraConfig.intrinsics) : null),
    [cameraConfig]
  );
  const groupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<PreviewRobot | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [robot, setRobot] = useState<PreviewRobot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [sceneRadius, setSceneRadius] = useState<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const aspect = useMemo(() => {
    if (!normalizedIntrinsics) return 16 / 9;
    const { width, height } = normalizedIntrinsics;
    return width && height ? width / height : 16 / 9;
  }, [normalizedIntrinsics]);
  const frameStyle = useMemo(() => {
    const viewportWidth = viewportSize.width;
    const viewportHeight = viewportSize.height;
    if (
      viewportWidth <= 0 ||
      viewportHeight <= 0 ||
      !Number.isFinite(aspect) ||
      aspect <= 0
    ) {
      return {
        height: "100%",
        width: "100%",
      } as const;
    }

    const viewportAspect = viewportWidth / viewportHeight;
    if (aspect >= viewportAspect) {
      const width = Math.floor(viewportWidth);
      const height = Math.floor(width / aspect);
      return {
        height: `${Math.max(1, height)}px`,
        maxHeight: "100%",
        maxWidth: "100%",
        width: `${Math.max(1, width)}px`,
      } as const;
    }

    const height = Math.floor(viewportHeight);
    const width = Math.floor(height * aspect);
    return {
      height: `${Math.max(1, height)}px`,
      maxHeight: "100%",
      maxWidth: "100%",
      width: `${Math.max(1, width)}px`,
    } as const;
  }, [aspect, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      const width = Math.max(0, rect.width);
      const height = Math.max(0, rect.height);
      setViewportSize((previousSize) =>
        Math.abs(previousSize.width - width) < 0.5 &&
        Math.abs(previousSize.height - height) < 0.5
          ? previousSize
          : { width, height }
      );
    };

    updateViewportSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLoadingError(null);
    setSceneRadius(null);
    setRobot(null);
    robotRef.current = null;
    if (!urdfContent || !cameraConfig) return;

    const abortController = new AbortController();
    const loader = new URDFLoader();
    const materialApplyScheduler = createUrdfVisualMaterialApplyScheduler({
      shouldApply: (root) => !abortController.signal.aborted && robotRef.current === root,
    });
    loader.loadMeshCb = createUrdfMeshLoadCallback({
      meshFiles,
      urdfBasePath,
      packageRoots,
      gpuMode,
      signal: abortController.signal,
      onLoaded: (object) => {
        configurePreviewObject(object, gpuMode);
        materialApplyScheduler.schedule(robotRef.current);
      },
      onMissing: (path) => createMeshFallback(path, "missing"),
      onError: (path) => createMeshFallback(path, "failed"),
    });

    try {
      const parsedRobot = loader.parse(urdfContent) as PreviewRobot;
      parsedRobot.scale.setScalar(1);
      configurePreviewObject(parsedRobot, gpuMode);
      robotRef.current = parsedRobot;
      setRobot(parsedRobot);
      materialApplyScheduler.flush(parsedRobot);
      window.setTimeout(() => {
        if (!abortController.signal.aborted) materialApplyScheduler.flush(parsedRobot);
      }, URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS);
    } catch (error) {
      robotRef.current = null;
      setRobot(null);
      setLoadingError(error instanceof Error ? error.message : "Failed to parse URDF.");
    }

    return () => {
      materialApplyScheduler.cancel();
      abortController.abort();
    };
  }, [cameraConfig, gpuMode, meshFiles, packageRoots, urdfBasePath, urdfContent]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;
    const refresh = () => {
      if (cancelled) return;
      const nextRadius = computeSceneRadius(robot, objects);
      setSceneRadius((previousRadius) => {
        if (previousRadius === nextRadius) return previousRadius;
        if (previousRadius === null || nextRadius === null) return nextRadius;
        return approxEqual(previousRadius, nextRadius) ? previousRadius : nextRadius;
      });
    };
    refresh();
    if (robot) {
      let attempts = 0;
      intervalId = window.setInterval(() => {
        refresh();
        attempts += 1;
        if (attempts >= 12 && typeof intervalId === "number") {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      }, 250);
    }
    return () => {
      cancelled = true;
      if (typeof intervalId === "number") window.clearInterval(intervalId);
    };
  }, [objects, robot]);

  if (!cameraConfig) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border border-border/50 bg-[#0b0b0b] text-[11px] text-muted-foreground">
        {emptyStateMessage}
      </div>
    );
  }

  if (!urdfContent) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border border-border/50 bg-[#0b0b0b] text-[11px] text-muted-foreground">
        Load a URDF to view cameras.
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="h-full w-full rounded-md border border-border/50 bg-[#0b0b0b] p-3 text-[11px] text-destructive">
        {loadingError}
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full min-h-0 min-w-0 overflow-hidden rounded-md border border-border/50"
      style={{
        backgroundColor: "#111111",
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 1px, transparent 1px, transparent 8px)",
      }}
    >
      <div className="flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
        <div
          className="relative max-h-full max-w-full shrink-0 overflow-hidden border border-black/80 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]"
          style={frameStyle}
        >
          <Canvas
            key={cameraConfig.id}
            camera={{
              position: [0, 0, 2],
              fov: normalizedIntrinsics?.fov_deg ?? cameraConfig.intrinsics.fov_deg,
              aspect,
              near: 0.05,
              far: sceneRadius ? Math.max(2, sceneRadius * 6) : 50,
            }}
            dpr={gpuMode === "low" ? [1, 1.25] : [1, 2]}
            frameloop="always"
            gl={{
              antialias: false,
              depth: true,
              powerPreference: gpuMode === "low" ? "low-power" : "high-performance",
              stencil: false,
            }}
            style={{ height: "100%", width: "100%" }}
            onCreated={({ camera, gl, scene }) => {
              scene.up.set(0, 0, 1);
              camera.up.set(0, 0, 1);
              const context = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
              context.disable(context.CULL_FACE);
            }}
          >
            <hemisphereLight args={["#dbeafe", "#0f172a", 0.55]} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 5, 5]} intensity={0.8} />
            <directionalLight position={[-5, 5, -5]} intensity={0.4} />
            <ViewerWorldGrid gpuMode={gpuMode} />
            <ViewerFloorPlane gpuMode={gpuMode} />
            <group ref={groupRef} />
            <PreviewObjects objects={objects} gpuMode={gpuMode} />
            <JointValueSync robot={robot} />
            <RobotMountKeeper groupRef={groupRef} robot={robot} />
            <CameraPoseController
              cameraId={cameraConfig.id}
              robot={robot}
              sceneRadius={sceneRadius}
            />
          </Canvas>
        </div>
      </div>
    </div>
  );
};
