import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { STLLoader } from "three-stdlib";
import * as THREE from "three";
import URDFLoader from "urdf-loader";
import { useJointStore } from "@/store/useJointStore";
import { Camera } from "@/types/camera";
import type { GPUMode } from "@/hooks/use-gpu-mode";

interface MeshFiles {
  [key: string]: Blob;
}

interface CameraPreviewProps {
  urdfFile: File | null;
  meshFiles: MeshFiles;
  camera: Camera;
  gpuMode?: GPUMode;
}

const CameraPoseController = ({
  cameraConfig,
  robot,
}: {
  cameraConfig: Camera;
  robot: any | null;
}) => {
  const previewCameraRef = useThree((state) => state.camera) as THREE.PerspectiveCamera;

  useFrame(() => {
    if (!robot) return;

    const parentLink = robot.links?.[cameraConfig.parent_link];
    if (!parentLink) return;

    parentLink.updateMatrixWorld(true);
    const parentTransform = new THREE.Matrix4().copy(parentLink.matrixWorld);

    const localTransform = new THREE.Matrix4();
    localTransform.makeRotationFromEuler(new THREE.Euler(...cameraConfig.pose.rpy, "ZYX"));
    localTransform.setPosition(new THREE.Vector3(...cameraConfig.pose.xyz));

    const finalTransform = parentTransform.clone().multiply(localTransform);
    const cameraPosition = new THREE.Vector3();
    const cameraQuaternion = new THREE.Quaternion();
    const cameraScale = new THREE.Vector3();
    finalTransform.decompose(cameraPosition, cameraQuaternion, cameraScale);

    const rotationCorrection = new THREE.Quaternion();
    rotationCorrection.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const finalQuaternion = cameraQuaternion.clone().multiply(rotationCorrection);

    previewCameraRef.position.copy(cameraPosition);
    previewCameraRef.quaternion.copy(finalQuaternion);
  });

  return null;
};

export const CameraPreview = ({ urdfFile, meshFiles, camera, gpuMode = "high" }: CameraPreviewProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const [robot, setRobot] = useState<any | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const blobUrls = useRef<string[]>([]);
  const jointValues = useJointStore((state) => state.jointValues);

  useEffect(() => {
    if (!urdfFile) {
      setRobot(null);
      setLoadingError(null);
      setIsReady(false);
      return;
    }

    setLoadingError(null);
    setIsReady(false);
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.current = [];

    const loader = new URDFLoader();

    loader.loadMeshCb = (path, manager, onComplete) => {
      const filename = path.split("/").pop() || path;
      const pathVariations = [
        path,
        filename,
        path.replace(/^.*?\//, ""),
        path.replace(/^package:\/\/[^/]+\//, ""),
      ];
      pathVariations.push(
        ...pathVariations.map((variant) => {
          try {
            return decodeURIComponent(variant);
          } catch {
            return variant;
          }
        })
      );

      let meshBlob: Blob | undefined;
      for (const variant of pathVariations) {
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

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        if (xmlDoc.querySelector("parsererror")) {
          throw new Error("Invalid URDF content");
        }

        const robot = loader.parse(content) as any;
        if (!robot) {
          throw new Error("Failed to parse URDF");
        }

        const boundingBox = new THREE.Box3().setFromObject(robot);
        const size = boundingBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 && isFinite(maxDim) ? Math.min(2 / maxDim, 2) : 1;
        robot.scale.setScalar(scale);

        setRobot(robot);
        setIsReady(true);
      } catch (error) {
        setLoadingError((error as Error).message);
        setRobot(null);
      }
    };

    reader.readAsText(urdfFile);

    return () => {
      reader.abort();
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.current = [];
      setRobot(null);
      setIsReady(false);
    };
  }, [urdfFile, meshFiles, gpuMode]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.clear();
    if (robot) {
      groupRef.current.add(robot);
    }
  }, [robot]);

  useEffect(() => {
    if (!robot) return;
    Object.entries(jointValues).forEach(([jointName, value]) => {
      robot.setJointValue?.(jointName, value);
    });
  }, [jointValues, robot]);

  if (!urdfFile) {
    return (
      <div className="h-full w-full rounded-md border border-border bg-[#101010] p-4 text-[11px] text-muted-foreground">
        Upload a URDF to preview this camera.
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="h-full w-full rounded-md border border-border bg-[#101010] p-4 text-[11px] text-destructive">
        {loadingError}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-black">
      <Canvas camera={{ position: [0, 0, 2], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-5, 5, -5]} intensity={0.4} />
        <group ref={groupRef} />
        <CameraPoseController cameraConfig={camera} robot={robot} />
      </Canvas>
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          Loading preview...
        </div>
      )}
    </div>
  );
};
