import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveEndEffectorContactObjectId } from "@/features/viewer/eeObjectContact";
import type { CreatedObject } from "@/features/objects";

const createObject = (overrides: Partial<CreatedObject>): CreatedObject => ({
  id: "object",
  type: "cube",
  position: new THREE.Vector3(),
  size: new THREE.Vector3(0.1, 0.1, 0.1),
  color: "#ffffff",
  trackedJointName: null,
  isIkTarget: true,
  ...overrides,
});

describe("eeObjectContact", () => {
  it("returns null when the end effector sphere does not touch any object", () => {
    const contactId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.02),
      objects: [createObject({ id: "far", position: new THREE.Vector3(1, 1, 1) })],
    });
    expect(contactId).toBeNull();
  });

  it("detects contact against point objects", () => {
    const contactId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.03),
      objects: [
        createObject({
          id: "point-1",
          type: "point",
          position: new THREE.Vector3(0.03, 0, 0),
          size: new THREE.Vector3(0.02, 0.02, 0.02),
        }),
      ],
    });
    expect(contactId).toBe("point-1");
  });

  it("detects contact against cube objects using sphere-aabb distance", () => {
    const contactId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: new THREE.Sphere(new THREE.Vector3(0.09, 0, 0), 0.04),
      objects: [
        createObject({
          id: "cube-1",
          type: "cube",
          position: new THREE.Vector3(0, 0, 0),
          size: new THREE.Vector3(0.1, 0.1, 0.1),
        }),
      ],
    });
    expect(contactId).toBe("cube-1");
  });

  it("detects contact against sphere objects", () => {
    const contactId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: new THREE.Sphere(new THREE.Vector3(0.12, 0, 0), 0.03),
      objects: [
        createObject({
          id: "sphere-1",
          type: "sphere",
          position: new THREE.Vector3(0, 0, 0),
          size: new THREE.Vector3(0.2, 0.2, 0.2),
        }),
      ],
    });
    expect(contactId).toBe("sphere-1");
  });

  it("detects contact against rotated cylinder objects", () => {
    const contactId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: new THREE.Sphere(new THREE.Vector3(0, 0.09, 0), 0.03),
      objects: [
        createObject({
          id: "cylinder-1",
          type: "cylinder",
          position: new THREE.Vector3(0, 0, 0),
          rotation: new THREE.Euler(Math.PI * 0.5, 0, 0),
          size: new THREE.Vector3(0.1, 0.1, 0.2),
        }),
      ],
    });
    expect(contactId).toBe("cylinder-1");
  });
});
