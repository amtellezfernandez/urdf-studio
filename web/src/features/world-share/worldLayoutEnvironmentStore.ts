import { create } from "zustand";
import type { WorldSceneLayerEnvironment } from "@/features/world-share/worldSceneManifest";

type WorldLayoutEnvironmentStore = {
  environment: WorldSceneLayerEnvironment;
  setWorldLayoutEnvironment: (environment: WorldSceneLayerEnvironment) => void;
};

export const useWorldLayoutEnvironmentStore = create<WorldLayoutEnvironmentStore>((set) => ({
  environment: null,
  setWorldLayoutEnvironment: (environment) => set({ environment }),
}));
