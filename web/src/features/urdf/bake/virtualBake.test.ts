import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildUrdfBakedMeshPlan,
  buildUrdfBakePreviewStats,
  buildVirtualBakePreview,
} from "./virtualBake";
import { IDENTITY_URDF_ORIGIN } from "./transformMath";

const TEST_URDF = `
  <robot name="bake_demo">
    <link name="base_link">
      <visual>
        <origin xyz="0.1 0.2 0.3" rpy="0.4 0 0" />
        <geometry>
          <mesh filename="meshes/base.stl" />
        </geometry>
      </visual>
      <collision>
        <origin xyz="0 0 0.1" rpy="0 0.2 0" />
        <geometry>
          <mesh filename="meshes/base_collision.stl" />
        </geometry>
      </collision>
    </link>
    <link name="tool_link">
      <visual>
        <origin xyz="0 0 0" rpy="0 0 0" />
        <geometry>
          <box size="0.1 0.1 0.1" />
        </geometry>
      </visual>
    </link>
  </robot>
`;

describe("virtualBake", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("stages full visual and collision bakes by zeroing URDF origins", () => {
    const result = buildVirtualBakePreview(TEST_URDF);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.kind)).toEqual(["visual", "collision"]);
    expect(result.entries[0]?.meshFilename).toBe("meshes/base.stl");
    expect(result.entries[0]?.bake.bakedOrigin).toEqual(IDENTITY_URDF_ORIGIN);
    expect(result.content).toContain('<origin xyz="0 0 0" rpy="0 0 0"/>');
  });

  it("supports scoped preview by link name and entry kind", () => {
    const result = buildVirtualBakePreview(TEST_URDF, {
      kinds: ["visual"],
      linkNames: ["base_link"],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: "visual",
      linkName: "base_link",
      geometryType: "mesh",
    });
    expect(result.content).toContain('mesh filename="meshes/base_collision.stl"');
    expect(result.content).toContain('<origin xyz="0 0 0.1" rpy="0 0.2 0"/>');
  });

  it("reports skipped identity origins and missing links", () => {
    const result = buildVirtualBakePreview(TEST_URDF, {
      linkNames: ["tool_link", "missing_link"],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.entries).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        kind: "visual",
        linkName: "missing_link",
        index: -1,
        reason: "missing-link",
      },
      {
        kind: "visual",
        linkName: "tool_link",
        index: 0,
        reason: "identity-origin",
      },
    ]);
  });

  it("returns a parse error when the URDF is invalid", () => {
    const result = buildVirtualBakePreview("<robot");

    expect(result).toMatchObject({
      success: false,
      error: "Failed to parse URDF for bake preview.",
    });
  });

  it("summarizes staged bake entries for UI surfaces", () => {
    const result = buildVirtualBakePreview(TEST_URDF);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(buildUrdfBakePreviewStats(result)).toEqual({
      entryCount: 2,
      meshBackedEntryCount: 2,
      linkNames: ["base_link"],
    });
  });

  it("builds a serializable baked-mesh plan from staged entries", () => {
    const result = buildVirtualBakePreview(TEST_URDF);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const plan = buildUrdfBakedMeshPlan(result);
    expect(plan.conflicts).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.map((entry) => entry.meshReference)).toEqual([
      "meshes/base_collision.stl",
      "meshes/base.stl",
    ]);
    expect(plan.entries.every((entry) => entry.linkNames[0] === "base_link")).toBe(true);
  });

  it("flags conflicting shared mesh bake transforms", () => {
    const conflictingUrdf = `
      <robot name="conflict_demo">
        <link name="left_link">
          <visual>
            <origin xyz="0.1 0 0" rpy="0 0 0" />
            <geometry>
              <mesh filename="meshes/shared.obj" />
            </geometry>
          </visual>
        </link>
        <link name="right_link">
          <visual>
            <origin xyz="-0.1 0 0" rpy="0 0 0" />
            <geometry>
              <mesh filename="meshes/shared.obj" />
            </geometry>
          </visual>
        </link>
      </robot>
    `;
    const result = buildVirtualBakePreview(conflictingUrdf);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(buildUrdfBakedMeshPlan(result).conflicts).toEqual([
      {
        meshReference: "meshes/shared.obj",
        linkNames: ["left_link", "right_link"],
      },
    ]);
  });
});
