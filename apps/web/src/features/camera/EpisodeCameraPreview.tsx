import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { STLLoader } from "three-stdlib";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useJointStore } from "@/shared/store/useJointStore";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import type { MeshFiles } from "@/shared/types/feature";

const rotationCorrection = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI / 2
);

type PreviewRobot = URDFRobot;

const PreviewObjects = ({
  objects,
  gpuMode = "high",
}: {
  objects: CreatedObject[];
  gpuMode?: GPUMode;
}) => {
  return (
    <group>
      {objects.map((obj) => {
        const baseColor = obj.color || "#3b82f6";
        const fillColor = obj.isIkTarget ? "#facc15" : baseColor;
        const outlineColor = obj.isIkTarget ? "#facc15" : "#bfbfbf";
        const radius = Math.max(obj.size.x, obj.size.y, obj.size.z) * 0.5;

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
                    <meshBasicMaterial color={fillColor} opacity={0.85} transparent />
                  ) : (
                    <meshStandardMaterial
                      color={fillColor}
                      opacity={0.85}
                      transparent
                      metalness={0.15}
                      roughness={0.6}
                      emissive={fillColor}
                      emissiveIntensity={0.08}
                    />
                  )}
                </mesh>
                <lineSegments>
                  <edgesGeometry args={[new THREE.SphereGeometry(radius, 12, 8)]} />
                  <lineBasicMaterial color={outlineColor} linewidth={1} />
                </lineSegments>
              </>
            ) : (
              <>
                <mesh>
                  <boxGeometry args={[obj.size.x, obj.size.y, obj.size.z]} />
                  {gpuMode === "low" ? (
                    <meshBasicMaterial color={fillColor} opacity={0.65} transparent />
                  ) : (
                    <meshStandardMaterial
                      color={fillColor}
                      opacity={0.65}
                      transparent
                      metalness={0.15}
                      roughness={0.6}
                      emissive={fillColor}
                      emissiveIntensity={0.05}
                    />
                  )}
                </mesh>

                <lineSegments>
                  <edgesGeometry args={[new THREE.BoxGeometry(obj.size.x, obj.size.y, obj.size.z)]} />
                  <lineBasicMaterial color={outlineColor} linewidth={1} />
                </lineSegments>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

const JointValueSync = ({ robot }: { robot: PreviewRobot | null }) => {
  useFrame(() => {
    if (!robot) return;
    const values = useJointStore.getState().jointValues;
    applyJointValues(robot, values);
    // Keep world matrices up to date so dependent helpers (e.g., camera pose) see movement
    robot.updateMatrixWorld?.(true);
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
  const cameraConfig = useMemo(
    () => cameras.find((c) => c.id === cameraId) ?? cameras[0],
    [cameras, cameraId]
  );
  const previewCamera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((state) => state.invalidate);

  // Sync projection with intrinsics and scene size
  useEffect(() => {
    if (!previewCamera || !cameraConfig) return;
    const { width, height, fov_deg } = cameraConfig.intrinsics;
    const aspect = width && height ? width / height : 1;
    previewCamera.fov = fov_deg;
    previewCamera.aspect = aspect;
    if (sceneRadius) {
      previewCamera.near = Math.max(0.01, sceneRadius * 0.02);
      previewCamera.far = Math.max(previewCamera.near * 10, sceneRadius * 6);
    }
    previewCamera.updateProjectionMatrix();
  }, [cameraConfig, previewCamera, sceneRadius]);

  useFrame(() => {
    if (!cameraConfig) return;

    // Ensure robot world transforms are fresh before sampling link pose
    if (robot?.updateMatrixWorld) {
      robot.updateMatrixWorld(true);
    }

    const resolveParentLink = () => {
      if (!robot) return null;
      const direct = robot.links?.[cameraConfig.parent_link];
      if (direct) return direct;

      const byName =
        robot.getObjectByName?.(cameraConfig.parent_link) ??
        robot.getObjectByName?.(decodeURIComponent(cameraConfig.parent_link));
      return byName ?? null;
    };

    const applyPose = (position: THREE.Vector3, baseQuat: THREE.Quaternion) => {
      const finalQuat = baseQuat.clone().multiply(rotationCorrection);
      previewCamera.position.copy(position);
      previewCamera.quaternion.copy(finalQuat);
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(finalQuat);
      previewCamera.lookAt(position.clone().add(lookDir));
      previewCamera.updateMatrixWorld();
      invalidate();
    };

    const parentLink = resolveParentLink();
    if (!robot || !parentLink) {
      const fallbackQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...cameraConfig.pose.rpy, "ZYX")
      );
      applyPose(new THREE.Vector3(...cameraConfig.pose.xyz), fallbackQuat);
      return;
    }

    parentLink.updateMatrixWorld(true);
    const parentTransform = new THREE.Matrix4().copy(parentLink.matrixWorld);

    const localTransform = new THREE.Matrix4();
    localTransform.makeRotationFromEuler(
      new THREE.Euler(...cameraConfig.pose.rpy, "ZYX")
    );
    localTransform.setPosition(new THREE.Vector3(...cameraConfig.pose.xyz));

    const finalTransform = parentTransform.clone().multiply(localTransform);
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalTransform.decompose(position, quat, scale);

    applyPose(position, quat);
  });

  return null;
};

interface EpisodeCameraPreviewProps {
  urdfContent: string | null;
  meshFiles: MeshFiles;
  cameraId: string | null;
  gpuMode?: GPUMode;
}

export const EpisodeCameraPreview = ({
  urdfContent,
  meshFiles,
  cameraId,
  gpuMode = "high",
}: EpisodeCameraPreviewProps) => {
  const cameras = useCameraStore((s) => s.cameras);
  const objects = useObjectStore((s) => s.objects);
  const cameraConfig = useMemo(
    () => cameras.find((c) => c.id === cameraId) ?? cameras[0],
    [cameras, cameraId]
  );

  const groupRef = useRef<THREE.Group>(null);
  const [robot, setRobot] = useState<PreviewRobot | null>(null);
  const [sceneRadius, setSceneRadius] = useState<number | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const blobUrls = useRef<string[]>([]);

  const aspect = useMemo(() => {
    if (!cameraConfig) return 16 / 9;
    const { width, height } = cameraConfig.intrinsics;
    return width && height ? width / height : 16 / 9;
  }, [cameraConfig]);

  // Load URDF when content changes
  useEffect(() => {
    setLoadingError(null);
    setSceneRadius(null);
    setRobot(null);
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.current = [];

    if (!urdfContent || !cameraConfig) {
      return;
    }

    const loader = new URDFLoader();

    loader.loadMeshCb = (path, manager, onComplete) => {
      const filename = path.split("/").pop() || path;
      const variations = [
        path,
        filename,
        path.replace(/^.*?\//, ""),
        path.replace(/^package:\/\/[\w.-]+\//, ""),
      ];
      variations.push(
        ...variations.map((variant) => {
          try {
            return decodeURIComponent(variant);
          } catch {
            return variant;
          }
        })
      );

      let meshBlob: Blob | undefined;
      for (const variant of variations) {
        if (!variant) continue;
        const normalized = variant.replace(/^\/+|\/+$/g, "");
        if (meshFiles[normalized]) {
          meshBlob = meshFiles[normalized];
          break;
        }
      }

      if (!meshBlob) {
        onComplete(null);
        return;
      }

      const blobUrl = URL.createObjectURL(meshBlob);
      blobUrls.current.push(blobUrl);

      const stlLoader = new STLLoader(manager);
      stlLoader.load(
        blobUrl,
        (geometry) => {
          if (!geometry.attributes.normal && geometry.attributes.position && gpuMode === "high") {
            geometry.computeVertexNormals();
          }
          const material =
            gpuMode === "low"
              ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
              : new THREE.MeshStandardMaterial({
                  metalness: 0.3,
                  roughness: 0.7,
                  side: THREE.DoubleSide,
                });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = gpuMode === "high";
          mesh.receiveShadow = gpuMode === "high";
          mesh.scale.setScalar(0.99);
          onComplete(mesh);
        },
        undefined,
        () => onComplete(null)
      );
    };

    try {
      const robot = loader.parse(urdfContent) as PreviewRobot;
      const boundingBox = new THREE.Box3().setFromObject(robot);
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 && isFinite(maxDim) ? Math.min(2 / maxDim, 2) : 1;
      robot.scale.setScalar(scale);

      setRobot(robot);
    } catch (error) {
      setRobot(null);
      setLoadingError((error as Error).message);
    }

    return () => {
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.current = [];
    };
  }, [urdfContent, meshFiles, gpuMode, cameraConfig]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.clear();
    if (robot) groupRef.current.add(robot);
  }, [robot]);

  useEffect(() => {
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
      setSceneRadius(null);
      return;
    }

    const sphere = new THREE.Sphere();
    combinedBox.getBoundingSphere(sphere);
    setSceneRadius(Number.isFinite(sphere.radius) ? sphere.radius : null);
  }, [robot, objects]);

  if (!cameraConfig) {
    return (
      <div className="h-full w-full rounded-md border border-border/50 bg-[#0b0b0b] flex items-center justify-center text-[11px] text-muted-foreground">
        No cameras available.
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
      className="relative w-full overflow-hidden rounded-md border border-border/50 bg-black"
      style={{ aspectRatio: aspect }}
    >
      <Canvas
        key={cameraConfig.id}
        frameloop="always"
        dpr={gpuMode === "low" ? [1, 1.25] : [1, 2]}
        camera={{
          position: [0, 0, 2],
          fov: cameraConfig.intrinsics.fov_deg,
          aspect,
          near: 0.05,
          far: sceneRadius ? Math.max(2, sceneRadius * 6) : 50,
        }}
        onCreated={({ scene, camera, gl }) => {
          scene.up.set(0, 0, 1);
          camera.up.set(0, 0, 1);
          // Disable culling for consistency with main viewer
          const ctx = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
          ctx.disable(ctx.CULL_FACE);
        }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-5, 5, -5]} intensity={0.4} />
        <group ref={groupRef} />
        <PreviewObjects objects={objects} gpuMode={gpuMode} />
        <JointValueSync robot={robot} />
        <CameraPoseController robot={robot} cameraId={cameraConfig.id} sceneRadius={sceneRadius} />
      </Canvas>
    </div>
  );
};
