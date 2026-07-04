import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { useLoader, type ThreeEvent } from "@react-three/fiber";
import { PLYLoader, STLLoader } from "three-stdlib";

import type { CreatedObject } from "@/features/objects";

type MeshAssetPointerHandlers = {
  onClick: (event: ThreeEvent<MouseEvent>) => void;
  onDoubleClick: (event: ThreeEvent<MouseEvent>) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>) => void;
};

type MeshAssetBodyProps = {
  object: CreatedObject;
  objectPosition: [number, number, number];
  objectRotation: [number, number, number];
  pointerHandlers: MeshAssetPointerHandlers;
  fallback: ReactNode;
};

const isLoadableBrowserMeshUri = (value: string): boolean =>
  /^(blob:|data:|https?:\/\/|\/)/i.test(value);

const resolveMeshAssetUri = (object: CreatedObject): string | null => {
  const candidates = [object.meshUri, object.assetRef];
  return candidates.find((candidate) => candidate && isLoadableBrowserMeshUri(candidate)) ?? null;
};

const resolveMeshAssetExtension = (uri: string): string => {
  const withoutQuery = uri.split(/[?#]/)[0] ?? "";
  const dotIndex = withoutQuery.lastIndexOf(".");
  return dotIndex === -1 ? "" : withoutQuery.slice(dotIndex + 1).toLowerCase();
};

function GltfMeshAsset({ uri }: { uri: string }) {
  const gltf = useGLTF(uri);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={scene} />;
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
  { children: ReactNode; fallback: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
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
    <MeshAssetErrorBoundary fallback={fallback} resetKey={uri}>
      <Suspense fallback={fallback}>
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
