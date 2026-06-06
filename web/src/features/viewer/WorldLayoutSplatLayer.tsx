import { Html } from "@react-three/drei";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { extend, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useWorldLayoutEnvironmentStore } from "@/features/world-share/worldLayoutEnvironmentStore";

extend({ SparkRenderer, SplatMesh });

type WorldLayoutSplatConfig = {
  uri: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

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

export const WorldLayoutSplatLayer = () => {
  const environment = useWorldLayoutEnvironmentStore((state) => state.environment);
  const config = useMemo(() => readWorldLayoutSplatConfig(environment), [environment]);
  const renderer = useThree((state) => state.gl);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [splatInstance, setSplatInstance] = useState<SplatMesh | null>(null);
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

  if (!config) return null;

  return (
    <>
      {createElement(
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
      )}
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
