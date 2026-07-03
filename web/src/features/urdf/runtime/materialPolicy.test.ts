import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  resolveSyntheticVisualRgba,
  stablePaletteIndex,
  urdfVisualFingerprint,
  visualIndexWithinLink,
} from "@runtime-private/urdf/materialPolicy";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;

const visualFromUrdf = (urdfXml: string, visualIndex = 0): Element => {
  const xml = new DOMParser().parseFromString(urdfXml, "application/xml");
  const visual = xml.querySelectorAll("visual").item(visualIndex);
  if (!visual) {
    throw new Error("Test URDF missing requested <visual> node");
  }
  return visual;
};

describe("URDF material fallback policy", () => {
  it("builds fingerprints from link, visual index, visual name, and mesh filename", () => {
    const visual = visualFromUrdf(`
      <robot name="demo">
        <link name="base">
          <visual/>
          <visual name="shell">
            <geometry>
              <mesh filename="meshes/base_shell.stl"/>
            </geometry>
          </visual>
        </link>
      </robot>
    `, 1);

    expect(visualIndexWithinLink(visual)).toBe(1);
    expect(urdfVisualFingerprint(visual)).toBe("base shell 1 meshes/base_shell.stl");
  });

  it("resolves semantic wheel fallback colors", () => {
    const visual = visualFromUrdf(`
      <robot name="demo">
        <link name="front_wheel">
          <visual>
            <geometry>
              <mesh filename="meshes/front_wheel.stl"/>
            </geometry>
          </visual>
        </link>
      </robot>
    `);

    expect(resolveSyntheticVisualRgba(visual)).toEqual([0.04, 0.045, 0.05, 1.0]);
  });

  it("keeps palette fallback stable for unclassified visuals", () => {
    const visual = visualFromUrdf(`
      <robot name="demo">
        <link name="decor">
          <visual name="accent">
            <geometry>
              <mesh filename="meshes/accent.stl"/>
            </geometry>
          </visual>
        </link>
      </robot>
    `);

    expect(resolveSyntheticVisualRgba(visual)).toEqual(resolveSyntheticVisualRgba(visual));
  });

  it("rejects empty palette sizes", () => {
    expect(() => stablePaletteIndex("base", 0)).toThrow(/paletteSize must be positive/);
  });
});
