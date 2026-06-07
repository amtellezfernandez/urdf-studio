import { describe, expect, it, beforeEach } from "vitest";
import { useGenesisWorldLiveStateStore } from "@/features/world-share/genesisWorldLiveStateStore";

describe("genesisWorldLiveStateStore", () => {
  beforeEach(() => {
    useGenesisWorldLiveStateStore.getState().clearLivePoses();
  });

  it("indexes backend pose updates by world layout element id", () => {
    useGenesisWorldLiveStateStore.getState().setLivePoses(7, [
      {
        element_id: "grabbable-container-a",
        position_xyz: [0.3, -0.1, 0.02],
        orientation_wxyz: [1, 0, 0, 0],
      },
    ]);

    const state = useGenesisWorldLiveStateStore.getState();
    expect(state.sequence).toBe(7);
    expect(state.posesByElementId["grabbable-container-a"]).toEqual({
      elementId: "grabbable-container-a",
      position: [0.3, -0.1, 0.02],
      orientationWxyz: [1, 0, 0, 0],
    });
  });
});
