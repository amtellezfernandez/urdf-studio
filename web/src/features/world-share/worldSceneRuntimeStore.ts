import { create } from "zustand";
import type { WorldArtifactRef, WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

export type ActiveWorldScenePackageRuntime = {
  packageId: string;
  version: string;
  title: string;
  artifacts: WorldArtifactRef[];
  provenance: Record<string, unknown>;
};

type WorldSceneRuntimeStore = {
  activePackage: ActiveWorldScenePackageRuntime | null;
  setActiveWorldScenePackage: (manifest: WorldScenePackageManifest | null) => void;
};

export const useWorldSceneRuntimeStore = create<WorldSceneRuntimeStore>((set) => ({
  activePackage: null,
  setActiveWorldScenePackage: (manifest) =>
    set({
      activePackage: manifest
        ? {
            packageId: manifest.package_id,
            version: manifest.version,
            title: manifest.title,
            artifacts: manifest.artifacts,
            provenance: manifest.provenance,
          }
        : null,
    }),
}));

export const findWorldSplatArtifact = (
  artifacts: readonly WorldArtifactRef[]
): WorldArtifactRef | null =>
  artifacts.find((artifact) => artifact.kind.includes("splat") && artifact.uri.endsWith(".spz")) ??
  null;

export const findWorldColliderArtifact = (
  artifacts: readonly WorldArtifactRef[]
): WorldArtifactRef | null =>
  artifacts.find((artifact) => artifact.kind.includes("collider") && artifact.uri.endsWith(".glb")) ??
  null;
