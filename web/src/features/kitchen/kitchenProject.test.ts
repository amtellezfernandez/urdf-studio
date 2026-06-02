/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  KITCHEN_BASE_LINK_NAME,
  KITCHEN_NUMBER_DECIMAL_PLACES,
  KITCHEN_URDF_REVOLUTE_LIMIT_LOWER_RAD,
  KITCHEN_URDF_REVOLUTE_LIMIT_UPPER_RAD,
} from "@/features/kitchen/kitchenParams";
import {
  buildKitchenUrdfFromProject,
  parseKitchenProjectXml,
} from "@/features/kitchen/kitchenProject";

const PROJECT_TEST = {
  robotName: "demo_bot",
  packageName: "demo_bot_description",
  armLinkName: "shoulder",
  decorationLinkName: "badge",
  armMesh: "meshes/shoulder.stl",
  decorationMesh: "meshes/badge.stl",
  basePointXyz: "0.1 0.2 0.3",
  decorationPointXyz: "0.04 0.05 0.06",
  whiteRgb: "1 1 1",
  armRgb: "0.2 0.3 0.4",
  decorationRgb: "0.9 0.8 0.1",
  armMass: "2.5",
  decorationMass: "0.01",
  armIxx: "0.11",
  armIyy: "0.22",
  armIzz: "0.33",
  yRotationAxisId: "1",
  fixedRotationAxisId: "3",
  expectedExportedLinkCount: 2,
  revoluteYAxis: "0 1 0",
} as const;

const createProjectXml = (): string => `<?xml version="1.0"?>
<project>
  <robot_name>${PROJECT_TEST.robotName}</robot_name>
  <nodes>
    <node>
      <name>${KITCHEN_BASE_LINK_NAME}</name>
      <type>BaseLinkNode</type>
      <mass>0</mass>
      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>
      <color>${PROJECT_TEST.whiteRgb}</color>
      <rotation_axis>${PROJECT_TEST.fixedRotationAxisId}</rotation_axis>
      <points>
        <point>
          <name>base_socket</name>
          <type>fixed</type>
          <xyz>${PROJECT_TEST.basePointXyz}</xyz>
        </point>
      </points>
    </node>
    <node>
      <name>${PROJECT_TEST.armLinkName}</name>
      <type>FooNode</type>
      <stl_file>${PROJECT_TEST.armMesh}</stl_file>
      <mass>${PROJECT_TEST.armMass}</mass>
      <inertia ixx="${PROJECT_TEST.armIxx}" ixy="0" ixz="0" iyy="${PROJECT_TEST.armIyy}" iyz="0" izz="${PROJECT_TEST.armIzz}"/>
      <color>${PROJECT_TEST.armRgb}</color>
      <rotation_axis>${PROJECT_TEST.yRotationAxisId}</rotation_axis>
      <massless_decoration>False</massless_decoration>
      <points>
        <point>
          <name>decoration_mount</name>
          <type>fixed</type>
          <xyz>${PROJECT_TEST.decorationPointXyz}</xyz>
        </point>
      </points>
    </node>
    <node>
      <name>${PROJECT_TEST.decorationLinkName}</name>
      <type>FooNode</type>
      <stl_file>${PROJECT_TEST.decorationMesh}</stl_file>
      <mass>${PROJECT_TEST.decorationMass}</mass>
      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>
      <color>${PROJECT_TEST.decorationRgb}</color>
      <rotation_axis>${PROJECT_TEST.fixedRotationAxisId}</rotation_axis>
      <massless_decoration>True</massless_decoration>
      <points/>
    </node>
  </nodes>
  <connections>
    <connection>
      <from_node>${KITCHEN_BASE_LINK_NAME}</from_node>
      <from_port>out</from_port>
      <to_node>${PROJECT_TEST.armLinkName}</to_node>
      <to_port>in</to_port>
    </connection>
    <connection>
      <from_node>${PROJECT_TEST.armLinkName}</from_node>
      <from_port>out</from_port>
      <to_node>${PROJECT_TEST.decorationLinkName}</to_node>
      <to_port>in</to_port>
    </connection>
  </connections>
</project>`;

const parseUrdf = (urdfContent: string): XMLDocument =>
  new DOMParser().parseFromString(urdfContent, "application/xml");

const findNamedElement = (
  document: XMLDocument,
  tagName: string,
  name: string
): Element | null =>
  Array.from(document.querySelectorAll(tagName)).find(
    (element) => element.getAttribute("name") === name
  ) ?? null;

const meshFilenamesForLink = (document: XMLDocument, linkName: string): string[] => {
  const link = findNamedElement(document, "link", linkName);
  return Array.from(link?.querySelectorAll("visual mesh") ?? []).map(
    (mesh) => mesh.getAttribute("filename") ?? ""
  );
};

const formatExpectedNumber = (value: number): string =>
  value.toFixed(KITCHEN_NUMBER_DECIMAL_PLACES).replace(/\.?0+$/, "");

describe("Kitchen project URDF export", () => {
  it("exports the project graph without creating separate links for massless decorations", () => {
    const project = parseKitchenProjectXml(createProjectXml());
    const result = buildKitchenUrdfFromProject({
      ...project,
      packageName: PROJECT_TEST.packageName,
    });
    const document = parseUrdf(result.urdfContent);
    const linkNames = Array.from(document.querySelectorAll("link")).map(
      (link) => link.getAttribute("name")
    );
    const armJoint = findNamedElement(
      document,
      "joint",
      `${KITCHEN_BASE_LINK_NAME}_to_${PROJECT_TEST.armLinkName}`
    );
    const armMeshes = meshFilenamesForLink(document, PROJECT_TEST.armLinkName);

    expect(result.warnings).toEqual([]);
    expect(document.documentElement.getAttribute("name")).toBe(PROJECT_TEST.robotName);
    expect(linkNames).toHaveLength(PROJECT_TEST.expectedExportedLinkCount);
    expect(linkNames).toContain(KITCHEN_BASE_LINK_NAME);
    expect(linkNames).toContain(PROJECT_TEST.armLinkName);
    expect(linkNames).not.toContain(PROJECT_TEST.decorationLinkName);
    expect(armMeshes).toEqual([
      `package://${PROJECT_TEST.packageName}/${PROJECT_TEST.armMesh}`,
      `package://${PROJECT_TEST.packageName}/${PROJECT_TEST.decorationMesh}`,
    ]);
    expect(armJoint?.getAttribute("type")).toBe("revolute");
    expect(armJoint?.querySelector("origin")?.getAttribute("xyz")).toBe(
      PROJECT_TEST.basePointXyz
    );
    expect(armJoint?.querySelector("axis")?.getAttribute("xyz")).toBe(
      PROJECT_TEST.revoluteYAxis
    );
    expect(armJoint?.querySelector("limit")?.getAttribute("lower")).toBe(
      formatExpectedNumber(KITCHEN_URDF_REVOLUTE_LIMIT_LOWER_RAD)
    );
    expect(armJoint?.querySelector("limit")?.getAttribute("upper")).toBe(
      formatExpectedNumber(KITCHEN_URDF_REVOLUTE_LIMIT_UPPER_RAD)
    );
  });

  it("rejects non-Kitchen project roots", () => {
    expect(() =>
      parseKitchenProjectXml(`<robot name="plain_urdf"><link name="base"/></robot>`)
    ).toThrow("Kitchen project XML must use a <project> root.");
  });
});
