import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";
import * as THREE from "three";
import { computeLinkBoundingBox } from "@/features/camera/cameraPoseCompute";

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
