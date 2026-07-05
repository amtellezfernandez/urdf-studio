import {
  Component,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Html } from "@react-three/drei";
import { extend, useThree, type ThreeEvent } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

import type { CreatedObject } from "@/features/objects";

// Register Spark's renderer and mesh as R3F intrinsic elements ("sparkRenderer",
// "splatMesh"). They are created below via createElement with string tags so we do
// not need to augment the JSX intrinsic-element typings for a single call site.
extend({ SparkRenderer, SplatMesh });

type SplatAssetPointerHandlers = {
  onClick: (event: ThreeEvent<MouseEvent>) => void;
  onDoubleClick: (event: ThreeEvent<MouseEvent>) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>) => void;
};

type SplatAssetBodyProps = {
  object: CreatedObject;
  objectPosition: [number, number, number];
  objectRotation: [number, number, number];
  pointerHandlers: SplatAssetPointerHandlers;
  fallback: ReactNode;
};

const isLoadableBrowserSplatUri = (value: string): boolean =>
  /^(blob:|data:|https?:\/\/|\/)/i.test(value);

const resolveSplatAssetUri = (object: CreatedObject): string | null => {
  const candidates = [object.meshUri, object.assetRef];
  return candidates.find((candidate) => candidate && isLoadableBrowserSplatUri(candidate)) ?? null;
};

const isSplatAssetUri = (uri: string): boolean => {
  const withoutQuery = uri.split(/[?#]/)[0] ?? "";
  return /\.(spz|splat|ply|ksplat)$/i.test(withoutQuery);
};

class SplatAssetErrorBoundary extends Component<
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

/**
 * Renders a gaussian-splat asset (.spz) as a first-class world object, so splat
 * environments flow through the same object pipeline as mesh objects. The splat is
 * mounted inside a SparkRenderer with LOD enabled and positioned/rotated/scaled by
 * the object's transform (assetScale carries the metric scale factor). Load
 * failures surface as an inline badge instead of silently rendering nothing.
 */
export function SplatAssetBody({
  object,
  objectPosition,
  objectRotation,
  pointerHandlers,
  fallback,
}: SplatAssetBodyProps) {
  const renderer = useThree((state) => state.gl);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [splatInstance, setSplatInstance] = useState<SplatMesh | null>(null);
  const uri = resolveSplatAssetUri(object);

  const handleSplatRef = useCallback((instance: SplatMesh | null) => {
    setSplatInstance(instance);
  }, []);

  const sparkArgs = useMemo(
    () => ({
      renderer,
      enableLod: true,
      lodRenderScale: 2,
      encodeLinear: false,
    }),
    [renderer]
  );
  const splatArgs = useMemo(() => ({ url: uri ?? "", lod: true }), [uri]);

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

  if (!uri || !isSplatAssetUri(uri)) {
    return <>{fallback}</>;
  }

  const scale: [number, number, number] = object.assetScale
    ? [object.assetScale.x, object.assetScale.y, object.assetScale.z]
    : [1, 1, 1];

  return (
    <SplatAssetErrorBoundary fallback={fallback} resetKey={uri}>
      {createElement(
        "sparkRenderer",
        { key: `spark-${uri}`, args: [sparkArgs], visible: true },
        createElement(
          "group",
          {
            position: objectPosition,
            rotation: objectRotation,
            scale,
            ...pointerHandlers,
          },
          createElement("splatMesh", { ref: handleSplatRef, args: [splatArgs] })
        )
      )}
      {loadError ? (
        <Html center position={objectPosition}>
          <div className="rounded-md border border-destructive/50 bg-background/95 px-2 py-1 text-[10px] text-destructive shadow">
            {`World splat failed: ${loadError}`}
          </div>
        </Html>
      ) : null}
    </SplatAssetErrorBoundary>
  );
}
