import { Component, Suspense, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { PLYLoader, STLLoader } from "three-stdlib";

import type { CreatedObject } from "@/features/objects";

type MeshAssetBodyProps = {
  object: CreatedObject;
  objectPosition: [number, number, number];
  objectRotation: [number, number, number];
  pointerHandlers: Record<string, (...args: never[]) => void>;
  fallback: ReactNode;
};

const resolveMeshAssetUri = (object: CreatedObject): string | null =>
  object.meshUri ?? object.assetRef ?? null;

const resolveMeshAssetExtension = (uri: string): string => {
  const withoutQuery = uri.split(/[?#]/)[0] ?? "";
  const dotIndex = withoutQuery.lastIndexOf(".");
  return dotIndex === -1 ? "" : withoutQuery.slice(dotIndex + 1).toLowerCase();
};

function GltfMeshAsset({ uri }: { uri: string }) {
  const gltf = useGLTF(uri);
  return <primitive object={gltf.scene} />;
}

function StlMeshAsset({ uri }: { uri: string }) {
  const geometry = useLoader(STLLoader, uri);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#c9c9c9" />
    </mesh>
  );
}

function PlyMeshAsset({ uri }: { uri: string }) {
  const geometry = useLoader(PLYLoader, uri);
  const hasVertexColors = geometry.hasAttribute("color");
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#c9c9c9" vertexColors={hasVertexColors} />
    </mesh>
  );
}

class MeshAssetErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) {
      console.error("MeshAssetBody failed to load asset:", error);
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function MeshAssetBody({
  object,
  objectPosition,
  objectRotation,
  pointerHandlers,
  fallback,
}: MeshAssetBodyProps) {
  const uri = resolveMeshAssetUri(object);
  if (!uri) {
    return <>{fallback}</>;
  }

  const extension = resolveMeshAssetExtension(uri);
  const scale: [number, number, number] = object.assetScale
    ? [object.assetScale.x, object.assetScale.y, object.assetScale.z]
    : [1, 1, 1];

  let content: ReactNode;
  if (extension === "glb" || extension === "gltf") {
    content = <GltfMeshAsset uri={uri} />;
  } else if (extension === "stl") {
    content = <StlMeshAsset uri={uri} />;
  } else if (extension === "ply") {
    content = <PlyMeshAsset uri={uri} />;
  } else {
    return <>{fallback}</>;
  }

  return (
    <MeshAssetErrorBoundary fallback={fallback}>
      <Suspense fallback={null}>
        <group
          position={objectPosition}
          rotation={objectRotation}
          scale={scale}
          {...pointerHandlers}
        >
          {content}
        </group>
      </Suspense>
    </MeshAssetErrorBoundary>
  );
}
