import type { LinkData } from "@/shared/lib/urdfCore";

export type MeshSource = "collision" | "visual";

export type RepeatedMeshBacking = {
  source: MeshSource;
  meshReference: string;
  meshLabel: string;
  scaleKey: string;
  origin: {
    xyz: [number, number, number];
    rpy: [number, number, number];
  };
};

const parseRepeatedMeshScaleKey = (rawScale: string | undefined): string => {
  const parts = (rawScale ?? "1 1 1").split(/\s+/).filter(Boolean);
  const normalized = [0, 1, 2].map((index) => {
    const value = Number(parts[index] ?? 1);
    return Number.isFinite(value) ? value : 1;
  });
  return normalized.join(" ");
};

const toMeshBacking = (
  source: MeshSource,
  geometry: {
    params: {
      filename?: string;
      scale?: string;
    };
  },
  origin: {
    xyz: [number, number, number];
    rpy: [number, number, number];
  }
): RepeatedMeshBacking | null => {
  const meshReference = geometry.params.filename?.trim();
  if (!meshReference) {
    return null;
  }
  return {
    source,
    meshReference,
    meshLabel: meshReference.split("/").filter(Boolean).at(-1) ?? meshReference,
    scaleKey: parseRepeatedMeshScaleKey(geometry.params.scale),
    origin,
  };
};

export const resolveRepeatedMeshBacking = (data: LinkData): RepeatedMeshBacking | null => {
  const collisionMesh = data.collisions?.find(
    (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
  );
  if (collisionMesh) {
    return toMeshBacking("collision", collisionMesh.geometry, collisionMesh.origin);
  }

  const visualMesh = data.visuals?.find(
    (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
  );
  if (visualMesh) {
    return toMeshBacking("visual", visualMesh.geometry, visualMesh.origin);
  }

  return null;
};

export const buildRepeatedMeshGroupKey = (backing: RepeatedMeshBacking): string =>
  `${backing.source}:${backing.meshReference}:${backing.scaleKey}`;
