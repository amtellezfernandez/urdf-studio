import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useJointStore } from "@/shared/store/useJointStore";
import { useRobotPoseStore } from "@/shared/store/useRobotPoseStore";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import {
  applyIntrinsicsToPerspectiveCamera,
  normalizeCameraIntrinsics,
} from "@/shared/lib/cameraIntrinsics";
import { type PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";
import { toThreeViewQuaternionFromUrdf } from "./cameraOrientationContract";
import { getCameraWorldPose } from "./cameraWorldPose";
import { createUrdfMeshLoadCallback } from "@/features/urdf/runtime/urdfMeshLoader";
import { createUrdfVisualMaterialApplyScheduler } from "@/features/urdf/runtime/materialApplyScheduler";
import { URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS } from "@/features/urdf/runtime/materialApplySchedulerParams";
import { EPISODE_CAMERA_PREVIEW_PARAMS } from "@/features/camera/episodeCameraPreviewParams";
import { ViewerFloorPlane, ViewerWorldGrid } from "@/features/viewer/ViewerSceneChrome";
import {
  WorldLabsEnvironmentLayer,
  WorldLabsSplatLayer,
  useWorldLabsPrimarySceneActive,
} from "@/features/viewer/WorldLabsSceneLayers";
import {
  useOperatorPerceptionStore,
  type OperatorCameraVideoFrame,
} from "@/features/teleop/perception/operatorPerceptionStore";
import {
  OPERATOR_LIVE_CAMERA_GRID_TWO_COLUMN_MIN_COUNT,
  OPERATOR_LIVE_CAMERA_SINGLE_FRAME_COUNT,
} from "@/features/teleop/params/operatorTeleopParams";
import { applyRobotBasePose } from "@/features/viewer/viewer-helpers";
import {
  cloneRobotBasePose,
  hasMeaningfulRobotBasePoseDelta,
} from "@/shared/lib/robotBasePose";
import type { RobotBasePose } from "@/shared/types/feature";

type PreviewRobot = URDFRobot;

const FLOAT_EPS = EPISODE_CAMERA_PREVIEW_PARAMS.floatComparisonEpsilon;
const approxEqual = (a: number, b: number, eps = FLOAT_EPS) =>
  Math.abs(a - b) <= eps;

const computeSceneMetrics = (robot: PreviewRobot | null, objects: CreatedObject[]) => {
  const combinedBox = new THREE.Box3().makeEmpty();

  if (robot) {
    const robotBox = new THREE.Box3().setFromObject(robot);
    if (!robotBox.isEmpty()) {
      combinedBox.copy(robotBox);
    }
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

  if (combinedBox.isEmpty()) {
    return { sceneRadius: null as number | null };
  }

  const sphere = new THREE.Sphere();
  combinedBox.getBoundingSphere(sphere);
  const sceneRadius = Number.isFinite(sphere.radius) ? sphere.radius : null;

  return { sceneRadius };
};

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

const createMeshFallback = (
  meshRef: string,
  reason: "missing" | "failed"
) => {
  const color = reason === "missing" ? 0xff6b6b : 0xff00ff;
  const group = new THREE.Group();
  group.name = `mesh-fallback:${meshRef}`;
  group.userData.meshRef = meshRef;
  group.userData.meshLoadIssue = reason;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06),
    new THREE.MeshBasicMaterial({
      color,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.06, 0.06, 0.06)),
    new THREE.LineBasicMaterial({ color: 0x111111 })
  );
  group.add(body);
  group.add(edges);
  return group;
};

const PreviewObjects = ({
  objects,
  gpuMode = "high",
}: {
  objects: CreatedObject[];
  gpuMode?: GPUMode;
}) => {
  return (
    <group>
      {objects.filter((obj) => obj.isHidden !== true).map((obj) => {
        const baseColor = obj.color || "#3b82f6";
        const fillColor = obj.isIkTarget ? "#facc15" : baseColor;
        const outlineColor = obj.isIkTarget ? "#facc15" : "#bfbfbf";
        const radius =
          obj.type === "point"
            ? WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM * 0.5
            : Math.max(obj.size.x, obj.size.y, obj.size.z) * 0.5;

        return (
          <group
            key={obj.id}
            position={[obj.position.x, obj.position.y, obj.position.z]}
          >
            {obj.type === "point" ? (
              <>
                <mesh>
                  <sphereGeometry args={[radius, 14, 10]} />
                  {gpuMode === "low" ? (
                    <meshBasicMaterial
                      color={fillColor}
                      opacity={0.85}
                      transparent
                      depthTest
                      depthWrite
                    />
                  ) : (
                    <meshStandardMaterial
                      color={fillColor}
                      opacity={0.85}
                      transparent
                      depthTest
                      depthWrite
                      metalness={0.15}
                      roughness={0.6}
                      emissive={fillColor}
                      emissiveIntensity={0.08}
                    />
                  )}
                </mesh>
                <lineSegments>
                  <edgesGeometry args={[new THREE.SphereGeometry(radius, 12, 8)]} />
                  <lineBasicMaterial color={outlineColor} linewidth={1} depthTest depthWrite={false} />
                </lineSegments>
              </>
            ) : (
              <>
                <mesh>
                  <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                  {gpuMode === "low" ? (
                    <meshBasicMaterial
                      color={fillColor}
                      opacity={0.65}
                      transparent
                      depthTest
                      depthWrite
                    />
                  ) : (
                    <meshStandardMaterial
                      color={fillColor}
                      opacity={0.65}
                      transparent
                      depthTest
                      depthWrite
                      metalness={0.15}
                      roughness={0.6}
                      emissive={fillColor}
                      emissiveIntensity={0.05}
                    />
                  )}
                </mesh>

                <lineSegments>
                  <edgesGeometry args={[new THREE.BoxGeometry(obj.size.x, obj.size.y, obj.size.z)]} />
                  <lineBasicMaterial color={outlineColor} linewidth={1} depthTest depthWrite={false} />
                </lineSegments>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

const PreviewSceneChrome = ({ gpuMode = "high" }: { gpuMode?: GPUMode }) => (
  <>
    <ViewerWorldGrid gpuMode={gpuMode} />
    <ViewerFloorPlane gpuMode={gpuMode} />
  </>
);

const JointValueSync = ({ robot }: { robot: PreviewRobot | null }) => {
  const lastValuesRef = useRef<Record<string, number> | null>(null);

  useFrame(() => {
    if (!robot) return;
    const values = useJointStore.getState().jointValues;
    if (lastValuesRef.current === values) return;
    lastValuesRef.current = values;
    applyJointValues(robot, values);
    // Keep world matrices up to date so dependent helpers (e.g., camera pose) see movement
    robot.updateMatrixWorld?.(true);
  });
  return null;
};

const PREVIEW_BASE_POSE_TRANSLATION_EPSILON_METERS =
  EPISODE_CAMERA_PREVIEW_PARAMS.basePoseTranslationEpsilonMeters;
const PREVIEW_BASE_POSE_ROTATION_EPSILON_RAD =
  EPISODE_CAMERA_PREVIEW_PARAMS.basePoseRotationEpsilonRad;

const BasePoseSync = ({ robot }: { robot: PreviewRobot | null }) => {
  const lastAppliedPoseRef = useRef<RobotBasePose | null>(null);

  useFrame(() => {
    if (!robot) return;
    const livePose = useRobotPoseStore.getState().pose;
    if (!livePose) {
      if (lastAppliedPoseRef.current) {
        robot.position.set(0, 0, 0);
        robot.quaternion.identity();
        robot.updateMatrixWorld?.(true);
        lastAppliedPoseRef.current = null;
      }
      return;
    }

    if (
      lastAppliedPoseRef.current &&
      !hasMeaningfulRobotBasePoseDelta(
        lastAppliedPoseRef.current,
        livePose,
        PREVIEW_BASE_POSE_TRANSLATION_EPSILON_METERS,
        PREVIEW_BASE_POSE_ROTATION_EPSILON_RAD
      )
    ) {
      return;
    }

    if (applyRobotBasePose(robot, livePose)) {
      lastAppliedPoseRef.current = cloneRobotBasePose(livePose) ?? null;
    }
  }, -15);

  return null;
};

const RobotMountKeeper = ({
  robot,
  groupRef,
}: {
  robot: PreviewRobot | null;
  groupRef: RefObject<THREE.Group | null>;
}) => {
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    if (!robot) {
      if (group.children.length > 0) {
        group.clear();
      }
      return;
    }

    if (robot.parent !== group) {
      group.clear();
      group.add(robot);
    }
  });

  return null;
};

const CameraPoseController = ({
  robot,
  cameraId,
  sceneRadius,
}: {
  robot: PreviewRobot | null;
  cameraId: string | null;
  sceneRadius: number | null;
}) => {
  const cameras = useCameraStore((s) => s.cameras);
  const cameraConfig = useMemo(() => {
    if (!cameraId) return cameras[0] ?? null;
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [cameras, cameraId]);
  const previewCamera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const viewportSize = useThree((state) => state.size);

  // Sync projection with intrinsics and scene size
  useEffect(() => {
    if (!previewCamera || !cameraConfig) return;
    const normalizedIntrinsics = normalizeCameraIntrinsics(cameraConfig.intrinsics);
    const near = sceneRadius ? Math.max(0.01, sceneRadius * 0.02) : 0.05;
    const far = sceneRadius ? Math.max(near * 10, sceneRadius * 6) : 50;
    applyIntrinsicsToPerspectiveCamera(previewCamera, normalizedIntrinsics, near, far);
  }, [
    cameraConfig,
    previewCamera,
    sceneRadius,
    viewportSize.width,
    viewportSize.height,
  ]);

  useFrame(({ clock }) => {
    if (!cameraConfig) return;
    const { position, quaternion } = getCameraWorldPose(robot, cameraConfig, {
      updateRobotWorld: true,
    });
    // Preserve full camera orientation (including roll) to avoid top/down flip discontinuities.
    const finalQuat = toThreeViewQuaternionFromUrdf(quaternion);
    previewCamera.position.copy(position);
    previewCamera.quaternion.copy(finalQuat);
    previewCamera.updateMatrixWorld();
  });

  return null;
};

interface EpisodeCameraPreviewProps {
  urdfContent: string | null;
  meshFiles: MeshFiles;
  cameraId: string | null;
  urdfBasePath?: string;
  packageRoots?: PackageRootMap;
  gpuMode?: GPUMode;
  emptyStateMessage?: string;
  allowOperatorLiveCamera?: boolean;
}

const OperatorLiveCameraVideo = ({ frame }: { frame: OperatorCameraVideoFrame }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = frame.stream;
    void video.play();
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [frame.stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      aria-label={frame.label}
      className="h-full w-full bg-black object-cover"
    />
  );
};

const OperatorLiveCameraGrid = ({ frames }: { frames: OperatorCameraVideoFrame[] }) => {
  const useTwoColumns = frames.length >= OPERATOR_LIVE_CAMERA_GRID_TWO_COLUMN_MIN_COUNT;

  return (
    <div
      className="grid h-full w-full min-h-0 min-w-0 gap-2"
      style={{
        gridTemplateColumns: useTwoColumns
          ? "repeat(2, minmax(0, 1fr))"
          : "minmax(0, 1fr)",
      }}
    >
      {frames.map((frame) => (
        <div
          key={frame.sourceId}
          className="relative min-h-0 min-w-0 overflow-hidden rounded-md border border-black/80 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]"
        >
          <OperatorLiveCameraVideo frame={frame} />
          <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-black/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-normal text-emerald-100">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-white/15 bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {frame.label}
          </div>
        </div>
      ))}
    </div>
  );
};

export const EpisodeCameraPreview = ({
  urdfContent,
  meshFiles,
  cameraId,
  urdfBasePath,
  packageRoots,
  gpuMode = "high",
  emptyStateMessage = "No cameras available.",
  allowOperatorLiveCamera = false,
}: EpisodeCameraPreviewProps) => {
  const activeCameraVideoFrame = useOperatorPerceptionStore((s) => s.activeCameraVideoFrame);
  const activeCameraVideoFrames = useOperatorPerceptionStore((s) => s.activeCameraVideoFrames);
  const cameras = useCameraStore((s) => s.cameras);
  const objects = useObjectStore((s) => s.objects);
  const worldLabsPrimarySceneActive = useWorldLabsPrimarySceneActive();
  const cameraConfig = useMemo(() => {
    if (!cameraId) return cameras[0] ?? null;
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [cameras, cameraId]);
  const normalizedIntrinsics = useMemo(
    () => (cameraConfig ? normalizeCameraIntrinsics(cameraConfig.intrinsics) : null),
    [cameraConfig]
  );

  const groupRef = useRef<THREE.Group>(null);
  const robotRef = useRef<PreviewRobot | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [robot, setRobot] = useState<PreviewRobot | null>(null);
  const [sceneRadius, setSceneRadius] = useState<number | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const aspect = useMemo(() => {
    if (!normalizedIntrinsics) return 16 / 9;
    const { width, height } = normalizedIntrinsics;
    return width && height ? width / height : 16 / 9;
  }, [normalizedIntrinsics]);
  const frameStyle = useMemo(() => {
    const vw = viewportSize.width;
    const vh = viewportSize.height;

    if (vw <= 0 || vh <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
      return {
        width: "100%",
        height: "100%",
      } as const;
    }

    const viewportAspect = vw / vh;
    if (aspect >= viewportAspect) {
      const width = Math.floor(vw);
      const height = Math.floor(width / aspect);
      return {
        width: `${Math.max(1, width)}px`,
        height: `${Math.max(1, height)}px`,
        maxWidth: "100%",
        maxHeight: "100%",
      } as const;
    }

    const height = Math.floor(vh);
    const width = Math.floor(height * aspect);
    return {
      width: `${Math.max(1, width)}px`,
      height: `${Math.max(1, height)}px`,
      maxWidth: "100%",
      maxHeight: "100%",
    } as const;
  }, [aspect, viewportSize.height, viewportSize.width]);
  const operatorLiveCameraFrames = useMemo(
    () =>
      activeCameraVideoFrames.length > 0
        ? activeCameraVideoFrames
        : activeCameraVideoFrame
          ? [activeCameraVideoFrame]
          : [],
    [activeCameraVideoFrame, activeCameraVideoFrames]
  );
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      const width = Math.max(0, rect.width);
      const height = Math.max(0, rect.height);
      setViewportSize((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      );
    };

    updateViewportSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateViewportSize();
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  // Load URDF when content changes
  useEffect(() => {
    setLoadingError(null);
    setSceneRadius(null);
    setRobot(null);
    robotRef.current = null;

    if (!urdfContent || !cameraConfig) {
      return;
    }

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
      const robot = loader.parse(urdfContent) as PreviewRobot;
      // Keep unit scale to preserve camera-to-robot geometry consistency with main viewer.
      robot.scale.setScalar(1);
      configurePreviewObject(robot, gpuMode);
      robotRef.current = robot;
      setRobot(robot);
      materialApplyScheduler.flush(robot);
      setTimeout(() => {
        if (!abortController.signal.aborted) {
          materialApplyScheduler.flush(robot);
        }
      }, URDF_VISUAL_MATERIAL_APPLY_RETRY_DELAY_MS);
    } catch (error) {
      robotRef.current = null;
      setRobot(null);
      setLoadingError((error as Error).message);
    }

    return () => {
      materialApplyScheduler.cancel();
      abortController.abort();
    };
  }, [urdfContent, meshFiles, gpuMode, cameraConfig, urdfBasePath, packageRoots]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const refresh = () => {
      if (cancelled) return;
      const metrics = computeSceneMetrics(robot, objects);

      setSceneRadius((prev) => {
        if (prev === metrics.sceneRadius) return prev;
        if (prev === null || metrics.sceneRadius === null) return metrics.sceneRadius;
        return approxEqual(prev, metrics.sceneRadius) ? prev : metrics.sceneRadius;
      });
    };

    refresh();

    if (typeof window !== "undefined" && robot) {
      // Mesh attachment happens asynchronously after URDF parse; poll lightly so clipping
      // become correct as soon as geometry lands, then stop to avoid background CPU churn.
      let attempts = 0;
      const maxAttempts = 12;
      intervalId = window.setInterval(() => {
        refresh();
        attempts += 1;
        if (attempts >= maxAttempts && typeof intervalId === "number") {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      if (typeof intervalId === "number") {
        window.clearInterval(intervalId);
      }
    };
  }, [robot, objects]);

  if (allowOperatorLiveCamera && operatorLiveCameraFrames.length > 0) {
    return (
      <div
        ref={viewportRef}
        className="relative h-full w-full min-h-0 min-w-0 overflow-hidden rounded-md border border-border/50 bg-black"
      >
        {operatorLiveCameraFrames.length > OPERATOR_LIVE_CAMERA_SINGLE_FRAME_COUNT ? (
          <OperatorLiveCameraGrid frames={operatorLiveCameraFrames} />
        ) : (
          <div className="flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
            <div
              className="relative max-h-full max-w-full shrink-0 overflow-hidden border border-black/80 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]"
              style={frameStyle}
            >
              <OperatorLiveCameraVideo frame={operatorLiveCameraFrames[0]} />
              <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-black/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-normal text-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-white/15 bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {operatorLiveCameraFrames[0].label}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!cameraConfig) {
    return (
      <div className="h-full w-full rounded-md border border-border/50 bg-[#0b0b0b] flex items-center justify-center text-[11px] text-muted-foreground">
        {emptyStateMessage}
      </div>
    );
  }

  if (!urdfContent) {
    return (
      <div className="h-full w-full rounded-md border border-border/50 bg-[#0b0b0b] flex items-center justify-center text-[11px] text-muted-foreground">
        Load a URDF to view camera playback.
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
          className="relative max-h-full max-w-full shrink-0 overflow-hidden border border-black/80 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]"
          style={{
            ...frameStyle,
            backgroundColor: "black",
          }}
        >
          <Canvas
            key={cameraConfig.id}
            frameloop="always"
            style={{ width: "100%", height: "100%" }}
            dpr={gpuMode === "low" ? [1, 1.25] : [1, 2]}
            camera={{
              position: [0, 0, 2],
              fov: normalizedIntrinsics?.fov_deg ?? cameraConfig.intrinsics.fov_deg,
              aspect,
              near: 0.05,
              far: sceneRadius ? Math.max(2, sceneRadius * 6) : 50,
            }}
            gl={{ alpha: true, antialias: true }}
            onCreated={({ scene, camera, gl }) => {
              scene.up.set(0, 0, 1);
              camera.up.set(0, 0, 1);
              gl.setClearColor(0x000000, 0);
              // Disable culling for consistency with main viewer
              const ctx = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
              ctx.disable(ctx.CULL_FACE);
            }}
          >
            <hemisphereLight args={["#dbeafe", "#0f172a", 0.55]} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 5, 5]} intensity={0.8} />
            <directionalLight position={[-5, 5, -5]} intensity={0.4} />
            {worldLabsPrimarySceneActive ? (
              <>
                <WorldLabsEnvironmentLayer />
                <WorldLabsSplatLayer />
              </>
            ) : (
              <PreviewSceneChrome gpuMode={gpuMode} />
            )}
            <group ref={groupRef} />
            <PreviewObjects objects={objects} gpuMode={gpuMode} />
            <JointValueSync robot={robot} />
            <BasePoseSync robot={robot} />
            <RobotMountKeeper robot={robot} groupRef={groupRef} />
            <CameraPoseController robot={robot} cameraId={cameraConfig.id} sceneRadius={sceneRadius} />
          </Canvas>
        </div>
      </div>
    </div>
  );
};
