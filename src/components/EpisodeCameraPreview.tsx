import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three-stdlib";
import { useCameraStore } from "@/store/useCameraStore";
import { useJointStore } from "@/store/useJointStore";
import type { GPUMode } from "@/hooks/use-gpu-mode";

type MeshFiles = Record<string, Blob>;

const rotationCorrection = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI / 2
);

const JointValueSync = ({ robot }: { robot: any | null }) => {
  useFrame(() => {
    if (!robot?.setJointValue) return;
    const values = useJointStore.getState().jointValues;
    for (const [jointName, value] of Object.entries(values)) {
      robot.setJointValue(jointName, value);
    }
  });
  return null;
};

const CameraPoseController = ({
  robot,
  cameraId,
  sceneRadius,
}: {
  robot: any | null;
  cameraId: string | null;
  sceneRadius: number | null;
}) => {
  const cameras = useCameraStore((s) => s.cameras);
  const cameraConfig = useMemo(
    () => cameras.find((c) => c.id === cameraId) ?? cameras[0],
    [cameras, cameraId]
  );
  const previewCamera = useThree((state) => state.camera) as THREE.PerspectiveCamera;

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

    const applyPose = (position: THREE.Vector3, baseQuat: THREE.Quaternion) => {
      const finalQuat = baseQuat.clone().multiply(rotationCorrection);
      previewCamera.position.copy(position);
      previewCamera.quaternion.copy(finalQuat);
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(finalQuat);
      previewCamera.lookAt(position.clone().add(lookDir));
    };

    if (!robot) {
      const fallbackQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...cameraConfig.pose.rpy, "ZYX")
      );
      applyPose(new THREE.Vector3(...cameraConfig.pose.xyz), fallbackQuat);
      return;
    }

    const parentLink = robot.links?.[cameraConfig.parent_link];
    if (!parentLink) {
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
  const cameraConfig = useMemo(
    () => cameras.find((c) => c.id === cameraId) ?? cameras[0],
    [cameras, cameraId]
  );

  const groupRef = useRef<THREE.Group>(null);
  const [robot, setRobot] = useState<any | null>(null);
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
      const robot = loader.parse(urdfContent) as any;
      const boundingBox = new THREE.Box3().setFromObject(robot);
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 && isFinite(maxDim) ? Math.min(2 / maxDim, 2) : 1;
      robot.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(robot);
      const sphere = new THREE.Sphere();
      scaledBox.getBoundingSphere(sphere);
      setSceneRadius(isFinite(sphere.radius) ? sphere.radius : null);

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
        <JointValueSync robot={robot} />
        <CameraPoseController robot={robot} cameraId={cameraConfig.id} sceneRadius={sceneRadius} />
      </Canvas>
    </div>
  );
};
