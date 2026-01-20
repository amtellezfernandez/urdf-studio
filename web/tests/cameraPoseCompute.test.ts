import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";
import * as THREE from "three";
import { autoComputeCameraPoseDefault, computeLinkBoundingBox } from "@/features/camera/cameraPoseCompute";

describe("computeLinkBoundingBox", () => {
  it("ignores child link geometry when computing bounds", () => {
    const link1 = new THREE.Group();
    link1.name = "link1";

    const mesh1 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    mesh1.position.set(1, 0, 0);
    link1.add(mesh1);

    const link2 = new THREE.Group();
    link2.name = "link2";
    const mesh2 = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    );
    mesh2.position.set(10, 0, 0);
    link2.add(mesh2);

    link1.add(link2);
    link1.updateMatrixWorld(true);

    const robot = { links: { link1, link2 } } as unknown as URDFRobot;
    const box = computeLinkBoundingBox(robot, "link1");

    expect(box).not.toBeNull();
    const size = new THREE.Vector3();
    box?.getSize(size);
    expect(size.x).toBeCloseTo(1);
    expect(size.y).toBeCloseTo(1);
    expect(size.z).toBeCloseTo(1);

    const center = new THREE.Vector3();
    box?.getCenter(center);
    expect(center.x).toBeCloseTo(1);
  });
});

describe("autoComputeCameraPoseDefault", () => {
  it("places camera behind the link and outside its bounds", () => {
    const link = new THREE.Group();
    link.name = "gripper";
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.06),
      new THREE.MeshBasicMaterial()
    );
    link.add(mesh);
    link.updateMatrixWorld(true);

    const robot = { links: { gripper: link } } as unknown as URDFRobot;
    const robotBounds = new THREE.Box3().setFromObject(link);
    const pose = autoComputeCameraPoseDefault(robot, "gripper", {
      robotBoundingBox: robotBounds,
      marginForward: 0.02,
      marginUp: 0.01,
    });

    expect(pose).not.toBeNull();
    const position = new THREE.Vector3(...(pose?.xyz ?? [0, 0, 0]));
    const bounds = computeLinkBoundingBox(robot, "gripper");
    expect(bounds?.containsPoint(position)).toBe(false);
    expect(position.x).toBeLessThan(-0.05);

    const rotation = new THREE.Euler(...(pose?.rpy ?? [0, 0, 0]), "ZYX");
    const forward = new THREE.Vector3(1, 0, 0).applyEuler(rotation).normalize();
    expect(forward.x).toBeGreaterThan(0.5);
  });

  it("aims at a provided target position even when link forward is flipped", () => {
    const link = new THREE.Group();
    link.name = "gripper";
    link.rotation.y = Math.PI;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.06),
      new THREE.MeshBasicMaterial()
    );
    link.add(mesh);
    link.updateMatrixWorld(true);

    const robot = { links: { gripper: link } } as unknown as URDFRobot;
    const target = new THREE.Vector3(0.3, 0, 0);
    const pose = autoComputeCameraPoseDefault(robot, "gripper", {
      targetPosition: target,
      marginForward: 0.02,
      marginUp: 0.01,
    });

    expect(pose).not.toBeNull();
    const rotation = new THREE.Euler(...(pose?.rpy ?? [0, 0, 0]), "ZYX");
    const parentQuat = new THREE.Quaternion().setFromEuler(link.rotation);
    const forward = new THREE.Vector3(1, 0, 0)
      .applyEuler(rotation)
      .applyQuaternion(parentQuat)
      .normalize();
    expect(forward.x).toBeGreaterThan(0.5);
  });
});
