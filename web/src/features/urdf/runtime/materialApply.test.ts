import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { JSDOM } from "jsdom";
import { applyUrdfVisualMaterials } from "@/features/urdf/runtime/materialApply";

const DECIMAL_PRECISION = 3;
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;

const createTestScene = (urdfXml: string) => {
  const xml = new DOMParser().parseFromString(urdfXml, "application/xml");
  const visualNode = xml.querySelector("visual");
  if (!visualNode) {
    throw new Error("Test URDF missing <visual> node");
  }

  const root = new THREE.Object3D();
  const visualObject = new THREE.Object3D() as THREE.Object3D & { urdfNode?: Element };
  visualObject.urdfNode = visualNode;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: "#ffffff" })
  );
  visualObject.add(mesh);
  root.add(visualObject);

  return { root, mesh };
};

const expectMeshColor = (mesh: THREE.Mesh, expected: [number, number, number]) => {
  const material = mesh.material as THREE.MeshPhongMaterial;
  expect(material.color.r).toBeCloseTo(expected[0], DECIMAL_PRECISION);
  expect(material.color.g).toBeCloseTo(expected[1], DECIMAL_PRECISION);
  expect(material.color.b).toBeCloseTo(expected[2], DECIMAL_PRECISION);
};

describe("applyUrdfVisualMaterials", () => {
  it("resolves named robot-level materials referenced from visual nodes", () => {
    const { root, mesh } = createTestScene(`
      <robot name="named_material_robot">
        <material name="3d_printed">
          <color rgba="1.0 0.82 0.12 1.0"/>
        </material>
        <link name="base">
          <visual>
            <geometry>
              <mesh filename="assets/base.stl"/>
            </geometry>
            <material name="3d_printed"/>
          </visual>
        </link>
      </robot>
    `);

    applyUrdfVisualMaterials(root);
    expectMeshColor(mesh, [1.0, 0.82, 0.12]);
  });

  it("forces LeKiwi wheel and motor visuals to SO100 dark", () => {
    const { root, mesh } = createTestScene(`
      <robot name="LeKiwi">
        <material name="body_part">
          <color rgba="0.8 0.1 0.1 1.0"/>
        </material>
        <link name="wheel_link">
          <visual>
            <geometry>
              <mesh filename="meshes/wheels/front_wheel.stl"/>
            </geometry>
            <material name="body_part"/>
          </visual>
        </link>
      </robot>
    `);

    applyUrdfVisualMaterials(root);
    expectMeshColor(mesh, [0.1, 0.1, 0.1]);
  });

  it("forces LeKiwi non-wheel visuals to SO100 printed yellow", () => {
    const { root, mesh } = createTestScene(`
      <robot name="LeKiwi">
        <material name="body_part">
          <color rgba="0.2 0.3 0.9 1.0"/>
        </material>
        <link name="base_link">
          <visual>
            <geometry>
              <mesh filename="meshes/chassis/base_shell.stl"/>
            </geometry>
            <material name="body_part"/>
          </visual>
        </link>
      </robot>
    `);

    applyUrdfVisualMaterials(root);
    expectMeshColor(mesh, [1.0, 0.82, 0.12]);
  });
});
