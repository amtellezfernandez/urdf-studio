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

  it("keeps repeated mesh assets as separate world layout elements", () => {
    const uri = "/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb";
    const configs = readWorldLayoutElementConfigs({
      preset: "hk-cargo-port",
      elements: [
        {
          id: "shipping-container",
          name: "shipping container",
          uri,
          position_xyz: [-0.9, 0.85, 0],
          scale: 0.5,
        },
        {
          id: "grabbable-container-a",
          name: "small grabbable shipping container",
          uri,
          position_xyz: [-0.08, 0.24, 0],
          rotation_rpy_rad: [Math.PI / 2, 0, -0.08],
          scale: 0.09,
          material_color: "#ef4444",
        },
      ],
    });

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.asset.id)).toEqual([
      "shipping-container",
      "grabbable-container-a",
    ]);
    expect(configs.map((config) => config.asset.url)).toEqual([uri, uri]);
    expect(configs[1]?.position).toEqual([-0.08, 0.24, 0]);
    expect(configs[1]?.rotation).toEqual([Math.PI / 2, 0, -0.08]);
    expect(configs[1]?.scale).toEqual([0.09, 0.09, 0.09]);
    expect(configs[1]?.materialColor).toBe("#ef4444");
  });

  it("reads element physics defaults and dynamic mesh overrides", () => {
    const uri = "/world-layouts/hk-cargo-port/elements/shipping-container/0-shipping-container.glb";
    const configs = readWorldLayoutElementConfigs({
      preset: "hk-cargo-port",
      elements_layout: {
        physics_defaults: {
          body_type: "static",
          friction: 1.2,
          restitution: 0,
          linear_damping: 1,
          angular_damping: 1,
        },
      },
      elements: [
        {
          id: "shipping-container",
          name: "shipping container",
          uri,
          position_xyz: [-0.9, 0.85, 0],
          scale: 0.5,
        },
        {
          id: "grabbable-container-a",
          name: "small grabbable shipping container",
          uri,
          position_xyz: [-0.08, 0.24, 0],
          scale: 0.09,
          physics: {
            body_type: "dynamic",
            mass_kg: 0.12,
            friction: 3,
          },
        },
      ],
    });

    expect(configs[0]?.physics).toMatchObject({
      bodyType: "static",
      friction: 1.2,
      restitution: 0,
    });
    expect(configs[1]?.physics).toMatchObject({
      bodyType: "dynamic",
      massKg: 0.12,
      friction: 3,
      restitution: 0,
      linearDamping: 1,
      angularDamping: 1,
    });
  });
});
