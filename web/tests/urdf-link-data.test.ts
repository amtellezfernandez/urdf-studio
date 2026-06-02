import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<html></html>");
globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;

describe("linkDataByName analysis", () => {
  it("captures visuals, collisions, and inertials per link", () => {
    const urdf = `
      <robot name="test_robot">
        <material name="mat_ref">
          <color rgba="1 0 0 1" />
        </material>
        <link name="base_link">
          <visual>
            <origin xyz="1 2 3" rpy="0 0 0" />
            <geometry>
              <box size="1 1 1" />
            </geometry>
            <material name="mat_ref" />
          </visual>
          <collision>
            <origin xyz="0 0 1" rpy="0 0 0" />
            <geometry>
              <cylinder radius="0.5" length="2" />
            </geometry>
          </collision>
          <inertial>
            <origin xyz="0 0 0.5" rpy="0 0 0" />
            <mass value="3" />
            <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
          </inertial>
        </link>
      </robot>
    `;

    const analysis = analyzeUrdf(urdf);
    expect(analysis.isValid).toBe(true);

    const base = analysis.linkDataByName.base_link;
    expect(base).toBeDefined();
    expect(base.visuals).toHaveLength(1);
    expect(base.collisions).toHaveLength(1);
    expect(base.inertial?.mass).toBe(3);
    expect(base.visuals[0].materialColor).toBe("#ff0000");
  });

  it("prefers inline material color over referenced material", () => {
    const urdf = `
      <robot name="test_robot">
        <material name="mat_ref">
          <color rgba="0 1 0 1" />
        </material>
        <link name="link_a">
          <visual>
            <geometry>
              <sphere radius="1" />
            </geometry>
            <material name="mat_ref">
              <color rgba="0 0 1 1" />
            </material>
          </visual>
        </link>
      </robot>
    `;

    const analysis = analyzeUrdf(urdf);
    expect(analysis.isValid).toBe(true);
    expect(analysis.linkDataByName.link_a.visuals[0].materialColor).toBe("#0000ff");
  });
});
