import { describe, expect, it } from "vitest";
import {
  createDefaultWorldLayoutElementPlacements,
  mapSimuGenYUpPositionToStudioXyFloor,
  resolveWorldLayoutElementScale,
  type WorldLayoutElementAsset,
} from "@/features/viewer/worldLayoutElementRuntime";

const createAsset = (
  id: string,
  params: Pick<WorldLayoutElementAsset, "realWorldHeightM" | "realWorldFootprintM">
): WorldLayoutElementAsset => ({
  id,
  assetId: id,
  sourceWorldSlug: "hk-cargo-port",
  baseObjectId: id,
  name: id,
  url: `/world-layouts/hk-cargo-port/elements/${id}/0-${id}.glb`,
  ...params,
});

describe("world layout element runtime", () => {
  it("scales generated GLBs to their object.json real-world height", () => {
    expect(resolveWorldLayoutElementScale(2.6, 0.65)).toBeCloseTo(4);
  });

  it("falls back to simu_gen preview scale when no metric height is available", () => {
    expect(resolveWorldLayoutElementScale(undefined, 0.65)).toBe(0.5);
  });

  it("spaces default placements by real-world footprint", () => {
    const placements = createDefaultWorldLayoutElementPlacements([
      createAsset("container", { realWorldHeightM: 2.6, realWorldFootprintM: 6.1 }),
      createAsset("ship", { realWorldHeightM: 50, realWorldFootprintM: 366 }),
    ]);

    expect(placements).toHaveLength(2);
    expect(placements[0]?.position[0]).toBeLessThan(placements[1]?.position[0] ?? 0);
    expect(Math.abs((placements[1]?.position[0] ?? 0) - (placements[0]?.position[0] ?? 0)))
      .toBeCloseTo(6.1 / 2 + 6 + 366 / 2);
  });

  it("maps simu_gen Y-up placements onto the Studio XY floor without changing robot axes", () => {
    expect(mapSimuGenYUpPositionToStudioXyFloor([1, 0, -12])).toEqual([1, 12, 0]);
  });
});
