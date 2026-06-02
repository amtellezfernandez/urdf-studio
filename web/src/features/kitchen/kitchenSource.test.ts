/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  buildKitchenArtifactFromXmlFiles,
  describeKitchenArtifact,
  type KitchenTextFile,
} from "@/features/kitchen/kitchenSource";

const SOURCE_TEST = {
  descriptionRoot: "sample_description",
  robotName: "sample",
  projectRobotName: "project_bot",
  leftPart: "left_grip",
  rightPart: "right_grip",
  partRgb: "0.4 0.5 0.6 1",
  axisX: "1 0 0",
  partMass: "0.25",
  partVolume: "0.001",
  partIxx: "0.01",
  partIyy: "0.02",
  partIzz: "0.03",
  catalogPartCount: 2,
  projectPartCount: 1,
  catalogWarning:
    "No Kitchen project graph was found; generated a fixed part catalog from urdf_part XML files.",
} as const;

const catalogGeneratedPath = (): string =>
  `${SOURCE_TEST.descriptionRoot}/urdf/${SOURCE_TEST.robotName}.kitchen.urdf`;

const projectGeneratedPath = (): string =>
  `${SOURCE_TEST.descriptionRoot}/urdf/${SOURCE_TEST.projectRobotName}.kitchen.urdf`;

const leftPartPath = (): string =>
  `${SOURCE_TEST.descriptionRoot}/meshes/${SOURCE_TEST.leftPart}.xml`;

const rightPartPath = (): string =>
  `${SOURCE_TEST.descriptionRoot}/meshes/${SOURCE_TEST.rightPart}.xml`;

const projectPath = (): string => `${SOURCE_TEST.descriptionRoot}/urdf_pj_sample.xml`;

const createPartXml = (linkName: string): string => `<?xml version="1.0"?>
<urdf_part>
  <material name="#667f99">
    <color rgba="${SOURCE_TEST.partRgb}"/>
  </material>
  <link name="${linkName}">
    <inertial>
      <mass value="${SOURCE_TEST.partMass}"/>
      <volume value="${SOURCE_TEST.partVolume}"/>
      <inertia ixx="${SOURCE_TEST.partIxx}" ixy="0" ixz="0" iyy="${SOURCE_TEST.partIyy}" iyz="0" izz="${SOURCE_TEST.partIzz}"/>
    </inertial>
  </link>
  <point name="mount" type="fixed">
    <point_xyz>0 0 0</point_xyz>
  </point>
  <joint>
    <axis xyz="${SOURCE_TEST.axisX}"/>
  </joint>
</urdf_part>`;

const createProjectXml = (): string => `<?xml version="1.0"?>
<project>
  <robot_name>${SOURCE_TEST.projectRobotName}</robot_name>
  <nodes>
    <node>
      <name>base_link</name>
      <type>BaseLinkNode</type>
      <mass>0</mass>
      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>
      <color>1 1 1</color>
      <rotation_axis>3</rotation_axis>
      <points>
        <point>
          <name>base_socket</name>
          <type>fixed</type>
          <xyz>0 0 0</xyz>
        </point>
      </points>
    </node>
    <node>
      <name>${SOURCE_TEST.leftPart}</name>
      <type>FooNode</type>
      <stl_file>meshes/${SOURCE_TEST.leftPart}.stl</stl_file>
      <mass>${SOURCE_TEST.partMass}</mass>
      <inertia ixx="${SOURCE_TEST.partIxx}" ixy="0" ixz="0" iyy="${SOURCE_TEST.partIyy}" iyz="0" izz="${SOURCE_TEST.partIzz}"/>
      <color>0.4 0.5 0.6</color>
      <rotation_axis>0</rotation_axis>
      <points/>
    </node>
  </nodes>
  <connections>
    <connection>
      <from_node>base_link</from_node>
      <from_port>out</from_port>
      <to_node>${SOURCE_TEST.leftPart}</to_node>
      <to_port>in</to_port>
    </connection>
  </connections>
</project>`;

const catalogFiles = (): KitchenTextFile[] => [
  {
    path: leftPartPath(),
    text: createPartXml(SOURCE_TEST.leftPart),
  },
  {
    path: rightPartPath(),
    text: createPartXml(SOURCE_TEST.rightPart),
  },
];

describe("Kitchen source artifact builder", () => {
  it("builds a fixed catalog URDF that keeps package references on the uploaded description root", () => {
    const artifact = buildKitchenArtifactFromXmlFiles(catalogFiles());
    if (!artifact) {
      throw new Error("Expected Kitchen catalog artifact.");
    }

    expect(artifact.kind).toBe("part_catalog");
    expect(artifact.robotName).toBe(SOURCE_TEST.robotName);
    expect(artifact.generatedUrdfPath).toBe(catalogGeneratedPath());
    expect(artifact.partCount).toBe(SOURCE_TEST.catalogPartCount);
    expect(artifact.warnings).toEqual([SOURCE_TEST.catalogWarning]);
    expect(artifact.urdfContent).toContain(
      `package://${SOURCE_TEST.descriptionRoot}/meshes/${SOURCE_TEST.leftPart}.stl`
    );
    expect(artifact.urdfContent).toContain(
      `package://${SOURCE_TEST.descriptionRoot}/meshes/${SOURCE_TEST.rightPart}.stl`
    );
    expect(describeKitchenArtifact(artifact)).toBe(
      `${SOURCE_TEST.robotName} Kitchen part catalog (${SOURCE_TEST.catalogPartCount} parts)`
    );
  });

  it("prefers a Kitchen project graph over per-part XML files", () => {
    const artifact = buildKitchenArtifactFromXmlFiles([
      {
        path: projectPath(),
        text: createProjectXml(),
      },
      ...catalogFiles(),
    ]);
    if (!artifact) {
      throw new Error("Expected Kitchen project artifact.");
    }

    expect(artifact.kind).toBe("project");
    expect(artifact.robotName).toBe(SOURCE_TEST.projectRobotName);
    expect(artifact.generatedUrdfPath).toBe(projectGeneratedPath());
    expect(artifact.partCount).toBe(SOURCE_TEST.projectPartCount);
    expect(artifact.warnings).toEqual([]);
    expect(artifact.urdfContent).toContain(
      `package://${SOURCE_TEST.descriptionRoot}/meshes/${SOURCE_TEST.leftPart}.stl`
    );
  });
});
