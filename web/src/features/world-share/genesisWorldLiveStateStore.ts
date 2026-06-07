import { create } from "zustand";
import type { GenesisWorldPoseResponse } from "@/features/world-share/genesisWorldApi";

export type GenesisWorldLivePose = {
  elementId: string;
  position: [number, number, number];
  orientationWxyz: [number, number, number, number];
};

type GenesisWorldLiveStateStore = {
  sequence: number;
  posesByElementId: Record<string, GenesisWorldLivePose>;
  setLivePoses: (sequence: number, poses: GenesisWorldPoseResponse[]) => void;
  clearLivePoses: () => void;
};

export const useGenesisWorldLiveStateStore = create<GenesisWorldLiveStateStore>((set) => ({
  sequence: 0,
  posesByElementId: {},
  setLivePoses: (sequence, poses) =>
    set(() => ({
      sequence,
      posesByElementId: Object.fromEntries(
        poses.map((pose) => [
          pose.element_id,
          {
            elementId: pose.element_id,
            position: pose.position_xyz,
            orientationWxyz: pose.orientation_wxyz,
          },
        ])
      ),
    })),
  clearLivePoses: () => set({ sequence: 0, posesByElementId: {} }),
}));
