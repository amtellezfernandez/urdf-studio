import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeStableDragHandleAnchorLocalFromBounds,
  computeStableDragHandleAnchorWorld,
} from "./ikDragAnchor";

const BOX_LENGTH_X = 0.6;
const BOX_LENGTH_Y = 0.2;
const BOX_LENGTH_Z = 0.1;
const BOX_OFFSET_X = 0.1;
const BOX_OFFSET_Y = -0.2;
const BOX_OFFSET_Z = 0.05;
const LINK_OFFSET_X = 1.25;
const LINK_OFFSET_Y = -0.4;
const LINK_OFFSET_Z = 0.8;
const LINK_ROTATION_ROLL = 0.2;
const LINK_ROTATION_PITCH = -0.35;
const LINK_ROTATION_YAW = 0.4;
const ANCHOR_PAD_METERS = 0.015;
const ASSERT_EPSILON = 2e-8;
const OWN_BOX_SIZE = 0.1;
const DESCENDANT_BOX_SIZE = 3.0;
const DESCENDANT_OFFSET_X = 4.0;
const DESCENDANT_OFFSET_Y = 0.0;
const DESCENDANT_OFFSET_Z = 0.0;

const createBoxMesh = (x: number, y: number, z: number) =>
  new THREE.Mesh(new THREE.BoxGeometry(x, y, z));

describe("ikDragAnchor", () => {
  it("anchors local position to the positive face of the dominant local axis", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-0.1, -0.2, -0.3),
      new THREE.Vector3(0.4, 0.5, 0.1)
    );
    const anchor = computeStableDragHandleAnchorLocalFromBounds(
      bounds,
      ANCHOR_PAD_METERS,
      new THREE.Vector3()
    );
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeCloseTo((bounds.min.x + bounds.max.x) * 0.5, 8);
    expect(anchor!.y).toBeCloseTo(bounds.max.y + ANCHOR_PAD_METERS, 8);
    expect(anchor!.z).toBeCloseTo((bounds.min.z + bounds.max.z) * 0.5, 8);
  });

  it("computes world anchor from link-local geometry deterministically", () => {
    const link = new THREE.Group();
    link.position.set(LINK_OFFSET_X, LINK_OFFSET_Y, LINK_OFFSET_Z);
    link.rotation.set(LINK_ROTATION_ROLL, LINK_ROTATION_PITCH, LINK_ROTATION_YAW, "XYZ");
    const mesh = createBoxMesh(BOX_LENGTH_X, BOX_LENGTH_Y, BOX_LENGTH_Z);
    mesh.position.set(BOX_OFFSET_X, BOX_OFFSET_Y, BOX_OFFSET_Z);
    link.add(mesh);
    link.updateMatrixWorld(true);

    const anchor = computeStableDragHandleAnchorWorld({
      linkObject: link,
      surfacePadMeters: ANCHOR_PAD_METERS,
      out: new THREE.Vector3(),
    });
    expect(anchor).not.toBeNull();

    const expectedLocalAnchor = new THREE.Vector3(
      BOX_OFFSET_X + BOX_LENGTH_X * 0.5 + ANCHOR_PAD_METERS,
      BOX_OFFSET_Y,
      BOX_OFFSET_Z
    );
    const expectedWorldAnchor = expectedLocalAnchor.applyMatrix4(link.matrixWorld);
    expect(anchor!.distanceTo(expectedWorldAnchor)).toBeLessThan(ASSERT_EPSILON);
  });

  it("excludes descendant URDF link geometry from anchor bounds", () => {
    const link = new THREE.Group();
    const ownMesh = createBoxMesh(OWN_BOX_SIZE, OWN_BOX_SIZE, OWN_BOX_SIZE);
    link.add(ownMesh);

    const descendantLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
    descendantLink.isURDFLink = true;
    const descendantMesh = createBoxMesh(
      DESCENDANT_BOX_SIZE,
      DESCENDANT_BOX_SIZE,
      DESCENDANT_BOX_SIZE
    );
    descendantMesh.position.set(DESCENDANT_OFFSET_X, DESCENDANT_OFFSET_Y, DESCENDANT_OFFSET_Z);
    descendantLink.add(descendantMesh);
    link.add(descendantLink);
    link.updateMatrixWorld(true);

    const anchor = computeStableDragHandleAnchorWorld({
      linkObject: link,
      surfacePadMeters: ANCHOR_PAD_METERS,
      out: new THREE.Vector3(),
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeCloseTo(OWN_BOX_SIZE * 0.5 + ANCHOR_PAD_METERS, 8);
    expect(anchor!.y).toBeCloseTo(0, 8);
    expect(anchor!.z).toBeCloseTo(0, 8);
  });
});
