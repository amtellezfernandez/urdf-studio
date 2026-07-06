import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";

import {
  isObjectDescendantOf,
  resolveObjectAssemblyModelId,
  resolveRobotPointerSelection,
} from "@/features/viewer/viewerPointerSelection";

const createRobot = (): URDFRobot => new THREE.Group() as unknown as URDFRobot;

const createJointWithChild = (child: THREE.Object3D): URDFJoint =>
  ({ children: [child] }) as URDFJoint;

const assignRobotStructure = ({
  robot,
  links,
  joints,
}: {
  robot: URDFRobot;
  links: Record<string, THREE.Object3D>;
  joints: Record<string, URDFJoint>;
}): void => {
  Object.assign(robot, { links, joints });
};

describe("viewerPointerSelection", () => {
  it("resolves assembly model ids from object ancestors", () => {
    const root = new THREE.Group();
    const child = new THREE.Mesh();
    root.userData.assemblyModelId = "secondary";
    root.add(child);

    expect(resolveObjectAssemblyModelId(child)).toBe("secondary");

    root.userData.assemblyModelId = "";
    expect(resolveObjectAssemblyModelId(child)).toBeNull();
  });

  it("checks whether an object is inside a robot subtree", () => {
    const robot = new THREE.Group();
    const link = new THREE.Group();
    const mesh = new THREE.Mesh();
    robot.add(link);
    link.add(mesh);

    expect(isObjectDescendantOf(mesh, robot)).toBe(true);
    expect(isObjectDescendantOf(new THREE.Mesh(), robot)).toBe(false);
  });

  it("resolves a direct link and joint hit", () => {
    const robot = createRobot();
    const link = new THREE.Group();
    const mesh = new THREE.Mesh();
    link.name = "wrist_link";
    robot.add(link);
    link.add(mesh);
    assignRobotStructure({
      robot,
      links: { wrist_link: link },
      joints: { wrist_joint: createJointWithChild(link) },
    });

    expect(resolveRobotPointerSelection({ hitObject: mesh, robot })).toEqual({
      hitRobot: true,
      linkName: "wrist_link",
      jointName: "wrist_joint",
    });
  });

  it("falls back to joint children when link maps do not expose the hit link", () => {
    const robot = createRobot();
    const link = new THREE.Group();
    const mesh = new THREE.Mesh();
    link.name = "hidden_link";
    robot.add(link);
    link.add(mesh);
    assignRobotStructure({
      robot,
      links: {},
      joints: { hidden_joint: createJointWithChild(link) },
    });

    expect(resolveRobotPointerSelection({ hitObject: mesh, robot })).toEqual({
      hitRobot: true,
      linkName: "hidden_link",
      jointName: "hidden_joint",
    });
  });

  it("returns an empty selection for objects outside the robot", () => {
    const robot = createRobot();
    assignRobotStructure({
      robot,
      links: {},
      joints: {},
    });

    expect(resolveRobotPointerSelection({ hitObject: new THREE.Mesh(), robot })).toEqual({
      hitRobot: false,
      linkName: undefined,
      jointName: null,
    });
  });
});
