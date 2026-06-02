import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  copyWorldMatrixToObjectLocal,
  createOverlayTransformScratch,
} from "./cameraOverlayTransform";

const EPSILON = 1e-9;
const ROOT_POS_X = 1.2;
const ROOT_POS_Y = -0.7;
const ROOT_POS_Z = 0.4;
const ROOT_ROT_X = 0.2;
const ROOT_ROT_Y = -0.5;
const ROOT_ROT_Z = 0.3;
const ROOT_SCALE_X = 1.4;
const ROOT_SCALE_Y = 0.7;
const ROOT_SCALE_Z = 1.1;
const CHILD_POS_X = -0.3;
const CHILD_POS_Y = 0.5;
const CHILD_POS_Z = 0.1;
const CHILD_ROT_X = 0.6;
const CHILD_ROT_Y = 0.1;
const CHILD_ROT_Z = -0.2;
const CHILD_SCALE_X = 0.8;
const CHILD_SCALE_Y = 1.3;
const CHILD_SCALE_Z = 0.9;

const expectMatrixClose = (a: THREE.Matrix4, b: THREE.Matrix4) => {
  const aElements = a.elements;
  const bElements = b.elements;
  for (let i = 0; i < aElements.length; i += 1) {
    expect(Math.abs(aElements[i] - bElements[i])).toBeLessThan(EPSILON);
  }
};

describe("copyWorldMatrixToObjectLocal", () => {
  it("keeps target world matrix identical to source under transformed parent", () => {
    const sceneRoot = new THREE.Group();
    sceneRoot.position.set(ROOT_POS_X, ROOT_POS_Y, ROOT_POS_Z);
    sceneRoot.rotation.set(ROOT_ROT_X, ROOT_ROT_Y, ROOT_ROT_Z);
    sceneRoot.scale.set(ROOT_SCALE_X, ROOT_SCALE_Y, ROOT_SCALE_Z);

    const source = new THREE.Group();
    source.position.set(CHILD_POS_X, CHILD_POS_Y, CHILD_POS_Z);
    source.rotation.set(CHILD_ROT_X, CHILD_ROT_Y, CHILD_ROT_Z);
    source.scale.set(CHILD_SCALE_X, CHILD_SCALE_Y, CHILD_SCALE_Z);
    sceneRoot.add(source);

    const overlayParent = new THREE.Group();
    const overlay = new THREE.Group();
    overlay.matrixAutoUpdate = false;
    overlayParent.add(overlay);
    sceneRoot.add(overlayParent);

    sceneRoot.updateMatrixWorld(true);
    const scratch = createOverlayTransformScratch();
    copyWorldMatrixToObjectLocal(overlay, source.matrixWorld, scratch);
    sceneRoot.updateMatrixWorld(true);

    expectMatrixClose(overlay.matrixWorld, source.matrixWorld);
  });
});
