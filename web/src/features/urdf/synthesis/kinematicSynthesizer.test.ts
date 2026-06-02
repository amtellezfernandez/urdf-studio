/** @vitest-environment jsdom */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";
import {
  captureKinematicState,
  synthesizeKinematicPreview,
} from "./kinematicSynthesizer";

const SIMPLE_URDF = `
<robot name="demo_robot">
  <link name="base_link" />
  <link name="arm_link" />
  <link name="tool_link" />
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link" />
    <child link="arm_link" />
  </joint>
  <joint name="arm_to_tool" type="fixed">
    <parent link="arm_link" />
    <child link="tool_link" />
  </joint>
</robot>
`;

const createLink = (name: string, position: [number, number, number]): THREE.Object3D => {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(...position);
  return object;
};

const createRobotStub = (): URDFRobot => {
  const robotRoot = new THREE.Object3D();
  const baseLink = createLink("base_link", [0, 0, 0]);
  const armLink = createLink("arm_link", [1, 2, 0]);
  const toolLink = createLink("tool_link", [0, 0, 3]);

  robotRoot.add(baseLink);
  baseLink.add(armLink);
  armLink.add(toolLink);
  robotRoot.updateMatrixWorld(true);

  return {
    robotName: "demo_robot",
    links: {
      base_link: baseLink,
      arm_link: armLink,
      tool_link: toolLink,
    },
    getObjectByName: robotRoot.getObjectByName.bind(robotRoot),
    traverse: robotRoot.traverse.bind(robotRoot),
    updateMatrixWorld: robotRoot.updateMatrixWorld.bind(robotRoot),
  } as unknown as URDFRobot;
};

describe("kinematicSynthesizer", () => {
  it("captures a canonical local chain from the current world-space link state", () => {
    const preview = synthesizeKinematicPreview(createRobotStub(), SIMPLE_URDF);

    expect(preview?.robotName).toBe("demo_robot");
    expect(preview?.rootLinkName).toBe("base_link");
    expect(preview?.linkCount).toBe(3);
    expect(preview?.jointCount).toBe(2);
    expect(preview?.sampleJoints).toHaveLength(2);
    expect(preview?.supportPlane.success).toBe(false);

    expect(preview?.joints).toEqual([
      {
        jointName: "base_to_arm",
        jointType: "fixed",
        parentLinkName: "base_link",
        childLinkName: "arm_link",
        xyz: [1, 2, 0],
        rpy: [0, 0, 0],
      },
      {
        jointName: "arm_to_tool",
        jointType: "fixed",
        parentLinkName: "arm_link",
        childLinkName: "tool_link",
        xyz: [0, 0, 3],
        rpy: [0, 0, 0],
      },
    ]);
  });

  it("returns null when the robot topology cannot be synthesized", () => {
    expect(synthesizeKinematicPreview(null, SIMPLE_URDF)).toBeNull();
    expect(synthesizeKinematicPreview(createRobotStub(), "<robot />")).toBeNull();
  });

  it("captures support-plane inference from rendered mesh geometry", () => {
    const robot = createRobotStub();
    const supportMesh = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2, 0.1),
      new THREE.MeshBasicMaterial()
    );
    supportMesh.position.set(0, 0, -0.05);
    robot.links.base_link?.add(supportMesh);
    robot.updateMatrixWorld(true);

    const preview = synthesizeKinematicPreview(robot, SIMPLE_URDF);

    expect(preview?.supportPlane.success).toBe(true);
    if (preview?.supportPlane.success) {
      expect(preview.supportPlane.inferredUpAxis).toBe("z");
      expect(preview.supportPlane.inferredUpSign).toBe(1);
      expect(preview.supportPlane.confidence).toBeGreaterThan(0);
    }
  });

  it("captures full-precision world matrices before backend reconstruction", () => {
    const robotRoot = new THREE.Object3D();
    const baseLink = createLink("base_link", [0, 0, 0]);
    const armLink = createLink("arm_link", [0.123456789, 2.000000001, 0]);
    const toolLink = createLink("tool_link", [0, 0, 3]);

    robotRoot.add(baseLink);
    baseLink.add(armLink);
    armLink.add(toolLink);
    robotRoot.updateMatrixWorld(true);

    const capturedState = captureKinematicState(
      {
        robotName: "demo_robot",
        links: {
          base_link: baseLink,
          arm_link: armLink,
          tool_link: toolLink,
        },
        getObjectByName: robotRoot.getObjectByName.bind(robotRoot),
        traverse: robotRoot.traverse.bind(robotRoot),
        updateMatrixWorld: robotRoot.updateMatrixWorld.bind(robotRoot),
      } as unknown as URDFRobot,
      SIMPLE_URDF
    );

    const armPose = capturedState?.capturedLinkWorldPoses.find((entry) => entry.linkName === "arm_link");
    expect(armPose).toBeDefined();
    expect(armPose?.matrixWorldElements[12]).toBeCloseTo(0.123456789, 9);
    expect(armPose?.matrixWorldElements[13]).toBeCloseTo(2.000000001, 9);
  });
});
