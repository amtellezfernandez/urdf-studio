import { describe, expect, it } from "vitest";
import {
  readWorldLayoutElementConfigs,
  readWorldLayoutSplatConfig,
} from "@/features/viewer/worldLayoutEnvironmentConfig";

describe("world layout environment config", () => {
  it("reads splat transform config from a world layout environment", () => {
    expect(
      readWorldLayoutSplatConfig({
        visual: {
          kind: "splat",
          uri: " /world-layouts/hk-cargo-port/0-world-500k.spz ",
          position_xyz: [0, 0, 0.147],
          rotation_rpy_rad: [-Math.PI / 2, 0, 0],
          scale: 0.25,
        },
      })
    ).toEqual({
      uri: "/world-layouts/hk-cargo-port/0-world-500k.spz",
      position: [0, 0, 0.147],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 0.25,
    });
  });

  it("keeps valid element entries aligned when invalid entries are skipped", () => {
    const configs = readWorldLayoutElementConfigs({
      preset: "hk-cargo-port",
      elements: [
        { id: "missing-uri", name: "missing uri" },
        {
          id: "orange-rtg-crane",
          name: "orange crane",
          uri: "/world-layouts/hk-cargo-port/elements/orange-rtg-crane/0-orange-rtg-crane.glb",
          metadata: "/world-layouts/hk-cargo-port/elements/orange-rtg-crane/object.json",
          position_xyz: [0.75, 1.15, 0],
          scale: 0.5,
        },
      ],
    });

    expect(configs).toHaveLength(1);
    expect(configs[0]?.asset.id).toBe("orange-rtg-crane");
    expect(configs[0]?.asset.name).toBe("orange crane");
    expect(configs[0]?.asset.metadataUrl).toContain("object.json");
    expect(configs[0]?.position).toEqual([0.75, 1.15, 0]);
    expect(configs[0]?.scale).toEqual([0.5, 0.5, 0.5]);
  });
});
